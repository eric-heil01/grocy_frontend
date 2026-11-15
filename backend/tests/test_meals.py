import os
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app.main import create_app
from mock_grocy import MockGrocy


class MealTests(unittest.TestCase):
    def setUp(self):
        self.fixture = MockGrocy()
        app = create_app()
        app.state.grocy_transport = httpx.MockTransport(self.fixture)
        self.env = patch.dict(os.environ, {'GROCY_URL': 'http://mock', 'GROCY_API_KEY': 'test', 'HOUSEHOLD_TIMEZONE': 'America/Denver', 'GROCY_DINNER_SECTION_ID': ''}, clear=True)
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()

    def add(self, **changes):
        return self.client.post('/api/meals', json=dict(day='2026-12-31', recipe_id=20, recipe_servings=2, **changes))

    def week(self):
        response = self.client.get('/api/meals?start=2026-12-31')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_empty_week_and_boundary(self):
        result = self.week()
        self.assertEqual(len(result['days']), 7)
        self.assertEqual(result['days'][-1]['date'], '2027-01-06')
        self.assertTrue(all(d['available'] and not d['planned'] for d in result['days']))
        self.assertEqual(result['timezone'], 'America/Denver')
        queries = [r for r in self.fixture.requests if r[1] == 'objects/meal_plan']
        self.assertEqual(len(queries), 1)

    def test_recipe_search(self):
        self.assertEqual(self.client.get('/api/recipes?q=pAs').json(), [{'id':20, 'name':'Pasta', 'base_servings':2}])
        self.assertEqual(self.client.get('/api/recipes?q=internal').json(), [])
        self.assertEqual(self.client.get('/api/recipes?q=missing').json(), [])

    def test_add_multiple_update_individual_and_preserve(self):
        self.assertEqual(self.add().status_code, 201)
        self.assertEqual(self.add().status_code, 201)
        self.assertEqual(len(self.week()['days'][0]['meals']), 2)
        first = self.fixture.meals[0]
        first.update(done=1, note='keep', userfields={'keep': 'yes'}, product_id=None)
        original = dict(first)
        for changes in ({'day':'2027-01-01'}, {'recipe_id':21}, {'recipe_servings':3.5}):
            response = self.client.patch(f"/api/meals/{first['id']}", json=changes)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.fixture.requests[-1][2], changes)
        self.assertEqual((first['done'], first['note'], first['userfields']), (original['done'], original['note'], original['userfields']))
        self.assertEqual(len(self.week()['days'][0]['meals']), 1)
        self.assertEqual(self.week()['days'][1]['meals'][0]['name'], 'Curry')
        self.assertEqual(self.client.delete(f"/api/meals/{first['id']}").status_code, 200)
        self.assertEqual(len(self.fixture.meals), 1)
        writes = [r for r in self.fixture.requests if r[0] != 'GET']
        self.assertTrue(all(r[1].startswith('objects/meal_plan') for r in writes))

    def test_preserve_products_notes_and_cross_section(self):
        self.fixture.meals = [
            {'id':1,'day':'2026-12-31','section_id':1,'type':'product','product_id':10},
            {'id':2,'day':'2026-12-31','section_id':1,'type':'note','note':'Leftovers'},
            {'id':3,'day':'2026-12-31','section_id':2,'type':'recipe','recipe_id':20}]
        result = self.week()['days'][0]['meals']
        self.assertEqual([r['name'] for r in result], ['Milk', 'Leftovers'])
        self.assertEqual(self.client.patch('/api/meals/1', json={'day':'2027-01-01'}).status_code, 422)
        self.assertEqual(self.client.patch('/api/meals/3', json={'recipe_id':21}).status_code, 404)
        self.assertEqual(self.client.delete('/api/meals/3').status_code, 404)
        self.assertFalse(any(r[0] != 'GET' for r in self.fixture.requests))
        self.assertEqual(self.client.delete('/api/meals/2').status_code, 200)
        self.assertEqual([r['id'] for r in self.fixture.meals], [1,3])

    def test_invalid_requests(self):
        for changes in ({'recipe_id':0}, {'recipe_id':True}, {'recipe_id':22}, {'recipe_id':999}, {'day':'2026-02-30'}, {'day':'20260101'}, {'day':'2026-01-01T00:00:00'}, {'recipe_servings':0}, {'recipe_servings':True}, {'recipe_servings':'NaN'}, {'section_id':2}):
            payload = {'day':'2026-12-31','recipe_id':20} | changes
            self.assertEqual(self.client.post('/api/meals', json=payload).status_code, 422, payload)
        for payload in ({}, {'day':None}, {'recipe_id':None}, {'type':'note'}, {'recipe_servings':None}):
            self.assertEqual(self.client.patch('/api/meals/1', json=payload).status_code, 422)
        for start in ('2026-02-30','20260101','9999-12-31'):
            self.assertEqual(self.client.get('/api/meals', params={'start':start}).status_code, 422)
        self.assertEqual(self.client.delete('/api/meals/0').status_code, 422)
        self.assertEqual(self.client.delete('/api/meals/999').status_code, 404)
        self.assertFalse(any(r[0] != 'GET' for r in self.fixture.requests))

    def test_sections_and_unsectioned(self):
        self.fixture.sections = []
        self.assertEqual(self.client.get('/api/meals').status_code, 503)
        with patch.dict(os.environ, {'GROCY_DINNER_SECTION_ID':'-1'}):
            self.assertEqual(self.add().status_code, 201)
            self.assertEqual(self.fixture.meals[-1]['section_id'], -1)
            self.assertTrue(self.week()['days'][0]['planned'])
        with patch.dict(os.environ, {'GROCY_DINNER_SECTION_ID':'99'}):
            self.assertEqual(self.add().status_code, 503)
        self.fixture.sections = [{'id':1,'name':'Dinner'},{'id':2,'name':'dinner'}]
        self.assertEqual(self.add().status_code, 503)

    def test_sanitized_failures(self):
        for failure in ('timeout', 'malformed', 500):
            self.fixture.failure = failure
            for response in (self.client.get('/api/meals'), self.add(), self.client.patch('/api/meals/1', json={'recipe_servings':2}), self.client.delete('/api/meals/1')):
                self.assertEqual(response.status_code, 502)
                self.assertNotIn('SECRET', response.text)

    def test_timezone_today_at_utc_boundary(self):
        instant = datetime(2027,1,1,2,tzinfo=timezone.utc)
        with patch('app.calendar_config.datetime') as clock:
            clock.now.side_effect = lambda zone: instant.astimezone(zone)
            result = self.client.get('/api/meals').json()
            self.assertEqual(result['today'], '2026-12-31')
            self.assertEqual(result['start'], '2026-12-31')
        with patch.dict(os.environ, {'HOUSEHOLD_TIMEZONE':'invalid'}):
            self.assertEqual(self.client.get('/api/meals').status_code, 503)

    def test_write_timeouts_after_persistence_are_not_retried(self):
        self.assertEqual(self.add().status_code, 201)
        entry_id = self.fixture.meals[0]['id']
        def uncertain(request):
            response = self.fixture(request)
            if request.method != 'GET':
                raise httpx.ReadTimeout('SECRET after persistence', request=request)
            return response
        self.client.app.state.grocy_transport = httpx.MockTransport(uncertain)
        for method, path, payload in (
            ('POST', '/api/meals', {'day':'2026-12-31','recipe_id':20}),
            ('PATCH', f'/api/meals/{entry_id}', {'recipe_servings':5}),
            ('DELETE', f'/api/meals/{entry_id}', None),
        ):
            response = self.client.request(method, path, json=payload)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('SECRET', response.text)
        self.assertEqual(len(self.fixture.meals), 1)
        self.assertEqual(len([r for r in self.fixture.requests if r[0] == 'PUT']), 1)
        self.assertEqual(len([r for r in self.fixture.requests if r[0] == 'DELETE']), 1)

    def test_malformed_external_records_fail_safely(self):
        self.fixture.recipes[0]['name'] = {'unexpected':'SECRET'}
        response = self.client.get('/api/recipes?q=pasta')
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('SECRET', response.text)
        self.fixture.recipes = []
        self.fixture.meals = [{'id':1,'day':'2026-12-31','section_id':1,'type':'unsupported'}]
        self.assertEqual(self.client.get('/api/meals?start=2026-12-31').status_code, 502)
