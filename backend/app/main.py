from fastapi import FastAPI, HTTPException
import os
import httpx

app = FastAPI(
    title="Grocy Frontend API",
    description="Custom backend for the Grocy household dashboard",
    version="0.1.0"
)

@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "healthy"}

@app.get("/api/dashboard")
async def get_dashboard():
    grocy_url = os.environ["GROCY_URL"].rstrip("/")
    api_key = os.environ["GROCY_API_KEY"]

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{grocy_url}/api/objects/shopping_list",
                headers={"GROCY-API-KEY": api_key}
            )
            response.raise_for_status()

        shopping_items = response.json()

        remaining = sum(
            1 for item in shopping_items
            if int(item.get("done") or 0) == 0
        )

        return {
            "shopping_list": {
                "remaining_items": remaining,
                "total_items": len(shopping_items)
            }
        }

    except (httpx.HTTPError, ValueError):
        raise HTTPException(
            status_code=502,
            detail="Unable to retrieve shopping list"
        )