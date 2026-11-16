import asyncio
from fastapi import APIRouter, Request
from fastapi.routing import APIRoute
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from app.routes.groceries import Client, PositivePath
from app.grocery_models import MutationResult
from app.inventory_models import InventoryOverview, StockDetails, StockAdd, StockConsume
from app.inventory import InventoryService

class InventoryRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()
        async def validated(request):
            try:
                return await handler(request)
            except RequestValidationError:
                return JSONResponse(status_code=422, content={'detail': {'code': 'validation', 'message': 'Check the quantity, unit, location, and package date.'}})
        return validated

router = APIRouter(prefix='/api/inventory', tags=['Inventory'], route_class=InventoryRoute)

@router.get('', response_model=InventoryOverview)
async def overview(client: Client):
    return await InventoryService(client).overview()

@router.get('/products/{product_id}', response_model=StockDetails)
async def details(product_id: PositivePath, client: Client):
    result, _ = await InventoryService(client).details(product_id)
    return result

@router.post('/products/{product_id}/add', response_model=MutationResult, status_code=201)
async def add(product_id: PositivePath, change: StockAdd, client: Client, request: Request):
    lock = request.app.state.inventory_locks.setdefault(product_id, asyncio.Lock())
    async with lock:
        await InventoryService(client).add(product_id, change)
    return MutationResult()

@router.post('/products/{product_id}/consume', response_model=MutationResult)
async def consume(product_id: PositivePath, change: StockConsume, client: Client, request: Request):
    lock = request.app.state.inventory_locks.setdefault(product_id, asyncio.Lock())
    async with lock:
        await InventoryService(client).consume(product_id, change)
    return MutationResult()
