from datetime import date, timedelta
from typing import Annotated
from fastapi import APIRouter, HTTPException, Query
from app.calendar_config import household_calendar
from app.routes.groceries import Client, PositivePath
from app.grocery_models import MutationResult
from app.meal_models import MealCreate, MealUpdate, MealWeek, RecipeOption
from app.meal_planning import MealService

router = APIRouter(prefix='/api', tags=['Meals'])


@router.get('/recipes', response_model=list[RecipeOption])
async def recipes(client: Client, q: Annotated[str, Query(max_length=100)] = ''):
    return (await MealService(client).recipes(q.strip()))[:30]


@router.get('/meals', response_model=MealWeek)
async def week(client: Client, start: Annotated[str | None, Query(pattern=r'^\d{4}-\d{2}-\d{2}$')] = None):
    today, timezone = household_calendar()
    try:
        first = date.fromisoformat(start) if start else today
        first + timedelta(days=6)
    except (OverflowError, ValueError):
        raise HTTPException(422, 'Use a valid seven-day calendar period.') from None
    return await MealService(client).week(first, today, timezone)


@router.post('/meals', response_model=MutationResult, status_code=201)
async def add(entry: MealCreate, client: Client):
    await MealService(client).add(entry)
    return MutationResult()


@router.patch('/meals/{entry_id}', response_model=MutationResult)
async def update(entry_id: PositivePath, changes: MealUpdate, client: Client):
    await MealService(client).update(entry_id, changes)
    return MutationResult()


@router.delete('/meals/{entry_id}', response_model=MutationResult)
async def remove(entry_id: PositivePath, client: Client):
    await MealService(client).remove(entry_id)
    return MutationResult()
