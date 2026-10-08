"""Export everything the frontend needs into static JSON files (GitHub Pages / no backend).

Output layout mirrors the API so the frontend's static mode can map each call to a file:
    data/plants.json, data/controllers.json, data/scenarios.json, data/kpis_meta.json, data/models.json
    data/plants/{id}/layout.json | tags.json | latest.json | limits.json | history.json | live.json
    data/sim/{scenario}__{controller}.json   (states + kpis, 1 day, 2-minute step)
    data/manifest.json

Usage: python scripts/export_static.py <output_dir>
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient  # noqa: E402

from app.control.controllers import make_controller  # noqa: E402
from app.sim.runner import simulate  # noqa: E402

STEP = 2  # minutes between exported simulation frames


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def rounded(vals, nd=3):
    return [None if v is None else round(v, nd) for v in vals]


def main(out: Path) -> None:
    from app.main import app

    with TestClient(app) as c:
        get = lambda url, **p: c.get(url, params=p).json()  # noqa: E731
        plants = get("/api/plants")
        dump(out / "plants.json", plants)
        dump(out / "controllers.json", get("/api/controllers"))
        scenarios = get("/api/scenarios")
        dump(out / "scenarios.json", scenarios)
        dump(out / "kpis_meta.json", get("/api/kpis/meta"))
        dump(out / "models.json", get("/api/models"))
        dump(out / "licenses.json", get("/api/assets/licenses"))
        for p in plants:
            pid = p["id"]
            base = out / "plants" / pid
            dump(base / "layout.json", get(f"/api/plants/{pid}/layout"))
            tags = get(f"/api/plants/{pid}/tags")
            dump(base / "tags.json", tags)
            dump(base / "latest.json", get(f"/api/plants/{pid}/latest"))
            dump(base / "limits.json", get("/api/limits", plant_id=pid))
            ids = ",".join(t["tag_id"] for t in tags)
            # full history at 15-minute resolution + last 24 h raw (for trends and live replay)
            dump(base / "history_15m.json", get("/api/measurements", tag_ids=ids, agg="15m",
                                                start=0, end=2**62))
            raw = get("/api/measurements", tag_ids=ids, agg="raw")
            dump(base / "history_raw_24h.json", {"series": {k: {"t": v["t"], "v": rounded(v["v"])}
                                                            for k, v in raw["series"].items()}})

    runs = []
    for s in scenarios:
        for cid in ("manual", "pid", "ai_mpc"):
            r = simulate(make_controller(cid), s["id"], 1)
            series = {k: rounded(v[::STEP]) for k, v in r["series"].items()}
            n = len(series["EFF.Q"])
            dump(out / "sim" / f"{s['id']}__{cid}.json", {
                "run_id": f"static_{s['id']}_{cid}", "controller_id": cid, "scenario_id": s["id"],
                "dt_min": STEP, "t_min": [i * STEP for i in range(n)], "series": series, "kpis": r["kpis"]})
            runs.append({"scenario_id": s["id"], "controller_id": cid, "days": 1})
            print("exported", s["id"], cid, {k: round(r["kpis"][k], 1) for k in ("EQI", "total_energy_kWh_d")})
    dump(out / "manifest.json", {"mode": "static", "sim_runs": runs, "sim_days": 1, "sim_step_min": STEP})


if __name__ == "__main__":
    main(Path(sys.argv[1]))
