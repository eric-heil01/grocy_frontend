"""Stock API adapter. Never writes generic stock objects or shopping/recipe records."""
import asyncio
import hashlib
import json
from collections import Counter
from datetime import date
from decimal import Decimal, InvalidOperation
from fastapi import HTTPException
from app.calendar_config import household_calendar
from app.dashboard import rows, optional_id, done_flag
from app.groceries import object_row
from app.grocy_client import GrocyUnavailable
from app.inventory_models import InventoryOverview, StockDetails, StockEntry, StockProduct
from app.product_models import NamedOption

NEVER = date(2999, 12, 31)

def reject(code, message, status=409):
    raise HTTPException(status, {'code': code, 'message': message})

def calendar(value):
    if value in (None, ''):
        return None
    return date.fromisoformat(value)

class InventoryService:
    def __init__(self, client):
        self.client = client

    async def context(self):
        products, units, locations, config = await asyncio.gather(*[self.client.get(path) for path in
            ('objects/products', 'objects/quantity_units', 'objects/locations', 'system/config')])
        config = object_row(config)
        def flag(name):
            values = [done_flag(config[key]) for key in (name, f'GROCY_{name}') if key in config]
            if not values or any(value != values[0] for value in values):
                raise ValueError('Unsupported feature settings')
            return values[0]
        if not flag('FEATURE_FLAG_STOCK'):
            reject('configuration', 'Inventory is disabled in Grocy.')
        return (rows(products), {int(u['id']): u['name'] for u in rows(units)}, rows(locations), {
            'track_dates': flag('FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING'),
            'track_locations': flag('FEATURE_FLAG_STOCK_LOCATION_TRACKING'),
        })

    async def snapshot(self, product, units, locations, flags):
        product_id = int(product['id'])
        raw_entries = rows(await self.client.get(f'stock/products/{product_id}/entries', params={'include_sub_products': 'false'}))
        by_location = {int(l['id']): l['name'] for l in locations}
        groups = Counter((r.get('stock_id'), optional_id(r.get('location_id'))) for r in raw_entries)
        entries, seen = [], set()
        for entry in raw_entries:
            if int(entry['product_id']) != product_id or int(entry['id']) in seen:
                raise ValueError('Unexpected stock entry')
            seen.add(int(entry['id']))
            location_id = optional_id(entry.get('location_id'))
            batch = entry.get('stock_id')
            due = calendar(entry.get('best_before_date'))
            entries.append(StockEntry(id=entry['id'], amount=entry['amount'], location_id=location_id,
                location_name=by_location.get(location_id), due_date=None if due == NEVER else due,
                never_expires=due == NEVER, opened=done_flag(entry['open']), purchased_date=calendar(entry.get('purchased_date')),
                note=entry.get('note'), selectable=isinstance(batch, str) and bool(batch) and batch != 'default'
                and location_id in by_location and groups[(batch, location_id)] == 1))
        unit = optional_id(product.get('qu_id_stock'))
        reason = None
        try:
            if not done_flag(product['active']):
                reason = 'This product is inactive. Manage its stock in Grocy.'
            elif done_flag(product['enable_tare_weight_handling']) or done_flag(product['no_own_stock']):
                reason = 'This product needs special quantity handling. Manage its stock in Grocy.'
        except (KeyError, ValueError):
            reason = 'This product configuration needs review in Grocy before changing stock here.'
        if unit not in units:
            reason = 'Set up a measurement unit in Grocy before changing this product.'
        snapshot = {'product': {k: v for k, v in product.items() if k != 'userfields'},
                    'entries': sorted(raw_entries, key=lambda r: int(r['id'])), 'flags': flags,
                    'locations': sorted(locations, key=lambda r: int(r['id'])), 'unit_name': units.get(unit)}
        version = hashlib.sha256(json.dumps(snapshot, sort_keys=True, default=str).encode()).hexdigest()
        amount = sum((Decimal(str(e.amount)) for e in entries), Decimal(0))
        model = StockProduct(id=product_id, name=product['name'], amount=float(amount), unit_id=unit, unit_name=units.get(unit),
            default_location_id=optional_id(product.get('location_id')), running_low=False,
            due_type=optional_id(product.get('due_type')), entries=entries, version=version, manage_reason=reason)
        return model, raw_entries

    async def overview(self):
        context, stock, volatile = await asyncio.gather(self.context(), self.client.get('stock'), self.client.get('stock/volatile'))
        missing_ids = {int(row['id']) for row in rows(object_row(volatile)['missing_products'])}
        products, units, locations, flags = context
        ids = {int(r['product_id']) for r in rows(stock)}
        catalog = {int(p['id']): p for p in products}
        if not ids.issubset(catalog):
            raise ValueError('Unknown stocked product')
        result = []
        for identifier in sorted(ids):
            product, _ = await self.snapshot(catalog[identifier], units, locations, flags)
            if product.entries:
                product.running_low = product.id in missing_ids
                result.append(product)
        today, _ = household_calendar()
        return InventoryOverview(today=today, products=sorted(result, key=lambda p: (p.name.casefold(), p.id)), **flags)

    async def details(self, product_id):
        context, volatile = await asyncio.gather(self.context(), self.client.get('stock/volatile'))
        products, units, locations, flags = context
        missing_ids = {int(row['id']) for row in rows(object_row(volatile)['missing_products'])}
        raw_product = next((p for p in products if int(p['id']) == product_id), None)
        if raw_product is None:
            reject('stale', 'This product is no longer available. Refresh inventory.', 404)
        product, entries = await self.snapshot(raw_product, units, locations, flags)
        product.running_low = product.id in missing_ids
        return StockDetails(product=product, locations=[NamedOption(id=r['id'], name=r['name']) for r in locations], **flags), entries

    async def preflight(self, product_id, change):
        details, entries = await self.details(product_id)
        product = details.product
        if product.manage_reason:
            reject('unsupported', product.manage_reason)
        if change.unit_id != product.unit_id or change.expected_version != product.version:
            reject('stale', 'This product or its stock changed. Refresh inventory and review the change again.')
        settings = object_row(await self.client.get('user/settings'))
        if done_flag(settings['shopping_list_auto_add_below_min_stock_amount']):
            reject('configuration', 'Automatic shopping additions are enabled in Grocy. Turn them off for the connected Grocy user before changing inventory here.')
        return details, entries

    async def write(self, product_id, action, payload):
        try:
            result = await self.client.post(f'stock/products/{product_id}/{action}', payload)
            if not rows(result) or any(int(r['product_id']) != product_id or not r.get('transaction_id') or int(r['location_id']) != payload['location_id'] for r in result):
                raise ValueError('Unconfirmed stock response')
            delta = sum((Decimal(str(r['amount'])) for r in result), Decimal(0))
            expected = Decimal(str(payload['amount'])) * (-1 if action == 'consume' else 1)
            if not delta.is_finite() or delta != expected:
                raise ValueError('Unexpected quantity recorded')
            if action == 'consume' and any(r.get('stock_id') != payload['stock_entry_id'] for r in result):
                raise ValueError('Unexpected batch recorded')
        except (GrocyUnavailable, ValueError, TypeError, KeyError, InvalidOperation):
            reject('uncertain', 'This change may have been saved. Refresh inventory and check the quantities before recording another change.', 502)

    async def add(self, product_id, change):
        details, _ = await self.preflight(product_id, change)
        if not any(l.id == change.location_id for l in details.locations):
            reject('validation', 'Choose an available storage location.', 422)
        if not details.track_locations and change.location_id != details.product.default_location_id:
            reject('validation', 'Use the product location configured in Grocy.', 422)
        payload = {'amount': change.amount, 'transaction_type': 'purchase', 'location_id': change.location_id,
                   'stock_label_type': 0, 'note': change.note}
        if details.track_dates:
            if not change.never_expires and change.best_before_date is None:
                reject('validation', 'Enter the package date or choose no expiry date.', 422)
            payload['best_before_date'] = (NEVER if change.never_expires else change.best_before_date).isoformat()
        elif change.best_before_date is not None or change.never_expires:
            reject('validation', 'Date tracking is disabled in Grocy. Refresh the form.', 422)
        await self.write(product_id, 'add', payload)

    async def consume(self, product_id, change):
        details, entries = await self.preflight(product_id, change)
        entry = next((e for e in details.product.entries if e.id == change.entry_id), None)
        if entry is None:
            reject('stale', 'That batch is no longer available. Refresh inventory and choose again.')
        if not entry.selectable:
            reject('unsupported', 'This batch needs a more detailed selection in Grocy. No stock was used.')
        if Decimal(str(change.amount)) > Decimal(str(entry.amount)):
            reject('insufficient', 'There is not enough in the selected batch. Choose a smaller quantity.', 422)
        raw = next(r for r in entries if int(r['id']) == change.entry_id)
        # The upstream parameter resolves stock_id, not the numeric database row id.
        await self.write(product_id, 'consume', {'amount': change.amount, 'stock_entry_id': raw['stock_id'],
            'location_id': entry.location_id, 'spoiled': False, 'allow_subproduct_substitution': False})
