import os
import shutil
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# isolated data dir; reuse the cached steady state and trained surrogate if present
_tmp = Path(tempfile.mkdtemp(prefix="wt_test_"))
for sub in ("cache", "models"):
    src = ROOT / "data" / sub
    if src.exists():
        shutil.copytree(src, _tmp / sub)
os.environ["WT_DATA_DIR"] = str(_tmp)
os.environ["WT_SYNTH_DAYS"] = "0.5"


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        yield c
