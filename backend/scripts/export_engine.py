"""Export what the in-browser simulation engine (frontend/src/engine) needs:

    engine/surrogate.json  AI surrogate: gradient-boosted trees as flat arrays (exact same model as Python)
    engine/steady_state.json  BSM1 open-loop steady state (initial condition)
    engine/reference.json  Python results on the 'dry' scenario, used to verify the JS port

Usage: python scripts/export_engine.py <output_dir>
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.control.controllers import AIMPCController, make_controller  # noqa: E402
from app.control.surrogate import FEATURES, load_or_train, metadata  # noqa: E402
from app.sim import influent  # noqa: E402
from app.sim.runner import simulate, steady_state  # noqa: E402


def export_tree_model(m) -> dict:
    trees = []
    for (pred,) in m._predictors:
        n = pred.nodes
        trees.append({
            "f": n["feature_idx"].astype(int).tolist(),
            "t": [float(x) for x in n["num_threshold"]],
            "l": n["left"].astype(int).tolist(),
            "r": n["right"].astype(int).tolist(),
            "v": [float(x) for x in n["value"]],
            "leaf": n["is_leaf"].astype(int).tolist(),
            "ml": n["missing_go_to_left"].astype(int).tolist(),
        })
    return {"baseline": float(np.ravel(m._baseline_prediction)[0]), "trees": trees}


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    s = load_or_train()
    model = {"features": FEATURES, "targets": {k: export_tree_model(m) for k, m in s.models.items()},
             "candidates": AIMPCController.CANDIDATES.tolist(), "qa_factors": AIMPCController.QA_FACTORS.tolist(),
             "meta": metadata()}
    (out / "surrogate.json").write_text(json.dumps(model, separators=(",", ":")), encoding="utf-8")
    (out / "steady_state.json").write_text(json.dumps([round(float(x), 9) for x in steady_state()]), encoding="utf-8")

    # verification fixture: python-generated dry influent + KPIs for each controller
    Qw, Cw = influent.generate("dry", 1, 1.0, seed=7 + 1000)
    Q, C = influent.generate("dry", 1, 1.0, seed=7)
    ref = {"warmup": {"Q": Qw.tolist(), "C": Cw.tolist()}, "main": {"Q": Q.tolist(), "C": C.tolist()}, "kpis": {}}
    for cid in ("manual", "pid", "ai_mpc"):
        ref["kpis"][cid] = simulate(make_controller(cid), "dry", 1)["kpis"]
    # one-row surrogate check
    X = np.array([[1.2, 0.8, 0.5, 2.0, 3.0, 9.0, 18000, 30, 540, 0.5, 0.8, 2.0, 1.0, 1.5, 1.4]])
    ref["surrogate_check"] = {"x": X[0].tolist(), "y": {k: float(m.predict(X)[0]) for k, m in s.models.items()}}
    (out / "reference.json").write_text(json.dumps(ref, separators=(",", ":")), encoding="utf-8")
    print("engine exported:", {p.name: round(p.stat().st_size / 1024) for p in out.iterdir()}, "KB")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
