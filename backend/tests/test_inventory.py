import asyncio
import copy
import os
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app.main import create_app
from mock_grocy import MockGrocy

class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = MockGrocy()
        application = create_app()
        application.state.grocy_transport = httpx.MockTransport(self.fixture)
        self.env = patch.dict(os.environ, {'GROCY_URL': 'http://mock', 'GROCY_API_KEY': 'test', 'HOUSEHOLD_TIMEZONE': 'UTC'}, clear=True)
        self.env.start()
        self.client = TestClient(application)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()

    def detail(self, product_id=10):
        result = self.client.get(f'/api/inventory/products/{product_id}')
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def change(self, **changes):
        detail = self.detail()
        return dict(amount=1, unit_id=5, expected_version=detail['product']['version']) | changes

    def add(self, **changes):
        return self.client.post('/api/inventory/products/10/add', json=self.change(**({'location_id': 1, 'best_before_date': '2030-12-20'} | changes)))

    def consume(self, **changes):
        return self.client.post('/api/inventory/products/10/consume', json=self.change(**({'entry_id': 201} | changes)))

    def writes(self):
        return [r for r in self.fixture.requests if r[0] != 'GET']

    def test_browse_empty_and_multiple_locations_dates_and_opened_state(self):
        self.fixture.products[0]['min_stock_amount'] = 4
        response = self.client.get('/api/inventory')
        self.assertEqual(response.status_code, 200, response.text)
        products = response.json()['products']
        self.assertEqual(len(products), 1)
        self.assertEqual((products[0]['amount'], products[0]['unit_name'], products[0]['running_low']), (3, 'bottle', True))
        self.assertEqual([e['location_name'] for e in products[0]['entries']], ['Fridge', 'Cupboard'])
        self.assertTrue(products[0]['entries'][1]['opened'])
        self.assertNotIn('stock_id', response.text)
        self.fixture.stock.clear()
        self.assertEqual(self.client.get('/api/inventory').json()['products'], [])
        self.assertEqual(self.writes(), [])

    def test_add_stock_units_and_explicit_date_location_only(self):
        unrelated = copy.deepcopy((self.fixture.items, self.fixture.meals, self.fixture.products, self.fixture.stock))
        response = self.add(amount=2, note='Keep cool')
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.detail()['product']['amount'], 5)
        self.assertEqual(self.writes(), [('POST', 'stock/products/10/add', {'amount': 2.0, 'transaction_type': 'purchase', 'location_id': 1, 'stock_label_type': 0, 'note': 'Keep cool', 'best_before_date': '2030-12-20'})])
        self.assertEqual((self.fixture.items, self.fixture.meals, self.fixture.products, self.fixture.stock[:2]), unrelated)

    def test_consume_resolves_private_batch_id_and_leaves_other_entries_untouched(self):
        untouched = copy.deepcopy((self.fixture.stock[1], self.fixture.items, self.fixture.meals, self.fixture.products))
        response = self.consume(amount=1.5)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.fixture.stock[0]['amount'], .5)
        self.assertEqual(self.detail()['product']['amount'], 1.5)
        self.assertEqual(self.writes(), [('POST', 'stock/products/10/consume', {'amount': 1.5, 'stock_entry_id': 'batch-fridge', 'location_id': 1, 'spoiled': False, 'allow_subproduct_substitution': False})])
        self.assertEqual((self.fixture.stock[1], self.fixture.items, self.fixture.meals, self.fixture.products), untouched)

    def test_insufficient_selected_batch_never_falls_back_to_other_stock(self):
        before = copy.deepcopy(self.fixture.stock)
        self.assertEqual(self.consume(amount=2.5).status_code, 422)
        self.assertEqual(self.fixture.stock, before)
        self.assertEqual(self.writes(), [])

    def test_unknown_batch_and_ambiguous_group_are_rejected(self):
        self.assertEqual(self.consume(entry_id=999).status_code, 409)
        self.fixture.stock.append(dict(self.fixture.stock[0], id=203, open=1))
        detail = self.detail()
        self.assertFalse(detail['product']['entries'][0]['selectable'])
        self.assertEqual(self.consume().status_code, 409)
        self.assertEqual(self.writes(), [])

    def test_stale_quantity_unit_and_location_rejected_before_write(self):
        change = self.change(entry_id=201)
        self.fixture.stock[0]['amount'] = .5
        self.assertEqual(self.client.post('/api/inventory/products/10/consume', json=change).status_code, 409)
        self.assertEqual(self.consume(unit_id=6).status_code, 409)
        self.assertEqual(self.add(location_id=999).status_code, 422)
        self.assertEqual(self.writes(), [])

    def test_never_expire_is_explicit_and_dates_not_fabricated(self):
        body = self.change(location_id=2, never_expires=True)
        response = self.client.post('/api/inventory/products/10/add', json=body)
        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(self.writes()[0][2]['best_before_date'], '2999-12-31')
        self.assertTrue(self.detail()['product']['entries'][-1]['never_expires'])
        self.assertEqual(self.client.post('/api/inventory/products/10/add', json=self.change(location_id=1)).status_code, 422)
        self.assertEqual(len(self.writes()), 1)

    def test_disabled_date_tracking_omits_dates_and_uses_configured_location(self):
        self.fixture.config['FEATURE_FLAG_STOCK_BEST_BEFORE_DATE_TRACKING'] = False
        self.fixture.config['FEATURE_FLAG_STOCK_LOCATION_TRACKING'] = False
        self.assertEqual(self.client.post('/api/inventory/products/10/add', json=self.change(location_id=2)).status_code, 422)
        self.assertEqual(self.client.post('/api/inventory/products/10/add', json=self.change(location_id=1)).status_code, 201)
        self.assertNotIn('best_before_date', self.writes()[0][2])

    def test_unsupported_product_flags_or_missing_flags_defer_mutations(self):
        for changes in ({'enable_tare_weight_handling': 1}, {'no_own_stock': 1}, {'active': 0}):
            original = self.fixture.products[0].copy()
            self.fixture.products[0].update(changes)
            self.assertIsNotNone(self.detail()['product']['manage_reason'])
            self.assertEqual(self.consume().status_code, 409)
            self.fixture.products[0] = original
        del self.fixture.products[0]['enable_tare_weight_handling']
        self.assertEqual(self.add().status_code, 409)
        self.assertEqual(self.writes(), [])

    def test_shopping_automation_blocks_stock_writes(self):
        self.fixture.settings['shopping_list_auto_add_below_min_stock_amount'] = '1'
        self.assertEqual(self.add().status_code, 409)
        self.assertEqual(self.consume().status_code, 409)
        self.assertEqual(self.writes(), [])

    def test_invalid_contracts_reject_without_write(self):
        base = self.change(location_id=1, best_before_date='2030-12-01')
        cases = [{'amount': 0}, {'amount': -1}, {'amount': True}, {'amount': '2'}, {'amount': 1e10}, {'unit_id': True}, {'location_id': 0}, {'stock_id': 'other'}, {'best_before_date': '2030-02-30'}, {'best_before_date': 123}, {'best_before_date': '2030-12-01T00:00:00'}, {'best_before_date': '2999-12-31'}, {'never_expires': True}]
        for changes in cases:
            with self.subTest(changes=changes):
                result = self.client.post('/api/inventory/products/10/add', json=base | changes)
                self.assertEqual(result.status_code, 422, result.text)
        for value in ('NaN', 'Infinity', '-Infinity'):
            payload = ('{"amount":'+value+',"unit_id":5,"location_id":1,"expected_version":"'+base['expected_version']+'"}')
            self.assertEqual(self.client.post('/api/inventory/products/10/add', content=payload, headers={'content-type':'application/json'}).status_code, 422)
        self.assertEqual(self.writes(), [])

    def test_failed_write_is_sanitized_and_not_retried(self):
        original = self.fixture.__call__
        def fail(request):
            if request.method == 'POST':
                self.fixture.requests.append(('POST', request.url.path, None))
                raise httpx.ReadTimeout('SECRET', request=request)
            return original(request)
        self.client.app.state.grocy_transport = httpx.MockTransport(fail)
        result = self.add()
        self.assertEqual(result.status_code, 502)
        self.assertEqual(result.json()['detail']['code'], 'uncertain')
        self.assertNotIn('SECRET', result.text)
        self.assertEqual(len(self.writes()), 1)

    def test_timeout_after_persistence_and_malformed_success_remain_uncertain(self):
        original = self.fixture.__call__
        for malformed in (False, True):
            def fail_after(request):
                response = original(request)
                if request.method == 'POST':
                    if malformed:
                        return httpx.Response(200, json=[])
                    raise httpx.ReadTimeout('SECRET saved', request=request)
                return response
            self.client.app.state.grocy_transport = httpx.MockTransport(fail_after)
            result = self.add()
            self.assertEqual(result.status_code, 502, result.text)
            self.assertEqual(result.json()['detail']['code'], 'uncertain')
        self.assertEqual(len(self.writes()), 2)
        self.assertEqual(self.detail()['product']['amount'], 5)

    def test_inactive_or_other_product_batch_is_not_consumed(self):
        self.assertEqual(self.client.post('/api/inventory/products/11/consume', json=self.change(entry_id=201)).status_code, 409)
        self.assertEqual(self.writes(), [])


    def test_replaying_a_confirmed_request_is_stale_and_never_writes_twice(self):
        payload = self.change(location_id=1, best_before_date='2030-12-20')
        first = self.client.post('/api/inventory/products/10/add', json=payload)
        second = self.client.post('/api/inventory/products/10/add', json=payload)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 409, second.text)
        self.assertEqual(second.json()['detail']['code'], 'stale')
        self.assertEqual(len(self.writes()), 1)

    def test_concurrent_confirmations_with_the_same_snapshot_write_once(self):
        payload = self.change(location_id=1, best_before_date='2030-12-20')
        original = self.fixture.__call__
        async def delayed(request):
            if request.method == 'POST':
                await asyncio.sleep(.02)
            return original(request)
        self.client.app.state.grocy_transport = httpx.MockTransport(delayed)
        async def send():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.client.app), base_url='http://test') as client:
                return await asyncio.gather(*[client.post('/api/inventory/products/10/add', json=payload) for _ in range(2)])
        results = asyncio.run(send())
        self.assertEqual(sorted(r.status_code for r in results), [201, 409])
        self.assertEqual(len(self.writes()), 1)

    def test_changed_unit_name_location_or_feature_flags_invalidates_review(self):
        for kind in ('unit', 'location', 'feature'):
            with self.subTest(kind=kind):
                units, locations, config = copy.deepcopy((self.fixture.units, self.fixture.locations, self.fixture.config))
                payload = self.change(entry_id=201)
                if kind == 'unit':
                    self.fixture.units[0]['name'] = 'Renamed unit'
                elif kind == 'location':
                    self.fixture.locations[0]['name'] = 'Renamed place'
                else:
                    self.fixture.config['FEATURE_FLAG_STOCK_LOCATION_TRACKING'] = False
                response = self.client.post('/api/inventory/products/10/consume', json=payload)
                self.assertEqual(response.status_code, 409, response.text)
                self.fixture.units, self.fixture.locations, self.fixture.config = units, locations, config
        self.assertEqual(self.writes(), [])

    def test_partial_or_wrong_batch_log_is_uncertain_without_rollback_or_retry(self):
        original = self.fixture.__call__
        initial = copy.deepcopy(self.fixture.stock)
        for kind in ('partial', 'batch', 'location'):
            with self.subTest(kind=kind):
                self.fixture.stock = copy.deepcopy(initial)
                def incompatible(request):
                    if request.method != 'POST':
                        return original(request)
                    if kind == 'partial':
                        import json
                        body = json.loads(request.content)
                        body['amount'] = .5
                        request = httpx.Request(request.method, request.url, json=body)
                    response = original(request)
                    logs = response.json()
                    if kind == 'batch':
                        logs[0]['stock_id'] = 'different-batch'
                    if kind == 'location':
                        logs[0]['location_id'] = 2
                    return httpx.Response(200, json=logs)
                self.client.app.state.grocy_transport = httpx.MockTransport(incompatible)
                response = self.consume()
                self.assertEqual(response.status_code, 502, response.text)
                self.assertEqual(response.json()['detail']['code'], 'uncertain')
                self.assertEqual(self.fixture.stock[0]['amount'], 1.5 if kind == 'partial' else 1)
                self.assertEqual(self.fixture.stock[1], initial[1])
        self.assertEqual(len(self.writes()), 3)

    def test_low_stock_comes_from_grocy_volatile_not_a_local_threshold_guess(self):
        original = self.fixture.__call__
        self.fixture.products[0]['min_stock_amount'] = 0
        def volatile(request):
            if request.url.path.endswith('/stock/volatile'):
                return httpx.Response(200, json={'missing_products': [{'id': 10}]})
            return original(request)
        self.client.app.state.grocy_transport = httpx.MockTransport(volatile)
        response = self.client.get('/api/inventory')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['products'][0]['running_low'])
        self.assertTrue(self.detail()['product']['running_low'])
        self.assertEqual(self.writes(), [])

    def test_missing_or_conflicting_feature_settings_block_before_writes(self):
        self.fixture.config['GROCY_FEATURE_FLAG_STOCK_LOCATION_TRACKING'] = False
        self.assertEqual(self.client.get('/api/inventory').status_code, 502)
        del self.fixture.config['GROCY_FEATURE_FLAG_STOCK_LOCATION_TRACKING']
        payload = self.change(entry_id=201)
        del self.fixture.config['FEATURE_FLAG_STOCK_LOCATION_TRACKING']
        self.assertEqual(self.client.post('/api/inventory/products/10/consume', json=payload).status_code, 502)
        self.assertEqual(self.writes(), [])

if __name__ == '__main__':
    unittest.main()
