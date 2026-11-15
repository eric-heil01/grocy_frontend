"""Shared backend-only connection configuration and request lifetime."""
import os
from urllib.parse import urlsplit

import httpx
from fastapi import HTTPException, Request, Response
from pydantic import ValidationError

from app.grocy_client import GrocyClient, GrocyUnavailable


def grocy_config():
    try:
        url = os.environ["GROCY_URL"].rstrip("/")
        key = os.environ["GROCY_API_KEY"]
        parsed = urlsplit(url)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.query or parsed.fragment
                or not key.strip() or any(ord(c) < 32 or ord(c) > 126 for c in key)):
            raise ValueError()
        return url, key
    except (KeyError, ValueError):
        raise HTTPException(503, "Grocy connection is not configured.") from None


async def get_grocy(response: Response, request: Request):
    response.headers["Cache-Control"] = "no-store"
    url, key = grocy_config()
    # Test preview supplies a transport on its own isolated app instance.
    options = {"transport": request.app.state.grocy_transport} if hasattr(request.app.state, "grocy_transport") else {}
    try:
        async with httpx.AsyncClient(
            base_url=f"{url}/api/", headers={"GROCY-API-KEY": key}, timeout=10.0, **options
        ) as http:
            yield GrocyClient(http)
    except GrocyUnavailable as exc:
        if exc.status_code == 404:
            raise HTTPException(404, "This Grocy record is no longer available. Refresh the list.") from None
        raise HTTPException(502, "Unable to confirm the Grocy request. Refresh the list before trying again.") from None
    except (ValidationError, ValueError, TypeError, KeyError):
        raise HTTPException(502, "Grocy returned unsupported grocery data. Refresh the list or check compatibility.") from None
