import numpy as np
import pandas as pd
from pathlib import Path

OUT = Path(__file__).resolve().parent / "data" / "sample_uhi.csv"
OUT.parent.mkdir(parents=True, exist_ok=True)

np.random.seed(42)

# Bounding box roughly around Lahti center / Radiomäki area
lon_min, lon_max = 25.655, 25.67
lat_min, lat_max = 60.976, 60.989

n = 2000

lons = np.random.uniform(lon_min, lon_max, n)
lats = np.random.uniform(lat_min, lat_max, n)

# Generate features (realistic ranges)
NDVI = np.clip(np.random.normal(0.35, 0.15, n), 0.0, 0.9)  # vegetation
NDWI = np.clip(np.random.normal(0.10, 0.08, n), -0.2, 0.6) # water
NDBI = np.clip(np.random.normal(0.20, 0.18, n), -0.3, 0.9) # built-up
Population = np.random.poisson(600, n)  # coarse pop density

# A simple baseline physical-like model for LST (for synthetic data)
# LST = base - 10*NDVI + 6*NDBI - 3*NDWI + 0.002*population + noise
noise = np.random.normal(0, 1.2, n)
LST = 30 - 10 * NDVI + 6 * NDBI - 3 * NDWI + 0.002 * Population + noise

df = pd.DataFrame({
    "lon": lons,
    "lat": lats,
    "NDVI": NDVI,
    "NDWI": NDWI,
    "NDBI": NDBI,
    "Population": Population,
    "LST": LST
})

df.to_csv(OUT, index=False)
print("Saved synthetic dataset to:", OUT)