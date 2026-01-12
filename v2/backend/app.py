from __future__ import annotations

from datetime import datetime
from pathlib import Path
import json
import sys

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
import logging

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = BASE_DIR / "mzyana_lightgbm_model.pkl"
GEO_PATH = BASE_DIR / "geo_data.json"
TEMPLATE_DIR = BASE_DIR / "template"

app = FastAPI(title="House Price API", version="1.0.0")

logger = logging.getLogger("uvicorn.error")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

HEATING_MAP = {
    "Zentralheizung": "central_heating",
    "Fernwaerme": "district_heating",
    "Gas-Heizung": "gas_heating",
    "Etagenheizung": "self_contained_central_heating",
    "Fussbodenheizung": "floor_heating",
    "Oelheizung": "oil_heating",
    "Waermepumpe": "heat_pump",
    "Holzpelletheizung": "wood_pellet_heating",
    "Andere": "central_heating",
}
CONDITION_MAP = {
    "Gepflegt": "well_kept",
    "Erstbezug": "first_time_use",
    "Saniert": "refurbished",
    "Vollstaendig renoviert": "fully_renovated",
    "Neuwertig": "mint_condition",
    "Modernisiert": "modernized",
    "Erstbezug nach Sanierung": "first_time_use_after_refurbishment",
    "Andere": "negotiable",
}
TYPE_MAP = {
    "Etagenwohnung": "apartment",
    "Dachgeschoss": "roof_storey",
    "Erdgeschoss": "ground_floor",
    "Maisonette": "maisonette",
    "Hochparterre": "raised_ground_floor",
    "Penthouse": "penthouse",
    "Souterrain": "half_basement",
    "Andere": "apartment",
}
QUAL_MAP = {
    "Normal": "normal",
    "Gehoben": "sophisticated",
    "Luxus": "luxury",
    "Einfach": "simple",
}

# Custom transformers used in the trained pipeline.
class DateFeatureTransformer:
    def __init__(self, date_col):
        self.date_col = date_col

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        X = X.copy()
        X[self.date_col] = pd.to_datetime(X[self.date_col])
        X["post_year"] = X[self.date_col].dt.year
        X["post_month"] = X[self.date_col].dt.month
        return X.drop(columns=[self.date_col])


class GroupMedianImputer:
    def __init__(self, group_col, target_col):
        self.group_col = group_col
        self.target_col = target_col
        self.group_medians = {}
        self.global_median = 0

    def fit(self, X, y=None):
        self.global_median = X[self.target_col].median()
        self.group_medians = X.groupby(self.group_col)[self.target_col].median().to_dict()
        return self

    def transform(self, X):
        X = X.copy()
        X[self.target_col] = X.apply(
            lambda r: self.group_medians.get(r[self.group_col], self.global_median)
            if pd.isna(r[self.target_col])
            else r[self.target_col],
            axis=1,
        )
        return X


class CustomTargetEncoder:
    def __init__(self, group_col, target_col):
        self.group_col = group_col
        self.target_col = target_col
        self.mappings = {}
        self.global_mean = 0

    def fit(self, X, y=None):
        self.global_mean = X[self.target_col].mean()
        self.mappings = X.groupby(self.group_col)[self.target_col].mean().to_dict()
        return self

    def transform(self, X):
        X = X.copy()
        X[self.group_col + "_encoded"] = X[self.group_col].map(self.mappings).fillna(self.global_mean)
        return X


# Make sure pickled pipelines referencing __main__ can resolve classes.
sys.modules["__main__"].DateFeatureTransformer = DateFeatureTransformer
sys.modules["__main__"].GroupMedianImputer = GroupMedianImputer
sys.modules["__main__"].CustomTargetEncoder = CustomTargetEncoder


def load_geo_data() -> dict:
    if not GEO_PATH.exists():
        raise FileNotFoundError("geo_data.json not found")
    return json.loads(GEO_PATH.read_text(encoding="utf-8"))


def load_model():
    if not MODEL_PATH.exists():
        raise FileNotFoundError("Model file not found")
    return joblib.load(MODEL_PATH)


class PredictRequest(BaseModel):
    livingSpace: float
    noRooms: float
    floor: float
    yearConstructed: float
    regio1: str
    regio2: str
    geo_plz: str
    heatingType: str
    condition: str
    interiorQual: str
    typeOfFlat: str
    balcony: bool
    lift: bool
    hasKitchen: bool
    garden: bool
    cellar: bool
    date: str | None = None


