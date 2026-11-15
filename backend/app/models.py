from datetime import date
from pydantic import BaseModel, Field

class Meal(BaseModel):
    id: int
    name: str
    recipe_id: int | None = None

class MealDay(BaseModel):
    date: date
    available: bool
    planned: bool | None
    meals: list[Meal] = Field(default_factory=list)

class ShoppingItem(BaseModel):
    id: int
    list_id: int | None = None
    product_id: int | None = None
    name: str
    note: str | None = None
    amount: float | None = Field(default=None, allow_inf_nan=False)
    done: bool

class ShoppingList(BaseModel):
    available: bool = False
    id: int | None = None
    name: str | None = None
    remaining_items: int | None = None
    total_items: int | None = None
    items: list[ShoppingItem] = Field(default_factory=list)

class LowStockItem(BaseModel):
    id: int
    name: str
    amount_missing: float = Field(allow_inf_nan=False)

class Inventory(BaseModel):
    available: bool = False
    low_stock: list[LowStockItem] = Field(default_factory=list)

class Dashboard(BaseModel):
    today: date
    timezone: str
    dinner_tonight: MealDay
    shopping_list: ShoppingList
    upcoming_meals: list[MealDay]
    inventory: Inventory
    notices: list[str]
