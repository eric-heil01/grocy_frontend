"""HTTP transport; upstream errors never leave this layer."""
import httpx


class GrocyUnavailable(Exception):
    def __init__(self, status_code=None):
        self.status_code = status_code
        super().__init__("Grocy request failed")


class GrocyClient:
    def __init__(self, client: httpx.AsyncClient):
        self.client = client

    async def request(self, method, path, *, params=None, json=None):
        try:
            response = await self.client.request(method, path, params=params, json=json)
            response.raise_for_status()
            # Grocy's successful PUT/DELETE responses have no JSON body.
            if response.status_code == 204 or not response.content:
                return None
            return response.json()
        except httpx.HTTPStatusError as exc:
            raise GrocyUnavailable(exc.response.status_code) from exc
        except (httpx.HTTPError, ValueError) as exc:
            raise GrocyUnavailable() from exc

    async def get(self, path, params=None):
        return await self.request("GET", path, params=params)

    async def post(self, path, payload):
        return await self.request("POST", path, json=payload)

    async def put(self, path, payload):
        return await self.request("PUT", path, json=payload)

    async def delete(self, path):
        return await self.request("DELETE", path)
