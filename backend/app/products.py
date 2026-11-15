"""Product definitions only. No stock, recipe, unit-conversion or shopping writes."""
import asyncio
import hashlib
import json
import unicodedata
from difflib import SequenceMatcher
from fastapi import HTTPException
from app.dashboard import rows, optional_id, done_flag
from app.groceries import object_row
from app.product_models import NamedOption, ProductSetup, ProductDetails


def name_key(name):
    if not isinstance(name, str):
        raise ValueError('Invalid product name')
    return ' '.join(unicodedata.normalize('NFKC', name).casefold().split())


def version(record):
    # Grocy adds userfields=null to single-object reads but can omit it from lists.
    # Userfields are never writable here; exclude that transport-only difference.
    record = {key: value for key, value in record.items() if key != 'userfields'}
    return hashlib.sha256(json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()).hexdigest()


class ProductService:
    def __init__(self, client):
        self.client = client

    async def setup(self):
        units, locations = await asyncio.gather(self.client.get('objects/quantity_units'), self.client.get('objects/locations'))
        return ProductSetup(units=[NamedOption(**{'id': r['id'], 'name': r['name']}) for r in rows(units)],
                            locations=[NamedOption(**{'id': r['id'], 'name': r['name']}) for r in rows(locations)])

    def normalize(self, record, setup):
        record = object_row(record)
        unit_id = optional_id(record.get('qu_id_stock'))
        location_id = optional_id(record.get('location_id'))
        units = {u.id: u.name for u in setup.units}
        locations = {l.id: l.name for l in setup.locations}
        return ProductDetails(id=record['id'], name=record['name'], unit_id=unit_id, unit_name=units.get(unit_id),
                              location_id=location_id, location_name=locations.get(location_id),
                              purchase_unit_name=units.get(optional_id(record.get('qu_id_purchase'))),
                              min_stock_amount=record['min_stock_amount'], default_best_before_days=record['default_best_before_days'],
                              active=done_flag(record.get('active', 1)), version=version(record))

    async def catalog(self, query=''):
        setup, records = await asyncio.gather(self.setup(), self.client.get('objects/products'))
        # Include inactive products so existing definitions do not get recreated by accident.
        products = [self.normalize(r, setup) for r in rows(records)]
        return sorted([p for p in products if name_key(query) in name_key(p.name)], key=lambda p: (name_key(p.name), p.id))

    async def detail(self, product_id):
        record = object_row(await self.client.get(f'objects/products/{product_id}'))
        if int(record['id']) != product_id:
            raise ValueError('Unexpected product identifier')
        return self.normalize(record, await self.setup())

    async def duplicates(self, name, allow_similar, excluding=None):
        key = name_key(name)
        matches = []
        exact = False
        for record in rows(await self.client.get('objects/products')):
            if int(record['id']) == excluding:
                continue
            other = name_key(record['name'])
            same = other == key
            if same or key in other or other in key or SequenceMatcher(None, key, other).ratio() >= .8:
                matches.append({'id': int(record['id']), 'name': record['name']})
                exact = exact or same
        if exact or (matches and not allow_similar):
            raise HTTPException(409, {'code': 'duplicate' if exact else 'similar', 'matches': matches})

    async def safe_write(self):
        settings = object_row(await self.client.get('user/settings'))
        flag = settings['shopping_list_auto_add_below_min_stock_amount']
        if done_flag(flag):
            raise HTTPException(409, {'code': 'automatic_shopping', 'message': 'Product saving is paused because automatic shopping additions are enabled in Grocy. Ask the household administrator to turn that setting off before saving here.'})

    def require_reference(self, options, identifier, description):
        if not any(option.id == identifier for option in options):
            raise HTTPException(422, f'Choose an available {description}.')

    async def create(self, entry):
        setup = await self.setup()
        self.require_reference(setup.units, entry.unit_id, 'measurement unit')
        self.require_reference(setup.locations, entry.location_id, 'storage place')
        await self.duplicates(entry.name, entry.allow_similar_name)
        await self.safe_write()
        payload = {'name': entry.name, 'location_id': entry.location_id,
                   'qu_id_stock': entry.unit_id, 'qu_id_purchase': entry.unit_id,
                   'qu_id_consume': entry.unit_id, 'qu_id_price': entry.unit_id,
                   'min_stock_amount': entry.min_stock_amount,
                   'default_best_before_days': entry.default_best_before_days, 'active': 1}
        result = object_row(await self.client.post('objects/products', payload))
        created = result['created_object_id']
        if isinstance(created, bool) or not str(created).isdigit() or int(created) <= 0:
            raise ValueError('Invalid creation response')
        return await self.detail(int(created))

    async def update(self, product_id, changes):
        current = object_row(await self.client.get(f'objects/products/{product_id}'))
        if int(current['id']) != product_id:
            raise ValueError('Unexpected product identifier')
        if version(current) != changes.expected_version:
            raise HTTPException(409, {'code': 'stale', 'message': 'This product changed since you opened it. Refresh products and review the latest details before saving.'})
        payload = changes.model_dump(exclude_unset=True, exclude={'expected_version', 'allow_similar_name'})
        if 'name' in payload:
            await self.duplicates(changes.name, changes.allow_similar_name, excluding=product_id)
        if 'location_id' in payload:
            self.require_reference((await self.setup()).locations, changes.location_id, 'storage place')
        await self.safe_write()
        await self.client.put(f'objects/products/{product_id}', payload)
        return await self.detail(product_id)
