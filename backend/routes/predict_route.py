from fastapi import APIRouter
from pydantic import BaseModel
import random
import json
from datetime import datetime
from pathlib import Path
import joblib
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

router = APIRouter()

# Files
BASE = Path(__file__).resolve().parent.parent
DATA_FILE = BASE / "data" / "Lahti_2024_FullDataset.csv"
MODEL_FILE = BASE / "models" / "final_lst_model.pkl"
CALIBRATION_FILE = BASE / "models" / "rf_calibration.pkl"

# === Load dataset & model ===
if not DATA_FILE.exists():
    raise FileNotFoundError(f"{DATA_FILE} not found.")
if not MODEL_FILE.exists():
    raise FileNotFoundError(f"{MODEL_FILE} not found.")
if not CALIBRATION_FILE.exists():
    raise FileNotFoundError(f"{CALIBRATION_FILE} not found.")

# Load CSV before using df
df = pd.read_csv(DATA_FILE)

# Add YEAR column (for inference we use 2024)
df["YEAR"] = 2024

model = joblib.load(MODEL_FILE)
calibration = joblib.load(CALIBRATION_FILE)
m, c = calibration["m"], calibration["c"]

coords = np.vstack([df["longitude"].values, df["latitude"].values]).T
tree = cKDTree(coords)

# Allowed model features
FEATURES = [
    'EVI','NDBI','NDVI','NDWI','YEAR','latitude','longitude',
    'NDVI_NDWI','NDVI_NDBI','EVI_NDVI','NDVI_div_NDWI',
    'NDBI_div_NDVI','EVI_div_NDVI','NDVI_EVI','NDWI_NDBI',
    'NDVI_sq','NDWI_sq','NDBI_sq','EVI_sq','log_NDVI','log_NDBI'
]

# Band values of objects
OBJECT_BANDS = {
    "tree":     {"RED":0.075, "GREEN":0.35, "NIR":0.6,  "SWIR":0.2},
    "roof":     {"RED":0.13,  "GREEN":0.3,  "NIR":0.45, "SWIR":0.2},
    "water":    {"RED":0.03,  "GREEN":0.04, "NIR":0.03, "SWIR":0.03},
    "building": {"RED":0.28,  "GREEN":0.28, "NIR":0.15, "SWIR":0.48}
}

class PredictionRequest(BaseModel):
    type: str
    lon: float
    lat: float


# ================================
# Helper: compute indices
# ================================
def calc_indices(R, G, N, S, B):
    NDVI = (N - R) / (N + R + 1e-6)
    NDWI = (G - N) / (G + N + 1e-6)
    NDBI = (S - N) / (S + N + 1e-6)
    EVI  = 2.5 * ((N - R) / (N + 6*R - 7.5*B + 1 + 1e-6))
    return NDVI, NDWI, NDBI, EVI

# ================================
# Helper: build feature dict
# ================================
def build_features(NDVI, NDWI, NDBI, EVI, lat, lon):

    feats = {
        'EVI': EVI,
        'NDBI': NDBI,
        'NDVI': NDVI,
        'NDWI': NDWI,
        'YEAR': 2024,
        'latitude': lat,
        'longitude': lon
    }

    # Derived features
    feats['NDVI_NDWI'] = NDVI - NDWI
    feats['NDVI_NDBI'] = NDVI - NDBI
    feats['EVI_NDVI'] = EVI - NDVI
    feats['NDVI_div_NDWI'] = NDVI / (NDWI + 0.01)
    feats['NDBI_div_NDVI'] = NDBI / (NDVI + 0.01)
    feats['EVI_div_NDVI'] = EVI / (NDVI + 0.01)
    feats['NDVI_EVI'] = NDVI * EVI
    feats['NDWI_NDBI'] = NDWI * NDBI
    feats['NDVI_sq'] = NDVI ** 2
    feats['NDWI_sq'] = NDWI ** 2
    feats['NDBI_sq'] = NDBI ** 2
    feats['EVI_sq'] = EVI ** 2
    feats['log_NDVI'] = np.log(NDVI + 1)
    feats['log_NDBI'] = np.log(NDBI + 1)

    return feats

# ================================
# MAIN ROUTE
# ================================
@router.post("/predict")
async def predict_location(request: PredictionRequest):

    if request.type not in OBJECT_BANDS:
        return {"error": f"Invalid type '{request.type}'"}

    # nearest pixel
    _, idx = tree.query([request.lon, request.lat], k=1)
    base = df.iloc[int(idx)].to_dict()

    # ================
    # 1. BASELINE (DO NOT RECOMPUTE!)
    # Use values from CSV exactly as model was trained
    # ================
    NDVI_old = base["NDVI"]
    NDWI_old = base["NDWI"]
    NDBI_old = base["NDBI"]
    EVI_old  = base["EVI"]

    # ================
    # 2. NEW BAND VALUES (apply modification)
    # ================
    f = 0.1
    obj = OBJECT_BANDS[request.type]

    RED_old   = base["RED"]
    GREEN_old = base["GREEN"]
    NIR_old   = base["NIR"]
    SWIR_old  = base["SWIR"]

    RED_new   = (1-f)*RED_old   + f*obj["RED"]
    GREEN_new = (1-f)*GREEN_old + f*obj["GREEN"]
    NIR_new   = (1-f)*NIR_old   + f*obj["NIR"]
    SWIR_new  = (1-f)*SWIR_old  + f*obj["SWIR"]

    BLUE_new = GREEN_new * 0.5   # estimated BLUE
    BLUE_old = GREEN_old * 0.5   # but baseline indices DO NOT use this

    # ================
    # 3. NEW SPECTRAL INDICES
    # Recompute only NEW scenario
    # ================
    NDVI_new, NDWI_new, NDBI_new, EVI_new = calc_indices(
        RED_new, GREEN_new, NIR_new, SWIR_new, BLUE_new
    )

    # ================
    # 4. Build features
    # ================
    base_feat = build_features(
        NDVI_old, NDWI_old, NDBI_old, EVI_old,
        base["latitude"], base["longitude"]
    )

    new_feat = build_features(
        NDVI_new, NDWI_new, NDBI_new, EVI_new,
        base["latitude"], base["longitude"]
    )

    # ================
    # 5. Predict
    # ================
    base_X = np.array([[base_feat[f] for f in FEATURES]])
    new_X  = np.array([[new_feat[f] for f in FEATURES]])

    curr = m * model.predict(base_X)[0] + c
    fut  = m * model.predict(new_X)[0] + c
    delta = fut - curr

    return {
        "current_LST": round(float(curr), 2),
        "predicted_LST": round(float(fut), 2),
        "delta_LST": round(float(delta), 2),
        "baseline_features": base_feat,
        "new_features": new_feat
    }