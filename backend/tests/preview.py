"""Local browser preview using only disposable mock data. See README."""
import os
import httpx
from app.main import app
from app.dependencies import get_grocy
from app.grocy_client import GrocyClient
from app.dashboard import build_dashboard
import app.routes.dashboard as dashboard_route
from mock_grocy import MockGrocy

fixture = MockGrocy()
os.environ.update(GROCY_URL='http://mock', GROCY_API_KEY='disposable-test-key', HOUSEHOLD_TIMEZONE='UTC')

async def mock_client():
    async with httpx.AsyncClient(base_url='http://mock/api/', transport=httpx.MockTransport(fixture)) as http:
        yield GrocyClient(http)

async def mock_dashboard(client, today, timezone, list_id=None, section_id=None):
    async with httpx.AsyncClient(base_url='http://mock/api/', transport=httpx.MockTransport(fixture)) as http:
        return await build_dashboard(GrocyClient(http), today, timezone, list_id, section_id)

app.dependency_overrides[get_grocy] = mock_client
dashboard_route.build_dashboard = mock_dashboard
