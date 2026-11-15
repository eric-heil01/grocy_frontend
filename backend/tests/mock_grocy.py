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
        self.items = [{'id': 101, 'shopping_list_id': 2, 'product_id': 10, 'amount': 2,
                       'qu_id': 6, 'note': 'Whole milk', 'done': 0, 'userfields': {'keep': 'value'}},
                      {'id': 102, 'shopping_list_id': 3, 'product_id': None, 'amount': 1,
                       'qu_id': None, 'note': 'Paper bags', 'done': 1}]
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
        if path == 'objects/products':
            return httpx.Response(200, json=self.products)
        if path == 'objects/quantity_units':
            return httpx.Response(200, json=self.units)
        if path.startswith('objects/products/'):
            product = next((p for p in self.products if int(p['id']) == int(path.split('/')[-1])), None)
            return httpx.Response(200, json=product) if product else httpx.Response(404)
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
        if path in ('objects/recipes', 'objects/meal_plan', 'objects/meal_plan_sections'):
            return httpx.Response(200, json=[])
        raise AssertionError(f'Unexpected upstream call: {request.method} {path}')
