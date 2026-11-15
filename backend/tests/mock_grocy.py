"""In-memory Grocy HTTP fixture: no network, credentials, or real household data."""
import json
import httpx


class MockGrocy:
    def __init__(self):
        self.lists = [{'id': '2', 'name': 'Weekly shop'}, {'id': '3', 'name': 'Supplies'}]
        self.products = [{'id': '10', 'name': 'Milk', 'qu_id_stock': '5', 'qu_id_purchase': '6', 'active': '1'},
                         {'id': '11', 'name': 'Tea', 'qu_id_stock': '5', 'active': '1'},
                         {'id': '12', 'name': 'Inactive product', 'qu_id_stock': '5', 'active': '0'}]
        self.units = [{'id': '5', 'name': 'bottle'}, {'id': '6', 'name': 'pack'}]
        self.locations = [{'id': '1', 'name': 'Fridge'}, {'id': '2', 'name': 'Cupboard'}]
        self.settings = {'shopping_list_auto_add_below_min_stock_amount': '0'}
        for product in self.products:
            product.update(location_id='1', min_stock_amount='0', default_best_before_days='0', userfields={'keep':'yes'})
        self.items = [{'id': 101, 'shopping_list_id': 2, 'product_id': 10, 'amount': 2,
                       'qu_id': 6, 'note': 'Whole milk', 'done': 0, 'userfields': {'keep': 'value'}},
                      {'id': 102, 'shopping_list_id': 3, 'product_id': None, 'amount': 1,
                       'qu_id': None, 'note': 'Paper bags', 'done': 1}]
        self.recipes = [{'id': '20', 'name': 'Pasta', 'type': 'normal', 'base_servings': '2'},
                        {'id': '21', 'name': 'Curry', 'type': 'normal', 'base_servings': '4'},
                        {'id': '22', 'name': 'Internal plan', 'type': 'mealplan-day', 'base_servings': '1'}]
        self.sections = [{'id': '1', 'name': 'Dinner'}, {'id': '2', 'name': 'Lunch'}]
        self.meals = []
        self.requests = []
        self.failure = None
        self.next_id = 103

    def __call__(self, request):
        path = request.url.path.removeprefix('/api/')
        payload = json.loads(request.content) if request.content else None
        self.requests.append((request.method, path, payload))
        if self.failure == 'timeout':
            raise httpx.ReadTimeout('SECRET upstream body', request=request)
        if self.failure == 'malformed':
            return httpx.Response(200, text='not json SECRET')
        if self.failure:
            return httpx.Response(self.failure, json={'error_message': 'SECRET upstream body'})
        if path == 'objects/shopping_lists':
            return httpx.Response(200, json=self.lists)
        if path == 'user/settings':
            return httpx.Response(200, json=self.settings)
        if path == 'objects/locations':
            return httpx.Response(200, json=self.locations)
        if path == 'objects/products':
            if request.method == 'GET':
                return httpx.Response(200, json=self.products)
            if request.method == 'POST':
                required = {'name', 'location_id', 'qu_id_stock', 'qu_id_purchase', 'qu_id_consume', 'qu_id_price'}
                assert required <= payload.keys(), 'Missing required fields'
                record = dict(payload, id=self.next_id)
                self.next_id += 1
                self.products.append(record)
                return httpx.Response(200, json={'created_object_id': record['id']})
        if path == 'objects/quantity_units':
            return httpx.Response(200, json=self.units)
        if path.startswith('objects/products/'):
            product = next((p for p in self.products if int(p['id']) == int(path.split('/')[-1])), None)
            if not product:
                return httpx.Response(404)
            if request.method == 'GET':
                return httpx.Response(200, json=product)
            if request.method == 'PUT':
                product.update(payload)
                return httpx.Response(204)
        if path == 'objects/shopping_list':
            if request.method == 'GET':
                selected = request.url.params.get('query[]', '').removeprefix('shopping_list_id=')
                return httpx.Response(200, json=[r for r in self.items if not selected or r['shopping_list_id'] == int(selected)])
            if request.method == 'POST':
                record = dict(payload, id=self.next_id)
                self.next_id += 1
                self.items.append(record)
                return httpx.Response(200, json={'created_object_id': record['id']})
        if path.startswith('objects/shopping_list/'):
            record = next((r for r in self.items if r['id'] == int(path.split('/')[-1])), None)
            if not record:
                return httpx.Response(404)
            if request.method == 'GET':
                return httpx.Response(200, json=record)
            if request.method == 'PUT':
                record.update(payload)
                return httpx.Response(204)
            if request.method == 'DELETE':
                self.items.remove(record)
                return httpx.Response(204)
        if path == 'stock/volatile':
            return httpx.Response(200, json={'missing_products': []})
        if path == 'objects/recipes':
            return httpx.Response(200, json=self.recipes)
        if path == 'objects/meal_plan_sections':
            return httpx.Response(200, json=self.sections)
        if path == 'objects/meal_plan':
            if request.method == 'GET':
                entries = self.meals
                for query in request.url.params.get_list('query[]'):
                    if query.startswith('day>='):
                        entries = [r for r in entries if r['day'] >= query[5:]]
                    elif query.startswith('day<='):
                        entries = [r for r in entries if r['day'] <= query[5:]]
                return httpx.Response(200, json=entries)
            if request.method == 'POST':
                record = dict(payload, id=self.next_id)
                self.next_id += 1
                self.meals.append(record)
                return httpx.Response(200, json={'created_object_id': record['id']})
        if path.startswith('objects/meal_plan/'):
            record = next((r for r in self.meals if r['id'] == int(path.split('/')[-1])), None)
            if not record:
                return httpx.Response(404)
            if request.method == 'GET':
                return httpx.Response(200, json=record)
            if request.method == 'PUT':
                record.update(payload)
                return httpx.Response(204)
            if request.method == 'DELETE':
                self.meals.remove(record)
                return httpx.Response(204)
        raise AssertionError(f'Unexpected upstream call: {request.method} {path}')
