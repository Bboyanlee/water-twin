"""Run a scenario under one controller and compute benchmark KPIs."""
from __future__ import annotations

import numpy as np

from ..config import CACHE_DIR
from . import influent
from .bsm1 import Actuators, BSM1Plant

DT_MIN = 1.0
DT_DAY = DT_MIN / 1440.0

# Effluent limits used for violation KPIs (BSM1 limits)
LIMITS = {"EFF.SNH": 4.0, "EFF.TN": 18.0, "EFF.COD": 100.0, "EFF.TSS": 30.0, "EFF.BOD5": 10.0}

KPI_META = [
    {"key": "EQI", "label_zh": "出水品質指標 EQI", "unit": "kg 汙染單位/d", "better": "lower"},
    {"key": "AE_kWh_d", "label_zh": "曝氣能耗", "unit": "kWh/d", "better": "lower"},
    {"key": "PE_kWh_d", "label_zh": "泵送能耗", "unit": "kWh/d", "better": "lower"},
    {"key": "total_energy_kWh_d", "label_zh": "總能耗", "unit": "kWh/d", "better": "lower"},
    {"key": "eff_COD_avg", "label_zh": "放流 COD 平均", "unit": "mg/L", "better": "lower"},
    {"key": "eff_BOD5_avg", "label_zh": "放流 BOD5 平均", "unit": "mg/L", "better": "lower"},
    {"key": "eff_SNH_avg", "label_zh": "放流氨氮平均", "unit": "mg N/L", "better": "lower"},
    {"key": "eff_TN_avg", "label_zh": "放流總氮平均", "unit": "mg N/L", "better": "lower"},
    {"key": "eff_TSS_avg", "label_zh": "放流 SS 平均", "unit": "mg/L", "better": "lower"},
    {"key": "viol_SNH_pct", "label_zh": "氨氮超標時間比例", "unit": "%", "better": "lower"},
    {"key": "viol_TN_pct", "label_zh": "總氮超標時間比例", "unit": "%", "better": "lower"},
    {"key": "viol_COD_pct", "label_zh": "COD 超標時間比例", "unit": "%", "better": "lower"},
    {"key": "viol_TSS_pct", "label_zh": "SS 超標時間比例", "unit": "%", "better": "lower"},
    {"key": "viol_BOD5_pct", "label_zh": "BOD5 超標時間比例", "unit": "%", "better": "lower"},
    {"key": "setpoint_changes", "label_zh": "設定值調整次數", "unit": "次", "better": "lower"},
]

_plant = BSM1Plant()
_ss_cache: np.ndarray | None = None


def steady_state() -> np.ndarray:
    global _ss_cache
    if _ss_cache is None:
        f = CACHE_DIR / "bsm1_steady_state.npy"
        if f.exists():
            _ss_cache = np.load(f)
        else:
            _ss_cache = _plant.steady_state()
            np.save(f, _ss_cache)
    return _ss_cache.copy()


def simulate(controller, scenario_id: str, days: float, warmup_days: float = 1.0,
             seed: int = 7, record: bool = True) -> dict:
    """Simulate ``days`` of a scenario. Warm-up runs the dry-weather pattern under the same controller."""
    plant = _plant
    y = steady_state()
    controller.reset()
    series: dict[str, list] = {}

    # Whole warm-up days keep the controller clock continuous and aligned with the hour of day
    # (controllers schedule decisions on t_min, so it must never jump backwards).
    warmup_days = float(round(warmup_days))
    phases = []
    if warmup_days > 0:
        phases.append(("warmup", *influent.generate("dry", warmup_days, DT_MIN, seed=seed + 1000), False))
    phases.append(("main", *influent.generate(scenario_id, days, DT_MIN, seed=seed), True))

    act = Actuators(kla=np.zeros(5))
    t_min = 0.0
    for _, Q, C, keep in phases:
        for i in range(len(Q)):
            obs = plant.outputs(y, Q[i], C[i], act)   # measured state, previous actuator values
            act = controller.step(obs, t_min, DT_DAY)
            if keep and record:
                obs.update(plant.actuator_outputs(act))
                obs.update(controller.setpoints())
                for k, v in obs.items():
                    series.setdefault(k, []).append(v)
            y = plant.step_rk4(y, DT_DAY, Q[i], C[i], act)
            t_min += DT_MIN
    n = len(series.get("EFF.Q", []))
    return {"t_min": [i * DT_MIN for i in range(n)], "series": series, "kpis": compute_kpis(series)}


def compute_kpis(s: dict) -> dict:
    if not s:
        return {}
    a = {k: np.asarray([np.nan if v is None else v for v in s[k]], dtype=float) for k in s}
    n = len(a["EFF.Q"])
    T = n * DT_DAY
    Qe = a["EFF.Q"]
    eqi_load = (2 * a["EFF.TSS"] + 1 * a["EFF.COD"] + 30 * a["EFF.TKN"] + 10 * a["EFF.SNO"] + 2 * a["EFF.BOD5"]) * Qe
    k = {
        "EQI": float(np.sum(eqi_load) * DT_DAY / (T * 1000.0)),
        "AE_kWh_d": float(np.mean(a["ENERGY.aeration_kW"]) * 24.0),
        "PE_kWh_d": float(np.mean(a["ENERGY.pumping_kW"]) * 24.0),
    }
    k["total_energy_kWh_d"] = k["AE_kWh_d"] + k["PE_kWh_d"]
    w = Qe / np.sum(Qe)  # flow-weighted averages
    for name, key in (("COD", "EFF.COD"), ("BOD5", "EFF.BOD5"), ("SNH", "EFF.SNH"), ("TN", "EFF.TN"), ("TSS", "EFF.TSS")):
        k[f"eff_{name}_avg"] = float(np.sum(a[key] * w))
        k[f"viol_{name}_pct"] = float(np.mean(a[key] > LIMITS[key]) * 100.0)
    sp = a.get("R5.DO_sp")
    k["setpoint_changes"] = 0 if sp is None or np.all(np.isnan(sp)) else int(np.sum(np.abs(np.diff(sp)) > 1e-9))
    return k
