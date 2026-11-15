from typing import Annotated
from fastapi import APIRouter, Query
from app.routes.groceries import Client, PositivePath
from app.product_models import ProductCreate, ProductUpdate, ProductDetails, ProductSetup
from app.products import ProductService

router = APIRouter(prefix='/api/product-catalog', tags=['Products'])


@router.get('/options', response_model=ProductSetup)
async def options(client: Client):
    return await ProductService(client).setup()


@router.get('', response_model=list[ProductDetails])
async def catalog(client: Client, q: Annotated[str, Query(max_length=200)] = ''):
    return await ProductService(client).catalog(q)


@router.get('/{product_id}', response_model=ProductDetails)
async def detail(product_id: PositivePath, client: Client):
    return await ProductService(client).detail(product_id)


@router.post('', response_model=ProductDetails, status_code=201)
async def create(entry: ProductCreate, client: Client):
    return await ProductService(client).create(entry)


@router.patch('/{product_id}', response_model=ProductDetails)
async def update(product_id: PositivePath, changes: ProductUpdate, client: Client):
    return await ProductService(client).update(product_id, changes)
