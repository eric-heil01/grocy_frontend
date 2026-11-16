"""Inventory contracts: stock units, explicit location/batch, and reviewed snapshots."""
from datetime import date
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator
from app.grocery_models import Identifier
from app.product_models import NamedOption

Amount = Annotated[float, Field(gt=0, le=1_000_000_000, allow_inf_nan=False)]
Version = Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]

class StockEntry(BaseModel):
    id: int = Field(gt=0)
    amount: Amount
    location_id: int | None
    location_name: str | None
    due_date: date | None
    never_expires: bool
    opened: bool
    purchased_date: date | None
    note: str | None
    selectable: bool

class StockProduct(BaseModel):
    id: int = Field(gt=0)
    name: str
    amount: float = Field(ge=0, allow_inf_nan=False)
    unit_id: int | None
    unit_name: str | None
    default_location_id: int | None
    running_low: bool
    due_type: int | None
    entries: list[StockEntry]
    version: str
    manage_reason: str | None

class InventoryOverview(BaseModel):
    today: date
    products: list[StockProduct]
    track_dates: bool
    track_locations: bool

class StockDetails(BaseModel):
    product: StockProduct
    locations: list[NamedOption]
    track_dates: bool
    track_locations: bool

class StockChange(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    amount: Amount
    unit_id: Identifier
    expected_version: Version

    @field_validator('amount', mode='before')
    @classmethod
    def numeric_amount(cls, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError('Enter a numeric quantity')
        return value

class StockAdd(StockChange):
    location_id: Identifier
    best_before_date: date | None = None
    never_expires: StrictBool = False
    note: Annotated[str, Field(max_length=2000)] = ''

    @field_validator('best_before_date', mode='before')
    @classmethod
    def calendar_date(cls, value):
        if value is not None and (not isinstance(value, str) or len(value) != 10):
            raise ValueError('Enter a calendar date')
        return value

    @model_validator(mode='after')
    def one_date_choice(self):
        if self.never_expires and self.best_before_date is not None:
            raise ValueError('Choose a date or no expiry date')
        if self.best_before_date is not None and self.best_before_date.year >= 2999:
            raise ValueError('Use the no expiry option for products with no expiry')
        return self

class StockConsume(StockChange):
    entry_id: Identifier
