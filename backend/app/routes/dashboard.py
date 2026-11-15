import os
from zoneinfo import ZoneInfoNotFoundError
from app.calendar_config import household_calendar, dinner_configuration
from app.dependencies import grocy_config
import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from app.dashboard import build_dashboard
from app.grocy_client import GrocyClient
from app.models import Dashboard

router = APIRouter()

@router.get("/api/dashboard", response_model=Dashboard)
async def get_dashboard(response: Response, request: Request):
    response.headers["Cache-Control"] = "no-store"
    try:
        url, key = grocy_config()
        today, timezone = household_calendar()
        list_id = int(os.environ["GROCY_SHOPPING_LIST_ID"]) if os.getenv("GROCY_SHOPPING_LIST_ID") else None
        section_id = dinner_configuration()
    except (KeyError, ValueError, ZoneInfoNotFoundError):
        raise HTTPException(503, "Dashboard configuration is unavailable.") from None
    options = {"transport": request.app.state.grocy_transport} if hasattr(request.app.state, "grocy_transport") else {}
    async with httpx.AsyncClient(base_url=f"{url}/api/", headers={"GROCY-API-KEY": key}, timeout=10.0, **options) as http:
        return await build_dashboard(GrocyClient(http), today, timezone, list_id, section_id)
