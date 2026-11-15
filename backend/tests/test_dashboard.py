import os
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
from zoneinfo import ZoneInfo
import httpx
from fastapi.testclient import TestClient
from app.main import app
from app.dashboard import build_dashboard, meals, shopping
from app.grocy_client import GrocyClient, GrocyUnavailable

TODAY = date(2026, 11, 15)

class TransformationTests(unittest.TestCase):
    def test_grocery_completion_and_list_scope(self):
        result = shopping([
            {'id': '1', 'shopping_list_id': '2', 'product_id': '4', 'amount': '2', 'done': '0'},
            {'id': 2, 'shopping_list_id': 2, 'note': 'Tea', 'done': '1'},
            {'id': 3, 'shopping_list_id': 3, 'done': 0},
        ], [{'id': 2, 'name': 'Shop'}], [{'id': 4, 'name': 'Milk'}], 2)
        self.assertEqual((result.remaining_items, result.total_items), (1, 2))
        self.assertEqual(result.items[0].name, 'Milk')
        self.assertTrue(result.items[1].done)

    def test_missing_completion_is_not_assumed_outstanding(self):
        with self.assertRaises(ValueError):
            shopping([{'id': 1}], [], [], None)

    def test_empty_and_multiple_meals_and_boundaries(self):
        plan = [dict(id=i, day=d, section_id=s, type=t, recipe_id=8, note='Leftovers') for i,d,s,t in [
            (1,'2026-11-15',2,'recipe'), (2,'2026-11-15',2,'note'),
            (3,'2026-11-15',1,'recipe'), (4,'2026-11-22',2,'recipe')]]
        week = meals(plan, [{'id': 8, 'name': 'Soup'}], [], [{'id': 2, 'name': 'Dinner'}], TODAY, None)
        self.assertEqual(len(week), 7)
        self.assertEqual([m.name for m in week[0].meals], ['Soup', 'Leftovers'])
        self.assertFalse(week[1].planned)
        self.assertEqual(week[-1].date, date(2026,11,21))

    def test_dinner_requires_unambiguous_section(self):
        with self.assertRaises(ValueError):
            meals([], [], [], [], TODAY, None)
        week = meals([], [], [], [{'id': -1, 'name': None}], TODAY, -1)
        self.assertFalse(week[0].planned)

    def test_household_date_near_utc_midnight(self):
        instant = datetime(2026,11,16,1,tzinfo=timezone.utc)
        self.assertEqual(instant.astimezone(ZoneInfo('America/Denver')).date(), TODAY)

class ApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_partial_failure_preserves_meals_and_stock(self):
        class PartialClient:
            async def get(self, path, params=None):
                if path == 'objects/shopping_list':
                    raise GrocyUnavailable()
                return {
                    'stock/volatile': {'missing_products': [{'id': '4', 'name': 'Milk', 'amount_missing': '2'}]},
                    'objects/meal_plan_sections': [{'id': 2, 'name': 'Dinner'}],
                    'objects/meal_plan': [{'id': 1, 'day': '2026-11-15', 'section_id': 2, 'type': 'recipe', 'recipe_id': 8}],
                    'objects/recipes': [{'id': 8, 'name': 'Soup'}],
                }.get(path, [])
        result = await build_dashboard(PartialClient(), TODAY, 'UTC')
        self.assertFalse(result.shopping_list.available)
        self.assertEqual(result.dinner_tonight.meals[0].name, 'Soup')
        self.assertEqual(result.inventory.low_stock[0].amount_missing, 2)

    async def test_empty_contract_and_filtered_meal_request(self):
        def handler(request):
            self.assertEqual(request.headers['GROCY-API-KEY'], 'test')
            path = request.url.path
            if path.endswith('meal_plan'):
                self.assertEqual(request.url.params.get_list('query[]'), ['day>=2026-11-15','day<=2026-11-21'])
            payload = {'missing_products': []} if path.endswith('volatile') else ([{'id': 2, 'name': 'Dinner'}] if path.endswith('sections') else [])
            return httpx.Response(200,json=payload)
        async with httpx.AsyncClient(base_url='http://mock/api/', headers={'GROCY-API-KEY':'test'}, transport=httpx.MockTransport(handler)) as http:
            result = await build_dashboard(GrocyClient(http), TODAY, 'UTC')
        self.assertTrue(result.shopping_list.available)
        self.assertEqual(result.shopping_list.total_items, 0)
        self.assertFalse(result.dinner_tonight.planned)
        self.assertTrue(result.inventory.available)

    async def test_upstream_failure_and_bad_json_are_safe(self):
        for response in [httpx.Response(401,text='SECRET'), httpx.Response(200,text='invalid')]:
            async with httpx.AsyncClient(base_url='http://mock/api/', transport=httpx.MockTransport(lambda r: response)) as http:
                result = await build_dashboard(GrocyClient(http), TODAY, 'UTC')
            self.assertIsNone(result.shopping_list.remaining_items)
            self.assertIsNone(result.dinner_tonight.planned)
            self.assertFalse(result.inventory.available)
            self.assertNotIn('SECRET', result.model_dump_json())

    async def test_timeout(self):
        def timeout(request):
            raise httpx.ReadTimeout('secret', request=request)
        async with httpx.AsyncClient(base_url='http://mock/', transport=httpx.MockTransport(timeout)) as http:
            with self.assertRaises(GrocyUnavailable):
                await GrocyClient(http).get('objects/products')

class RouteTests(unittest.TestCase):
    def test_health_and_registration_and_missing_config(self):
        with TestClient(app) as client, patch.dict(os.environ, {}, clear=True):
            self.assertEqual(client.get('/health').json(), {'status':'healthy'})
            self.assertEqual(client.get('/api/health').status_code,200)
            self.assertIn('/api/dashboard', client.get('/openapi.json').json()['paths'])
            self.assertEqual(client.get('/api/dashboard').status_code,503)

    def test_route_serializes_typed_response_without_network(self):
        async def fake(*args, **kwargs):
            class EmptyClient:
                async def get(self, path, params=None):
                    return {'missing_products': []} if path.endswith('volatile') else []
            return await build_dashboard(EmptyClient(), TODAY, 'UTC')
        with patch.dict(os.environ, {'GROCY_URL':'http://mock','GROCY_API_KEY':'secret','HOUSEHOLD_TIMEZONE':'UTC'}), patch('app.routes.dashboard.build_dashboard',side_effect=fake), TestClient(app) as client:
            response = client.get('/api/dashboard')
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.json()['today'],'2026-11-15')
            self.assertEqual(len(response.json()['upcoming_meals']),7)
            self.assertEqual(response.headers['cache-control'],'no-store')
            self.assertNotIn('secret',response.text)

if __name__ == '__main__':
    unittest.main()
