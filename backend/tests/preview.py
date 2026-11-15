"""Local-only preview: real routes/error handling, exclusively in-memory Grocy data.
Test controls exist only on this app and are excluded from the production image.
"""
import os
from contextlib import asynccontextmanager
from unittest.mock import patch
import httpx
from fastapi import HTTPException
from app.main import create_app
from mock_grocy import MockGrocy

@asynccontextmanager
async def local_configuration(application):
    # Only this disposable server's lifetime uses the test configuration.
    with patch.dict(os.environ, {
        'GROCY_URL': 'http://mock', 'GROCY_API_KEY': 'disposable-test-key',
        'HOUSEHOLD_TIMEZONE': 'UTC', 'GROCY_SHOPPING_LIST_ID': '', 'GROCY_DINNER_SECTION_ID': '',
    }):
        yield

app = create_app()
app.router.lifespan_context = local_configuration
app.state.fixture = MockGrocy()
app.state.failure = None
app.state.fail_next_read = False


def handle(request):
    write = request.method in ('POST', 'PUT', 'DELETE')
    if write and app.state.failure == 'write':
        app.state.failure = None
        return httpx.Response(500, text='SECRET test upstream error')
    if not write and app.state.fail_next_read:
        app.state.fail_next_read = False
        return httpx.Response(500, text='SECRET test reload error')
    response = app.state.fixture(request)
    if write and app.state.failure == 'reload':
        app.state.failure = None
        app.state.fail_next_read = True
    return response


app.state.grocy_transport = httpx.MockTransport(handle)


@app.post('/_test/reset')
def reset():
    app.state.fixture = MockGrocy()
    app.state.failure = None
    app.state.fail_next_read = False
    return {'ok': True}


@app.get('/_test/state')
def state():
    return {'items': app.state.fixture.items, 'meals': app.state.fixture.meals, 'requests': app.state.fixture.requests}


@app.post('/_test/failure/{mode}')
def failure(mode: str):
    if mode not in ('write', 'reload'):
        raise HTTPException(422, 'Unknown test scenario')
    app.state.failure = mode
    return {'ok': True}
