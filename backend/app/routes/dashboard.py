import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from urllib.parse import urlsplit
import httpx
from fastapi import APIRouter, HTTPException, Response
from app.dashboard import build_dashboard
from app.grocy_client import GrocyClient
from app.models import Dashboard

router = APIRouter()

@router.get("/api/dashboard", response_model=Dashboard)
async def get_dashboard(response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        url = os.environ["GROCY_URL"].rstrip("/")
        key = os.environ["GROCY_API_KEY"]
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or not key:
            raise ValueError()
        timezone = os.getenv("HOUSEHOLD_TIMEZONE", "UTC")
        today = datetime.now(ZoneInfo(timezone)).date()
        list_id = int(os.environ["GROCY_SHOPPING_LIST_ID"]) if os.getenv("GROCY_SHOPPING_LIST_ID") else None
        section_id = int(os.environ["GROCY_DINNER_SECTION_ID"]) if os.getenv("GROCY_DINNER_SECTION_ID") else None
    except (KeyError, ValueError, ZoneInfoNotFoundError):
        raise HTTPException(503, "Dashboard configuration is unavailable.") from None
    async with httpx.AsyncClient(base_url=f"{url}/api/", headers={"GROCY-API-KEY": key}, timeout=10.0) as http:
        return await build_dashboard(GrocyClient(http), today, timezone, list_id, section_id)
