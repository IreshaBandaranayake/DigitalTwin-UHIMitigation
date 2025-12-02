import pandas as pd
from pathlib import Path
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error
import joblib
import numpy as np

DATA = Path(__file__).resolve().parent / "data" / "sample_uhi.csv"
MODEL_DIR = Path(__file__).resolve().parent / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
MODEL_OUT = MODEL_DIR / "lst_model.pkl"

df = pd.read_csv(DATA)

features = ["NDVI", "NDWI", "NDBI", "Population"]
X = df[features]
y = df["LST"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = RandomForestRegressor(n_estimators=200, max_depth=12, random_state=42, n_jobs=-1)
model.fit(X_train, y_train)

pred = model.predict(X_test)
r2 = r2_score(y_test, pred)
rmse = np.sqrt(mean_squared_error(y_test, pred))

print(f"Trained RandomForest: R2={r2:.3f}, RMSE={rmse:.3f}")

joblib.dump(model, MODEL_OUT)
print("Saved model to:", MODEL_OUT)