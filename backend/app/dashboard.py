"""Dashboard business logic, independent of FastAPI and future display clients."""
import asyncio
from datetime import date, timedelta
from pydantic import ValidationError
from app.grocy_client import GrocyUnavailable
from app.models import Dashboard, Inventory, LowStockItem, Meal, MealDay, ShoppingItem, ShoppingList


def rows(value):
    if not isinstance(value, list) or any(not isinstance(row, dict) for row in value):
        raise ValueError("Expected object array")
    return value


def optional_id(value):
    return None if value in (None, "") else int(value)


def done_flag(value):
    if value not in (0, 1, "0", "1", False, True):
        raise ValueError("Unknown completion state")
    return str(value) in ("1", "True")


def shopping(items, lists, products, list_id):
    names = {int(p["id"]): p["name"] for p in rows(products)}
    list_names = {int(p["id"]): p.get("name") for p in rows(lists)}
    if list_id is not None and list_id not in list_names:
        raise ValueError("Configured list missing")
    result = []
    for item in rows(items):
        item_list = optional_id(item.get("shopping_list_id"))
        if list_id is not None and item_list != list_id:
            continue
        product_id = optional_id(item.get("product_id"))
        result.append(ShoppingItem(
            id=item["id"], list_id=item_list, product_id=product_id,
            name=names.get(product_id) or item.get("note") or "Unnamed grocery item",
            note=item.get("note"), amount=item.get("amount"), done=done_flag(item.get("done")),
        ))
    return ShoppingList(available=True, id=list_id,
                        name=list_names.get(list_id) if list_id is not None else "All grocery lists",
                        remaining_items=sum(not i.done for i in result), total_items=len(result), items=result)


def meals(plan, recipes, products, sections, today, section_id):
    sections = rows(sections)
    if section_id is None:
        matches = [int(s["id"]) for s in sections if str(s.get("name") or "").strip().casefold() == "dinner"]
        if len(matches) != 1:
            raise ValueError("Configure dinner section")
        section_id = matches[0]
    if not any(int(s["id"]) == section_id for s in sections):
        raise ValueError("Dinner section missing")
    recipe_names = {int(r["id"]): r["name"] for r in rows(recipes)}
    product_names = {int(p["id"]): p["name"] for p in rows(products)}
    days = {today + timedelta(days=i): [] for i in range(7)}
    for entry in rows(plan):
        day = date.fromisoformat(entry["day"])
        if day not in days or optional_id(entry.get("section_id")) != section_id:
            continue
        recipe_id = optional_id(entry.get("recipe_id")) if entry["type"] == "recipe" else None
        if entry["type"] == "recipe":
            name = recipe_names.get(recipe_id) or "Recipe name unavailable"
        elif entry["type"] == "product":
            name = product_names.get(optional_id(entry.get("product_id"))) or "Product name unavailable"
        elif entry["type"] == "note":
            name = entry.get("note") or "Untitled meal plan entry"
        else:
            raise ValueError("Unsupported meal type")
        days[day].append(Meal(id=entry["id"], name=name, recipe_id=recipe_id))
    return [MealDay(date=d, available=True, planned=bool(entries), meals=entries) for d, entries in days.items()]


async def build_dashboard(client, today, timezone, list_id=None, section_id=None):
    paths = ["objects/shopping_list", "objects/shopping_lists", "objects/products",
             "objects/meal_plan", "objects/recipes", "objects/meal_plan_sections", "stock/volatile"]
    async def fetch(path):
        try:
            params = [("query[]", f"day>={today.isoformat()}"),
                      ("query[]", f"day<={(today + timedelta(days=6)).isoformat()}")] if path == "objects/meal_plan" else None
            return await client.get(path, params=params)
        except GrocyUnavailable:
            return None
    data = dict(zip(paths, await asyncio.gather(*(fetch(p) for p in paths))))
    notices = []
    errors = (ValueError, TypeError, KeyError, ValidationError)
    try:
        grocery = shopping(data[paths[0]], data[paths[1]], data[paths[2]], list_id)
    except errors:
        grocery = ShoppingList(id=list_id)
        notices.append("Grocery information is unavailable.")
    try:
        week = meals(data[paths[3]], data[paths[4]], data[paths[2]], data[paths[5]], today, section_id)
    except errors:
        week = [MealDay(date=today + timedelta(days=i), available=False, planned=None) for i in range(7)]
        notices.append("Dinner information is unavailable. Check the dinner-section configuration and Grocy connection.")
    try:
        inventory = Inventory(available=True, low_stock=[LowStockItem(**item) for item in rows(data[paths[6]]["missing_products"])])
    except errors:
        inventory = Inventory()
        notices.append("Inventory information is unavailable.")
    return Dashboard(today=today, timezone=timezone, dinner_tonight=week[0], shopping_list=grocery,
                     upcoming_meals=week, inventory=inventory, notices=notices)
