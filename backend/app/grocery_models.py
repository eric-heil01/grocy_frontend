"""Validated public grocery contracts. Quantities use product stock units."""
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator
from app.models import ShoppingItem

Identifier = Annotated[int, Field(gt=0, strict=True)]
Quantity = Annotated[float, Field(gt=0, le=1_000_000_000, allow_inf_nan=False)]
Note = Annotated[str, Field(max_length=2000)]


class GroceryListInfo(BaseModel):
    id: int
    name: str


class GroceryLists(BaseModel):
    lists: list[GroceryListInfo]
    default_list_id: int | None = None


class GroceryItem(ShoppingItem):
    unit_id: int | None = None
    unit_name: str | None = None
    display_unit_id: int | None = None


class GroceryEntries(BaseModel):
    id: int
    name: str
    remaining_items: int
    total_items: int
    items: list[GroceryItem]


class ProductOption(BaseModel):
    id: int
    name: str
    unit_id: int | None = None
    unit_name: str | None = None


class GroceryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    product_id: Identifier | None = None
    amount: Quantity = 1
    note: Note = ""

    @field_validator("amount", mode="before")
    @classmethod
    def reject_boolean_quantity(cls, value):
        if isinstance(value, bool):
            raise ValueError("Quantity must be a number")
        return value

    @model_validator(mode="after")
    def require_product_or_note(self):
        if self.product_id is None and not self.note:
            raise ValueError("Choose a product or enter a free-text item")
        return self


class GroceryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    amount: Quantity | None = None
    note: Note | None = None
    done: StrictBool | None = None

    @field_validator("amount", mode="before")
    @classmethod
    def reject_boolean_quantity(cls, value):
        if isinstance(value, bool):
            raise ValueError("Quantity must be a number")
        return value

    @model_validator(mode="after")
    def require_changes(self):
        if not self.model_fields_set or any(getattr(self, key) is None for key in self.model_fields_set):
            raise ValueError("Provide at least one non-null change")
        return self


class MutationResult(BaseModel):
    ok: bool = True
