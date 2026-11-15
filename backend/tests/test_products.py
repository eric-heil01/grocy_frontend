import copy
import os
import unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app.main import create_app
from mock_grocy import MockGrocy


class ProductTests(unittest.TestCase):
    def setUp(self):
        self.fixture = MockGrocy()
        app = create_app()
        app.state.grocy_transport = httpx.MockTransport(self.fixture)
        self.env = patch.dict(os.environ, {'GROCY_URL':'http://mock','GROCY_API_KEY':'test'}, clear=True)
        self.env.start()
        self.client = TestClient(app)
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.env.stop()

    def create(self, **overrides):
        return self.client.post('/api/product-catalog', json={'name':'Coffee','unit_id':5,'location_id':2} | overrides)

    def detail(self, product_id=10):
        response = self.client.get(f'/api/product-catalog/{product_id}')
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def update(self, changes, product_id=10, version=None):
        return self.client.patch(f'/api/product-catalog/{product_id}', json={'expected_version':version or self.detail(product_id)['version']} | changes)

    def test_browse_search_detail_and_options(self):
        catalog = self.client.get('/api/product-catalog').json()
        self.assertEqual(len(catalog), 3)
        self.assertEqual(sum(not p['active'] for p in catalog), 1)
        self.assertEqual(self.client.get('/api/product-catalog?q=mIL').json()[0]['name'], 'Milk')
        self.assertEqual(self.client.get('/api/product-catalog?q=unknown').json(), [])
        detail = self.detail()
        self.assertEqual((detail['unit_name'], detail['purchase_unit_name'], detail['location_name']), ('bottle','pack','Fridge'))
        options = self.client.get('/api/product-catalog/options').json()
        self.assertEqual([p['id'] for p in options['units']], [5,6])
        self.assertEqual([p['id'] for p in options['locations']], [1,2])
        self.assertEqual(len(detail['version']), 64)
        self.assertNotIn('userfields', detail)

    def test_create_verified_fields_same_units_without_inventory_or_shopping(self):
        items, meals, recipes = copy.deepcopy((self.fixture.items,self.fixture.meals,self.fixture.recipes))
        response = self.create()
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual((created['name'],created['location_name'],created['min_stock_amount']), ('Coffee','Cupboard',0))
        writes = [r for r in self.fixture.requests if r[0] != 'GET']
        self.assertEqual(writes, [('POST','objects/products', {'name':'Coffee','location_id':2,'qu_id_stock':5,'qu_id_purchase':5,'qu_id_consume':5,'qu_id_price':5,'min_stock_amount':0.0,'default_best_before_days':0,'active':1})])
        self.assertEqual((items, meals, recipes), (self.fixture.items,self.fixture.meals,self.fixture.recipes))
        self.assertEqual(self.client.get('/api/products?q=coffee').json()[0]['id'], created['id'])
        self.assertEqual(self.detail(created['id'])['version'],created['version'])

    def test_creation_and_edit_optional_fields(self):
        result = self.create(min_stock_amount=1.5, default_best_before_days=7)
        self.assertEqual(result.status_code, 201, result.text)
        product_id = result.json()['id']
        response = self.update({'default_best_before_days':-1,'min_stock_amount':0}, product_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['default_best_before_days'], -1)

    def test_duplicate_names_normalize_whitespace_case_unicode_and_inactive(self):
        for name in ('  mILK ', 'Milk', 'inactive   product'):
            response = self.create(name=name, allow_similar_name=True)
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['detail']['code'], 'duplicate')
        self.assertEqual(len(self.fixture.products),3)
        self.assertFalse(any(r[0] != 'GET' for r in self.fixture.requests))

    def test_similar_names_require_deliberate_confirmation(self):
        response = self.create(name='Milky')
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['detail']['code'], 'similar')
        self.assertEqual(self.create(name='Milky',allow_similar_name=True).status_code, 201)

    def test_partial_edits_preserve_units_and_unrelated_properties(self):
        before = copy.deepcopy(self.fixture.products[0])
        self.fixture.products[0].update(parent_product_id=44, due_type=2, default_best_before_days_after_open=3)
        before = copy.deepcopy(self.fixture.products[0])
        old_version = self.detail()['version']
        response = self.update({'name':'Whole milk','location_id':2,'min_stock_amount':2.5}, version=old_version)
        self.assertEqual(response.status_code,200,response.text)
        expected = before | {'name':'Whole milk','location_id':2,'min_stock_amount':2.5}
        self.assertEqual(self.fixture.products[0],expected)
        self.assertEqual([r for r in self.fixture.requests if r[0]=='PUT'], [('PUT','objects/products/10',{'name':'Whole milk','location_id':2,'min_stock_amount':2.5})])
        self.assertNotEqual(response.json()['version'],old_version)
        self.assertEqual(self.update({'name':'Tea'}).status_code,409)

    def test_stale_update_is_rejected_before_write(self):
        old_version = self.detail()['version']
        self.fixture.products[0]['default_best_before_days']='14'
        response = self.update({'name':'Changed'},version=old_version)
        self.assertEqual(response.status_code,409)
        self.assertEqual(response.json()['detail']['code'],'stale')
        self.assertEqual(self.fixture.products[0]['name'],'Milk')
        self.assertFalse(any(r[0]=='PUT' for r in self.fixture.requests))

    def test_invalid_fields_and_references(self):
        for changes in ({'name':''},{'name':'\n'},{'name':'Bad\x00name'},{'name':'x'*201},{'unit_id':0},{'unit_id':True},{'unit_id':999},{'location_id':999},{'location_id':-1},{'min_stock_amount':-1},{'min_stock_amount':True},{'min_stock_amount':'NaN'},{'default_best_before_days':1.5},{'default_best_before_days':True},{'default_best_before_days':-2},{'qu_id_stock':5},{'stock_amount':3}):
            self.assertEqual(self.create(**changes).status_code,422,changes)
        for changes in ({},{'name':None},{'location_id':None},{'unit_id':6},{'qu_id_stock':6},{'expected_version':'invalid'},{'location_id':999},{'min_stock_amount':-1}):
            self.assertEqual(self.update(changes).status_code,422,changes)
        self.assertEqual(self.client.get('/api/product-catalog/0').status_code,422)
        self.assertEqual(self.client.get('/api/product-catalog/999').status_code,404)
        self.assertEqual(self.client.delete('/api/product-catalog/10').status_code,405)
        self.assertFalse(any(r[0] != 'GET' for r in self.fixture.requests))

    def test_missing_options_and_automatic_shopping_prevent_writes(self):
        self.fixture.settings['shopping_list_auto_add_below_min_stock_amount']='1'
        self.assertEqual(self.create().json()['detail']['code'],'automatic_shopping')
        self.assertEqual(self.update({'min_stock_amount':2}).status_code,409)
        self.fixture.settings={}
        self.assertEqual(self.create().status_code,502)
        self.fixture.units=[]
        self.assertEqual(self.create().status_code,422)
        self.fixture.locations=[]
        self.assertEqual(self.client.get('/api/product-catalog/options').json(),{'units':[],'locations':[]})
        self.assertFalse(any(r[0] != 'GET' for r in self.fixture.requests))

    def test_upstream_errors_and_untrusted_records(self):
        for failure in (500,'timeout','malformed'):
            self.fixture.failure=failure
            for response in (self.create(),self.client.get('/api/product-catalog'),self.client.get('/api/product-catalog/options')):
                self.assertEqual(response.status_code,502)
                self.assertNotIn('SECRET',response.text)
        self.fixture.failure=None
        self.fixture.products[0]['name']={'bad':'SECRET'}
        response=self.client.get('/api/product-catalog')
        self.assertEqual(response.status_code,502)
        self.assertNotIn('SECRET',response.text)

    def test_uncertain_writes_are_never_retried(self):
        token=self.detail()['version']
        def uncertain(request):
            response=self.fixture(request)
            if request.method != 'GET':
                raise httpx.ReadTimeout('SECRET after save',request=request)
            return response
        self.client.app.state.grocy_transport=httpx.MockTransport(uncertain)
        response=self.create()
        self.assertEqual(response.status_code,502)
        self.assertEqual(len(self.fixture.products),4)
        response=self.update({'min_stock_amount':4},version=token)
        self.assertEqual(response.status_code,502)
        self.assertNotIn('SECRET',response.text)
        self.assertEqual(self.fixture.products[0]['min_stock_amount'],4)
        self.assertEqual(len([r for r in self.fixture.requests if r[0]=='POST']),1)
        self.assertEqual(len([r for r in self.fixture.requests if r[0]=='PUT']),1)

    def test_catalog_version_matches_single_read_with_omitted_userfields(self):
        self.fixture.products[0].pop('userfields')
        def grocy_userfields(request):
            response = self.fixture(request)
            if request.method == 'GET' and request.url.path.endswith('/products/10'):
                return httpx.Response(200,json=self.fixture.products[0] | {'userfields':None})
            return response
        self.client.app.state.grocy_transport = httpx.MockTransport(grocy_userfields)
        catalog = self.client.get('/api/product-catalog').json()
        token = next(p['version'] for p in catalog if p['id']==10)
        self.assertEqual(token,self.detail()['version'])
        self.assertEqual(self.update({'name':'Whole milk'},version=token).status_code,200)
