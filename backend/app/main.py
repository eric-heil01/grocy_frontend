from fastapi import FastAPI
from app.routes.dashboard import router
from app.routes.groceries import router as grocery_router
from app.routes.meals import router as meal_router


def create_app():
    application = FastAPI(title="Grocy Frontend API", version="0.3.0")

    @application.get("/health")
    @application.get("/api/health")
    def health():
        return {"status": "healthy"}

    application.include_router(router)
    application.include_router(grocery_router)
    application.include_router(meal_router)
    return application


app = create_app()
