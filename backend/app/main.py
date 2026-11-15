from fastapi import FastAPI
from app.routes.dashboard import router

app = FastAPI(title="Grocy Frontend API", version="0.2.0")

@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "healthy"}

app.include_router(router)
