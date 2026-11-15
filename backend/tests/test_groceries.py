import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from app.main import app
from mock_grocy import MockGrocy


class GroceryApiTests(unittest.TestCase):
    def setUp(self):
        self.fixture = MockGrocy()
        # Exercise the real dependency/error handling and transport with a local mock transport.
        original_client = httpx.AsyncClient
        self.http_patch = patch('app.dependencies.httpx.AsyncClient', side_effect=lambda **kw: original_client(**kw, transport=httpx.MockTransport(self.fixture)))
        self.http_patch.start()
        self.env = patch.dict(os.environ, {'GROCY_URL': 'http://mock', 'GROCY_API_KEY': 'test-key', 'HOUSEHOLD_TIMEZONE': 'UTC'}, clear=True)
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()
        self.http_patch.stop()

    def items(self, list_id=2):
        response = self.client.get(f'/api/shopping-lists/{list_id}/items')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_multiple_lists_and_default_selection(self):
        with patch.dict(os.environ, {'GROCY_SHOPPING_LIST_ID': '3'}):
            response = self.client.get('/api/shopping-lists')
        self.assertEqual(response.json()['default_list_id'], 3)
        self.assertEqual([r['id'] for r in response.json()['lists']], [2, 3])
        self.assertEqual(self.items(2)['items'][0]['name'], 'Milk')
        self.assertEqual(self.items(3)['items'][0]['name'], 'Paper bags')
        self.assertEqual(self.items(3)['remaining_items'], 0)
        self.assertEqual(response.headers['cache-control'], 'no-store')

    def test_empty_list_and_missing_list(self):
        self.fixture.items = []
        result = self.items()
        self.assertEqual((result['remaining_items'], result['total_items'], result['items']), (0, 0, []))
        self.assertEqual(self.client.get('/api/shopping-lists/99/items').status_code, 404)
        self.fixture.lists = []
        self.assertEqual(self.client.get('/api/shopping-lists').json()['lists'], [])

    def test_search_case_insensitive_active_only_and_safe_text(self):
        response = self.client.get('/api/products', params={'q': 'mIL'})
        self.assertEqual(response.json(), [{'id': 10, 'name': 'Milk', 'unit_id': 5, 'unit_name': 'bottle'}])
        self.assertEqual(self.client.get('/api/products', params={'q': "' OR 1=1"}).json(), [])
        self.assertEqual(self.client.get('/api/products', params={'q': 'inactive'}).json(), [])
        self.assertEqual(self.client.get('/api/products', params={'q': ' '}).json(), [])

    def test_add_existing_product_and_free_text_without_merging(self):
        response = self.client.post('/api/shopping-lists/2/items', json={'product_id': 10, 'amount': 3, 'note': 'For baking'})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.fixture.items[-1]['qu_id'], 5)
        self.assertEqual(self.fixture.items[0]['amount'], 2)
        self.assertEqual(self.fixture.items[0]['note'], 'Whole milk')
        self.assertEqual(self.items()['remaining_items'], 2)
        response = self.client.post('/api/shopping-lists/3/items', json={'amount': 1, 'note': '  Sponges  '})
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(self.fixture.items[-1]['product_id'])
        self.assertEqual(self.fixture.items[-1]['note'], 'Sponges')
        self.assertEqual(self.items(3)['remaining_items'], 1)

    def test_completion_undo_edits_and_delete_use_entry_id_and_preserve_relationships(self):
        base = '/api/shopping-lists/2/items/101'
        original = dict(self.fixture.items[0])
        for done, remaining in [(True, 0), (False, 1)]:
            response = self.client.patch(base, json={'done': done})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self.items()['remaining_items'], remaining)
            self.assertEqual(self.fixture.items[0]['done'], int(done))
        self.assertEqual(self.client.patch(base, json={'amount': 4.5, 'note': 'Semi-skimmed'}).status_code, 200)
        updated = self.fixture.items[0]
        for key in ['product_id', 'shopping_list_id', 'qu_id', 'userfields']:
            self.assertEqual(updated[key], original[key])
        writes = [(p, data) for method, p, data in self.fixture.requests if method == 'PUT']
        self.assertEqual(writes, [('objects/shopping_list/101', {'done': 1}), ('objects/shopping_list/101', {'done': 0}),
                                  ('objects/shopping_list/101', {'amount': 4.5, 'note': 'Semi-skimmed'})])
        self.assertEqual(self.client.delete(base).status_code, 200)
        self.assertEqual(self.items()['total_items'], 0)
        self.assertFalse(any('purchase' in p or 'add-product' in p for _, p, _ in self.fixture.requests))

    def test_cross_list_changes_and_product_id_confusion_are_rejected(self):
        for method, url in [('PATCH','/api/shopping-lists/3/items/101'), ('DELETE','/api/shopping-lists/3/items/101'), ('PATCH','/api/shopping-lists/2/items/10')]:
            response = self.client.request(method, url, json={'done': True} if method == 'PATCH' else None)
            self.assertEqual(response.status_code, 404)
        self.assertFalse(any(method in ('PUT', 'DELETE') for method, _, _ in self.fixture.requests))

    def test_units_are_stock_units_and_display_unit_is_retained(self):
        item = self.items()['items'][0]
        self.assertEqual((item['amount'], item['unit_name'], item['unit_id'], item['display_unit_id']), (2, 'bottle', 5, 6))

    def test_validation_rejects_unsafe_or_empty_changes(self):
        for payload in [{'amount': True, 'note': 'x'}, {'amount': 0, 'note': 'x'}, {'amount': -1, 'note': 'x'}, {'amount': 'NaN', 'note': 'x'},
                        {'product_id': -1}, {'product_id': True}, {'note': ' '}, {'note': 'a'*2001},
                        {'product_id': 10, 'qu_id': 6}]:
            with self.subTest(payload=str(payload)[:80]):
                self.assertEqual(self.client.post('/api/shopping-lists/2/items', json=payload).status_code, 422)
        for payload in [{}, {'done': None}, {'done': 'false'}, {'amount': None}, {'product_id': 11}, {'shopping_list_id': 3}]:
            self.assertEqual(self.client.patch('/api/shopping-lists/2/items/101', json=payload).status_code, 422)
        self.assertEqual(self.client.patch('/api/shopping-lists/3/items/102', json={'note': ''}).status_code, 422)
        self.assertEqual(self.client.get('/api/shopping-lists/0/items').status_code, 422)
        self.assertEqual(self.client.post('/api/shopping-lists/2/items', json={'product_id': 12}).status_code, 422)
        self.assertEqual(self.client.post('/api/shopping-lists/2/items', json={'product_id': 99}).status_code, 404)
        self.assertFalse(any(method in ('POST','PUT','DELETE') for method, _, _ in self.fixture.requests))

    def test_upstream_errors_timeouts_bad_json_and_missing_config_are_sanitized(self):
        for failure in [401, 500, 'timeout', 'malformed']:
            self.fixture.failure = failure
            response = self.client.get('/api/shopping-lists')
            self.assertEqual(response.status_code, 502, response.text)
            self.assertNotIn('SECRET', response.text)
            self.assertNotIn('test-key', response.text)
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.client.get('/api/shopping-lists').status_code, 503)

    def test_write_failure_is_not_claimed_success_or_retried(self):
        original = self.fixture.__call__
        def fail_write(request):
            if request.method == 'PUT':
                self.fixture.requests.append(('PUT', request.url.path, None))
                return httpx.Response(500, text='SECRET')
            return original(request)
        self.http_patch.stop()
        original_client = httpx.AsyncClient
        with patch('app.dependencies.httpx.AsyncClient', side_effect=lambda **kw: original_client(**kw, transport=httpx.MockTransport(fail_write))):
            response = self.client.patch('/api/shopping-lists/2/items/101', json={'done': True})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('SECRET', response.text)
        self.assertEqual(sum(method == 'PUT' for method, _, _ in self.fixture.requests), 1)
        self.assertEqual(self.fixture.items[0]['done'], 0)

    def test_dashboard_counts_follow_grocery_changes(self):
        self.client.post('/api/shopping-lists/2/items', json={'product_id': 11})
        self.client.patch('/api/shopping-lists/2/items/101', json={'done': True})
        dashboard = self.client.get('/api/dashboard')
        self.assertEqual(dashboard.status_code, 200)
        self.assertEqual(dashboard.json()['shopping_list']['remaining_items'], 1)
        self.assertEqual(self.client.get('/health').status_code, 200)


if __name__ == '__main__':
    unittest.main()