def validate_inputs(payload: PredictRequest) -> list[str]:
    warnings = []
    if payload.livingSpace < 15 or payload.livingSpace > 350:
        warnings.append("Wohnflaeche liegt ausserhalb des typischen Bereichs (15-350 m2).")
    if payload.noRooms < 1 or payload.noRooms > 12:
        warnings.append("Zimmeranzahl liegt ausserhalb des typischen Bereichs (1-12).")
    if payload.yearConstructed < 1850 or payload.yearConstructed > datetime.now().year + 1:
        warnings.append("Baujahr liegt ausserhalb des typischen Bereichs.")
    if payload.livingSpace > 0 and payload.noRooms > 0:
        sqm_per_room = payload.livingSpace / payload.noRooms
        if sqm_per_room < 8 or sqm_per_room > 80:
            warnings.append("Wohnflaeche pro Zimmer wirkt unplausibel.")
    return warnings


def calculate_interval(prediction: float, margin: float = 0.10) -> tuple[float, float]:
    lower = prediction * (1 - margin)
    upper = prediction * (1 + margin)
    return lower, upper


def calculate_price_per_sqm(prediction: float, living_space: float) -> float | None:
    if living_space <= 0:
        return None
    return prediction / living_space


def extract_feature_importance(model, df_input: pd.DataFrame) -> list[dict]:
    estimator = model
    if hasattr(estimator, "regressor_"):
        estimator = estimator.regressor_
    elif hasattr(estimator, "regressor"):
        estimator = estimator.regressor

    pipeline = estimator if hasattr(estimator, "named_steps") else None
    last_estimator = estimator
    if pipeline is not None:
        steps = list(pipeline.named_steps.values())
        if steps:
            last_estimator = steps[-1]

    if not hasattr(last_estimator, "feature_importances_"):
        return []

    importances = list(last_estimator.feature_importances_)
    feature_names = None
    if pipeline is not None:
        preprocessor = pipeline.named_steps.get("prep")
        if preprocessor is not None and hasattr(preprocessor, "get_feature_names_out"):
            try:
                feature_names = list(preprocessor.get_feature_names_out())
            except Exception:
                feature_names = None

    if not feature_names or len(feature_names) != len(importances):
        if len(df_input.columns) == len(importances):
            feature_names = list(df_input.columns)
        else:
            feature_names = [f"feature_{idx + 1}" for idx in range(len(importances))]

    total = sum(importances) or 1.0
    ranked = sorted(
        zip(feature_names, importances),
        key=lambda item: item[1],
        reverse=True,
    )
    top = ranked[:8]
    return [{"name": name, "weight": round((weight / total) * 100, 1)} for name, weight in top]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/")
def root():
    index_path = TEMPLATE_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(index_path)


@app.get("/geo_data.json")
def geo_data_file():
    if not GEO_PATH.exists():
        raise HTTPException(status_code=404, detail="geo_data.json not found")
    return FileResponse(GEO_PATH)


@app.exception_handler(Exception)
def handle_unexpected_error(request: Request, exc: Exception):
    logger.exception("Unhandled error")
    return JSONResponse(status_code=500, content={"detail": str(exc)})


@app.get("/geo")
def geo():
    try:
        return load_geo_data()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/predict")
def predict(payload: PredictRequest, request: Request):
    try:
        model = load_model()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    date_val = pd.to_datetime(payload.date) if payload.date else pd.to_datetime(datetime.now())

    df_input = pd.DataFrame({
        "date": [date_val],
        "livingSpace": [float(payload.livingSpace)],
        "noRooms": [float(payload.noRooms)],
        "floor": [float(payload.floor)],
        "regio1": [payload.regio1],
        "regio2": [payload.regio2],
        "heatingType": [HEATING_MAP.get(payload.heatingType, "central_heating")],
        "condition": [CONDITION_MAP.get(payload.condition, "negotiable")],
        "interiorQual": [QUAL_MAP.get(payload.interiorQual, "normal")],
        "typeOfFlat": [TYPE_MAP.get(payload.typeOfFlat, "apartment")],
        "geo_plz": [str(payload.geo_plz)],
        "balcony": [bool(payload.balcony)],
        "lift": [bool(payload.lift)],
        "hasKitchen": [bool(payload.hasKitchen)],
        "garden": [bool(payload.garden)],
        "cellar": [bool(payload.cellar)],
        "yearConstructed": [float(payload.yearConstructed)],
        "condition_was_missing": [0],
        "interiorQual_was_missing": [0],
        "heatingType_was_missing": [0],
        "yearConstructed_was_missing": [0],
    })

    try:
        pred = model.predict(df_input)[0]
    except Exception as exc:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=f"Prediction failed: {exc}") from exc

    warnings = validate_inputs(payload)
    lower, upper = calculate_interval(float(pred))
    eur_per_sqm = calculate_price_per_sqm(float(pred), float(payload.livingSpace))
    feature_importance = extract_feature_importance(model, df_input)

    return {
        "prediction": float(pred),
        "interval_lower": float(lower),
        "interval_upper": float(upper),
        "eur_per_sqm": float(eur_per_sqm) if eur_per_sqm is not None else None,
        "warnings": warnings,
        "feature_importance": feature_importance,
        "confidence_note": "Intervall basiert auf ±10% Heuristik.",
    }
