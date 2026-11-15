from fastapi import FastAPI

app = FastAPI(
    title="Grocy Frontend API",
    description="Custom backend for the Grocy household dashboard",
    version="0.1.0"
)


@app.get("/health")
def health():
    return {"status": "healthy"}