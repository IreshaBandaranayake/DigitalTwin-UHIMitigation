from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.predict_route import router as predict_router

app = FastAPI(title="Lahti Digital Twin Backend")

# Allow React frontend (localhost:3000)
# ✅ Allow both localhost and 127.0.0.1 (with and without ports)
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
]

print("✅ CORS origins allowed:", origins)  # Add this line to confirm at startup

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
   # allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register router
app.include_router(predict_router, prefix="/api")

@app.get("/")
def read_root():
    return {"message": "Backend running successfully"}
