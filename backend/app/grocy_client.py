"""HTTP transport; upstream errors never leave this layer."""
import httpx

class GrocyUnavailable(Exception):
    pass

class GrocyClient:
    def __init__(self, client):
        self.client = client

    async def get(self, path, params=None):
        try:
            response = await self.client.get(path, params=params)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise GrocyUnavailable() from exc
