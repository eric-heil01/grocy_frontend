"""Meal rules. All persistence remains in Grocy via the generic object API."""
from datetime import timedelta
from fastapi import HTTPException
from app.calendar_config import dinner_configuration, dinner_section
from app.dashboard import meals, rows
from app.meal_models import MealWeek, RecipeOption


class MealService:
    def __init__(self, client):
        self.client = client

    async def section(self):
        try:
            return dinner_section(await self.client.get('objects/meal_plan_sections'), dinner_configuration())
        except ValueError:
            raise HTTPException(503, 'Dinner section is unavailable. Check dinner configuration.') from None

    async def recipes(self, query=''):
        # Fail closed for unknown recipe types; never offer internal day/week/shadow recipes.
        result = []
        for record in rows(await self.client.get('objects/recipes')):
            if record.get('type') != 'normal':
                continue
            option = RecipeOption(id=int(record['id']), name=record['name'], base_servings=record.get('base_servings'))
            if query.casefold() in option.name.casefold():
                result.append(option)
        return result

    async def require_recipe(self, recipe_id):
        if not any(r.id == recipe_id for r in await self.recipes()):
            raise HTTPException(422, 'Select an existing normal recipe.')

    async def week(self, start, today, timezone):
        section = await self.section()
        plan = await self.client.get('objects/meal_plan', params=[('query[]', f'day>={start}'),
                                     ('query[]', f'day<={start + timedelta(days=6)}')])
        recipes = await self.client.get('objects/recipes')
        products = await self.client.get('objects/products')
        return MealWeek(today=today, timezone=timezone, start=start,
                        days=meals(plan, recipes, products, [{'id': section}], start, section))

    async def entry(self, entry_id):
        section = await self.section()
        entry = await self.client.get(f'objects/meal_plan/{entry_id}')
        if not isinstance(entry, dict) or int(entry['id']) != entry_id:
            raise ValueError('Invalid meal entry')
        if int(entry['section_id']) != section:
            raise HTTPException(404, 'This entry does not belong to dinner.')
        return entry

    async def add(self, entry):
        section = await self.section()
        await self.require_recipe(entry.recipe_id)
        await self.client.post('objects/meal_plan', dict(entry.model_dump(mode='json'), type='recipe', section_id=section))

    async def update(self, entry_id, changes):
        entry = await self.entry(entry_id)
        if entry['type'] != 'recipe':
            raise HTTPException(422, 'Only recipe entries can be edited here.')
        if changes.recipe_id is not None:
            await self.require_recipe(changes.recipe_id)
        await self.client.put(f'objects/meal_plan/{entry_id}', changes.model_dump(mode='json', exclude_unset=True))

    async def remove(self, entry_id):
        await self.entry(entry_id)
        await self.client.delete(f'objects/meal_plan/{entry_id}')
