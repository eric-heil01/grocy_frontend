import os
from typing import Annotated
from fastapi import APIRouter, Depends, Path, Query
from app.dependencies import get_grocy
from app.groceries import GroceryService
from app.grocery_models import GroceryCreate, GroceryEntries, GroceryLists, GroceryUpdate, MutationResult, ProductOption

router = APIRouter(prefix="/api", tags=["Groceries"])
Client = Annotated[object, Depends(get_grocy)]
PositivePath = Annotated[int, Path(gt=0)]


@router.get("/shopping-lists", response_model=GroceryLists)
async def lists(client: Client):
    available = await GroceryService(client).lists()
    try:
        preferred = int(os.getenv("GROCY_SHOPPING_LIST_ID", ""))
    except ValueError:
        preferred = None
    return GroceryLists(lists=available, default_list_id=preferred if any(item.id == preferred for item in available) else None)


@router.get("/products", response_model=list[ProductOption])
async def products(client: Client, q: Annotated[str, Query(min_length=1, max_length=100)]):
    query = q.strip()
    return await GroceryService(client).products(query) if query else []


@router.get("/shopping-lists/{list_id}/items", response_model=GroceryEntries)
async def entries(list_id: PositivePath, client: Client):
    return await GroceryService(client).entries(list_id)


@router.post("/shopping-lists/{list_id}/items", response_model=MutationResult, status_code=201)
async def add(list_id: PositivePath, entry: GroceryCreate, client: Client):
    await GroceryService(client).add(list_id, entry)
    return MutationResult()


@router.patch("/shopping-lists/{list_id}/items/{entry_id}", response_model=MutationResult)
async def update(list_id: PositivePath, entry_id: PositivePath, changes: GroceryUpdate, client: Client):
    await GroceryService(client).update(list_id, entry_id, changes)
    return MutationResult()


@router.delete("/shopping-lists/{list_id}/items/{entry_id}", response_model=MutationResult)
async def remove(list_id: PositivePath, entry_id: PositivePath, client: Client):
    await GroceryService(client).remove(list_id, entry_id)
    return MutationResult()
