from fastapi import FastAPI
from app.routes.dashboard import router
from app.routes.groceries import router as grocery_router

app = FastAPI(title="Grocy Frontend API", version="0.3.0")


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "healthy"}


app.include_router(router)
app.include_router(grocery_router)
