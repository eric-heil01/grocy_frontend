"""Public contracts. Calendar dates never accept timestamps."""
from datetime import date
from pydantic import BaseModel, ConfigDict, field_validator, model_validator
from app.grocery_models import Identifier, Quantity
from app.models import MealDay


class RecipeOption(BaseModel):
    id: Identifier
    name: str
    base_servings: Quantity | None = None


class MealWeek(BaseModel):
    today: date
    timezone: str
    start: date
    days: list[MealDay]


class MealFields(BaseModel):
    model_config = ConfigDict(extra='forbid')

    @field_validator('day', check_fields=False, mode='before')
    @classmethod
    def calendar_date(cls, value):
        if not isinstance(value, str) or len(value) != 10 or date.fromisoformat(value).isoformat() != value:
            raise ValueError('Use an ISO calendar date')
        return value

    @field_validator('recipe_servings', check_fields=False, mode='before')
    @classmethod
    def numeric_servings(cls, value):
        if isinstance(value, bool):
            raise ValueError('Servings must be numeric')
        return value


class MealCreate(MealFields):
    day: date
    recipe_id: Identifier
    recipe_servings: Quantity = 1


class MealUpdate(MealFields):
    day: date | None = None
    recipe_id: Identifier | None = None
    recipe_servings: Quantity | None = None

    @model_validator(mode='after')
    def supplied_changes(self):
        if not self.model_fields_set or any(getattr(self, k) is None for k in self.model_fields_set):
            raise ValueError('Supply at least one non-null change')
        return self
