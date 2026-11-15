"""Small public product contracts; unrelated Grocy properties are never writable."""
from typing import Annotated
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator
from app.grocery_models import Identifier

Name = Annotated[str, Field(min_length=1, max_length=200)]
Minimum = Annotated[float, Field(ge=0, le=1_000_000_000, allow_inf_nan=False)]
DueDays = Annotated[int, Field(ge=-1, le=36500, strict=True)]


class NamedOption(BaseModel):
    id: int = Field(gt=0)
    name: str


class ProductSetup(BaseModel):
    units: list[NamedOption]
    locations: list[NamedOption]


class ProductDetails(BaseModel):
    id: int = Field(gt=0)
    name: str
    location_id: int | None
    location_name: str | None
    unit_id: int | None
    unit_name: str | None
    purchase_unit_name: str | None
    min_stock_amount: Minimum
    default_best_before_days: int
    active: bool
    version: str


class ProductFields(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    @field_validator('min_stock_amount', check_fields=False, mode='before')
    @classmethod
    def reject_bool(cls, value):
        if isinstance(value, bool):
            raise ValueError('Enter a number')
        return value

    @field_validator('name', check_fields=False)
    @classmethod
    def printable_name(cls, value):
        if value is None:
            return value
        if any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError('Use a plain product name')
        return value


class ProductCreate(ProductFields):
    name: Name
    unit_id: Identifier
    location_id: Identifier
    min_stock_amount: Minimum = 0
    default_best_before_days: DueDays = 0
    allow_similar_name: StrictBool = False


class ProductUpdate(ProductFields):
    expected_version: Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]
    name: Name | None = None
    location_id: Identifier | None = None
    min_stock_amount: Minimum | None = None
    default_best_before_days: DueDays | None = None
    allow_similar_name: StrictBool = False

    @model_validator(mode='after')
    def changes_required(self):
        changes = self.model_fields_set - {'expected_version', 'allow_similar_name'}
        if not changes or any(getattr(self, k) is None for k in changes):
            raise ValueError('Supply a non-null product change')
        return self
