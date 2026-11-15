"""Shopping-list operations. Only explicit editable fields are sent to Grocy."""
import asyncio
from fastapi import HTTPException
from app.dashboard import optional_id, rows, shopping
from app.grocery_models import GroceryEntries, GroceryItem, GroceryListInfo, ProductOption


def object_row(value):
    if not isinstance(value, dict):
        raise ValueError("Expected object")
    return value


def list_info(row):
    return GroceryListInfo(id=row["id"], name=row.get("name") or "Unnamed list")


def unit_for(product, units):
    unit_id = optional_id(product.get("qu_id_stock"))
    return unit_id, units.get(unit_id)


class GroceryService:
    def __init__(self, client):
        self.client = client

    async def lists(self):
        return [list_info(row) for row in rows(await self.client.get("objects/shopping_lists"))]

    async def require_list(self, list_id):
        result = await self.lists()
        selected = next((entry for entry in result if entry.id == list_id), None)
        if selected is None:
            raise HTTPException(404, "Shopping list not found. Choose another list.")
        return selected

    async def catalog(self):
        products, units = await asyncio.gather(
            self.client.get("objects/products"), self.client.get("objects/quantity_units")
        )
        return rows(products), {int(unit["id"]): unit.get("name") for unit in rows(units)}

    async def products(self, query):
        products, units = await self.catalog()
        # Filter locally rather than interpolating user text into Grocy's query grammar.
        matching = [p for p in products if query.casefold() in p["name"].casefold()
                    and str(p.get("active", 1)) not in ("0", "False")]
        return [ProductOption(id=p["id"], name=p["name"], unit_id=unit_for(p, units)[0],
                              unit_name=unit_for(p, units)[1])
                for p in sorted(matching, key=lambda p: (p["name"].casefold(), int(p["id"])))[:30]]

    async def entries(self, list_id):
        selected = await self.require_list(list_id)
        records, catalog = await asyncio.gather(
            self.client.get("objects/shopping_list", params={"query[]": f"shopping_list_id={list_id}"}),
            self.catalog(),
        )
        products, units = catalog
        by_product = {int(p["id"]): p for p in products}
        normalized = shopping(records, [selected.model_dump()], products, list_id)
        records_by_id = {int(row["id"]): row for row in rows(records)}
        items = []
        for item in normalized.items:
            row = records_by_id[item.id]
            product = by_product.get(item.product_id, {})
            unit_id = optional_id(product.get("qu_id_stock")) if item.product_id else optional_id(row.get("qu_id"))
            items.append(GroceryItem(
                **item.model_dump(), unit_id=unit_id, unit_name=units.get(unit_id),
                display_unit_id=optional_id(row.get("qu_id")),
            ))
        return GroceryEntries(id=list_id, name=selected.name, items=items,
                              remaining_items=normalized.remaining_items, total_items=normalized.total_items)

    async def require_entry(self, list_id, entry_id):
        await self.require_list(list_id)
        row = object_row(await self.client.get(f"objects/shopping_list/{entry_id}"))
        if int(row["id"]) != entry_id or optional_id(row.get("shopping_list_id")) != list_id:
            raise HTTPException(404, "Item not found in this shopping list. Refresh the list.")
        return row

    async def add(self, list_id, entry):
        await self.require_list(list_id)
        payload = {"shopping_list_id": list_id, "product_id": entry.product_id,
                   "amount": entry.amount, "note": entry.note, "done": 0}
        if entry.product_id is not None:
            product = object_row(await self.client.get(f"objects/products/{entry.product_id}"))
            if int(product["id"]) != entry.product_id or str(product.get("active", 1)) in ("0", "False"):
                raise HTTPException(422, "Choose an available Grocy product.")
            # Amount is always in stock units. Set the display unit only on creation.
            unit_id = optional_id(product.get("qu_id_stock"))
            if unit_id is None:
                raise HTTPException(422, "This product has no stock unit configured in Grocy.")
            payload["qu_id"] = unit_id
        # Same create path as Grocy's item form: separate entries retain separate notes.
        await self.client.post("objects/shopping_list", payload)

    async def update(self, list_id, entry_id, changes):
        current = await self.require_entry(list_id, entry_id)
        payload = changes.model_dump(exclude_unset=True)
        if "note" in payload and not payload["note"] and not optional_id(current.get("product_id")):
            raise HTTPException(422, "A free-text item needs a name in its note.")
        if "done" in payload:
            payload["done"] = int(payload["done"])
        # Do not resend unit IDs, product IDs, list IDs, or other unrelated record fields.
        await self.client.put(f"objects/shopping_list/{entry_id}", payload)

    async def remove(self, list_id, entry_id):
        await self.require_entry(list_id, entry_id)
        await self.client.delete(f"objects/shopping_list/{entry_id}")
