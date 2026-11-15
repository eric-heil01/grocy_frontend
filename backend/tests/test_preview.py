"""Preview controls stay outside the real app and exercise real error handling."""
import os
import unittest
from fastapi.testclient import TestClient
from app.main import app as production_app
from preview import app as preview_app


class PreviewTests(unittest.TestCase):
    def test_controls_are_excluded_from_application_and_configuration_is_restored(self):
        original_url = os.environ.get('GROCY_URL')
        with TestClient(production_app) as client:
            self.assertEqual(client.get('/_test/state').status_code, 404)
            self.assertEqual(client.post('/_test/reset').status_code, 404)
        with TestClient(preview_app) as client:
            client.post('/_test/reset')
            self.assertEqual(os.environ['GROCY_URL'], 'http://mock')
            self.assertEqual(client.get('/api/shopping-lists').status_code, 200)
            self.assertEqual(client.get('/api/dashboard').status_code, 200)
        self.assertEqual(os.environ.get('GROCY_URL'), original_url)

    def test_failed_write_and_saved_write_reload_failure_use_real_error_handling(self):
        with TestClient(preview_app) as client:
            client.post('/_test/reset')
            client.post('/_test/failure/write')
            response = client.post('/api/shopping-lists/2/items', json={'note': 'Test item'})
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('SECRET', response.text)
            self.assertEqual(len(client.get('/_test/state').json()['items']), 2)
            client.post('/_test/failure/reload')
            self.assertEqual(client.post('/api/shopping-lists/2/items', json={'note': 'Test item'}).status_code, 201)
            self.assertEqual(client.get('/api/shopping-lists/2/items').status_code, 502)
            self.assertEqual(client.get('/api/shopping-lists/2/items').json()['remaining_items'], 2)
            client.post('/_test/reset')
            self.assertEqual(len(client.get('/_test/state').json()['items']), 2)
