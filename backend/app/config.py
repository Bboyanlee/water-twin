"""Runtime settings from environment variables (cloud-ready: no hard-coded host paths)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("WT_DATA_DIR", BASE_DIR / "data"))
CACHE_DIR = DATA_DIR / "cache"
MODEL_DIR = DATA_DIR / "models"
for d in (DATA_DIR, CACHE_DIR, MODEL_DIR):
    d.mkdir(parents=True, exist_ok=True)

# SQLite for local development; set to postgresql+psycopg://... (TimescaleDB) in the cloud
DATABASE_URL = os.getenv("WT_DATABASE_URL", f"sqlite:///{(DATA_DIR / 'water_twin.db').as_posix()}")
CORS_ORIGINS = os.getenv("WT_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
SYNTH_DAYS = float(os.getenv("WT_SYNTH_DAYS", "3"))
