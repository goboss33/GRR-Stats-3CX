from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Call Center Analytics API",
    description="Backend API for Call Center Analytics Dashboard",
    version="1.0.0"
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint to verify API is running."""
    return {"status": "ok"}


@app.get("/")
async def root():
    """Root endpoint with API information."""
    return {
        "message": "Call Center Analytics API",
        "version": "1.0.0",
        "docs": "/docs"
    }
