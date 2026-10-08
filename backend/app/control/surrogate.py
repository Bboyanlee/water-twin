"""Data-driven surrogate used by the AI controller.

Trained on simulator runs in which the DO setpoint and internal recycle are
changed at random every 2 hours. For a candidate (setpoint, recycle) held for
the next 120 minutes it predicts, at the end of the aerobic zone (tank R5, where
an online NH4/NO3 analyser sits in ammonia-based aeration control):
    snh : mean R5 NH4-N over minutes 30..120         (mg N/L)
    sno : mean R5 NO3-N over minutes 30..120         (mg N/L)
    kw  : mean aeration power over minutes 0..120    (kW)
The effluent itself is not used as the target: the secondary clarifier holds
~8 h of flow, so effluent quality barely reacts within the horizon. A 1 h
horizon proved too short-sighted (saved air in the morning, then could not
catch up with the afternoon load), hence 2 h.
Gradient-boosted trees with monotonic constraints on the setpoint keep the
optimiser physically sensible (more oxygen -> less NH4, more NO3, more energy).
"""
from __future__ import annotations

import json
import time

import joblib
import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, r2_score

from ..config import MODEL_DIR
from .controllers import AIMPCController, PIDController

FEATURES = ["R3.SNH", "R4.SNH", "R5.SNH", "R5.SO", "R2.SNO", "R5.SNO", "INF.Q", "INF.SNH",
            "nh4_load", "hour_sin", "hour_cos", "sp_now", "qa_now", "sp", "qa"]
QA_BASE = 55338.0
TARGETS = ("snh", "sno", "kw")
MONOTONIC = {"snh": -1, "sno": 1, "kw": 1}
BLOCK_MIN = 120          # setpoint held for the prediction horizon
LEAD_MIN = 30            # quality targets averaged over minutes LEAD_MIN..BLOCK_MIN
MODEL_FILE = MODEL_DIR / "ai_mpc_surrogate.joblib"
META_FILE = MODEL_DIR / "ai_mpc_surrogate.json"


def _row(obs: dict, t_min: float, sp_now: float, qa_now: float, sp: float, qa: float) -> list[float]:
    h = 2 * np.pi * (t_min % 1440) / 1440.0
    return [obs["R3.SNH"], obs["R4.SNH"], obs["R5.SNH"], obs["R5.SO"], obs["R2.SNO"], obs["R5.SNO"],
            obs["INF.Q"], obs["INF.SNH"], obs["INF.Q"] * obs["INF.SNH"] / 1000.0,
            np.sin(h), np.cos(h), sp_now, qa_now, sp, qa]


class Surrogate:
    def __init__(self, models: dict):
        self.models = models

    def predict(self, obs: dict, t_min: float, sp_now: float, qa_now: float,
                sp: np.ndarray, qa: np.ndarray) -> dict:
        X = np.array([_row(obs, t_min, sp_now, qa_now, s, q) for s, q in zip(sp, qa)])
        return {k: m.predict(X) for k, m in self.models.items()}


class _RandomSetpoint(PIDController):
    """PI loops whose shared setpoint and recycle jump to random values every block (training data)."""

    def __init__(self, seed: int):
        self.rng = np.random.default_rng(seed)
        super().__init__()

    def reset(self):
        super().reset()
        self._next = 0.0

    def step(self, obs, t_min, dt_day):
        if t_min >= self._next:
            self.sp[:] = self.rng.choice(AIMPCController.CANDIDATES)
            self.qa_factor = float(self.rng.choice(AIMPCController.QA_FACTORS))
            self._next = t_min + BLOCK_MIN
        return self._apply(obs, dt_day)


def _dataset(runs) -> tuple[np.ndarray, dict]:
    X, Y = [], {k: [] for k in TARGETS}
    for res in runs:
        s = {k: np.asarray(v, dtype=float) for k, v in res["series"].items()}
        n = len(s["EFF.Q"])
        for t0 in range(BLOCK_MIN, n - BLOCK_MIN, BLOCK_MIN):  # block starts (skip first block)
            obs = {k: s[k][t0] for k in ("R3.SNH", "R4.SNH", "R5.SNH", "R5.SO", "R2.SNO", "R5.SNO", "INF.Q", "INF.SNH")}
            qa = s["FLOW.Qa"] / QA_BASE
            X.append(_row(obs, t0, s["R5.DO_sp"][t0 - 1], qa[t0 - 1], s["R5.DO_sp"][t0], qa[t0]))
            Y["snh"].append(s["R5.SNH"][t0 + LEAD_MIN:t0 + BLOCK_MIN].mean())
            Y["sno"].append(s["R5.SNO"][t0 + LEAD_MIN:t0 + BLOCK_MIN].mean())
            Y["kw"].append(s["ENERGY.aeration_kW"][t0:t0 + BLOCK_MIN].mean())
    return np.array(X), {k: np.array(v) for k, v in Y.items()}


def train(verbose: bool = True) -> Surrogate:
    from ..sim.runner import simulate

    t0 = time.time()
    # seeds >= 100 so training influent noise never coincides with evaluation runs (seed 7)
    plan = ([("dry", 24, 101), ("nh4_shock", 24, 102)]
            + [("storm", 2, s) for s in range(103, 109)])
    runs = [simulate(_RandomSetpoint(seed), scen, days, seed=seed) for scen, days, seed in plan]
    X, Y = _dataset(runs)
    rng = np.random.default_rng(0)
    test = rng.random(len(X)) < 0.2
    sp_col = FEATURES.index("sp")
    models, metrics = {}, {}
    for k in TARGETS:
        cst = [0] * len(FEATURES)
        cst[sp_col] = MONOTONIC[k]
        m = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=15,
                                          monotonic_cst=cst, random_state=0)
        m.fit(X[~test], Y[k][~test])
        pred = m.predict(X[test])
        metrics[k] = {"r2": float(r2_score(Y[k][test], pred)), "mae": float(mean_absolute_error(Y[k][test], pred))}
        m.fit(X, Y[k])  # refit on all data
        models[k] = m
    joblib.dump(models, MODEL_FILE)
    meta = {"model": "HistGradientBoostingRegressor x3 (monotonic in DO setpoint)", "features": FEATURES,
            "targets": list(TARGETS), "samples": int(len(X)), "holdout_metrics": metrics,
            "training_plan": plan, "trained_s": round(time.time() - t0, 1)}
    META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    if verbose:
        print(json.dumps(meta, ensure_ascii=False, indent=2))
    return Surrogate(models)


_cached: Surrogate | None = None


def load_or_train() -> Surrogate:
    global _cached
    if _cached is None:
        _cached = Surrogate(joblib.load(MODEL_FILE)) if MODEL_FILE.exists() else train(verbose=False)
    return _cached


def metadata() -> dict | None:
    return json.loads(META_FILE.read_text(encoding="utf-8")) if META_FILE.exists() else None
