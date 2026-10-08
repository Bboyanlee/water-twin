"""Synthetic influent scenarios built around the BSM1 average influent.

The official BSM1 dynamic influent files are not bundled; instead a diurnal
pattern with AR(1) noise is generated so that flow and load peak around
late morning and evening like a typical municipal plant.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .asm1 import IDX
from .bsm1 import BSM1_INFLUENT, BSM1_QIN


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    description: str
    default_days: int = 1


SCENARIOS = {
    s.id: s for s in [
        Scenario("dry", "晴天日變化", "典型旱季日變化：清晨低流量、上午與傍晚尖峰。"),
        Scenario("storm", "暴雨事件", "第 1 天 09:00–15:00 降雨，流量增至約 2.5 倍，溶解性汙染物被稀釋、初期沖刷懸浮物增加。"),
        Scenario("nh4_shock", "氨氮衝擊負荷", "10:00–16:00 進流氨氮升高約 2.2 倍（模擬上游事業高氨氮排放）。"),
    ]
}


def _diurnal(hour: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Flow factor and concentration factor as functions of hour of day."""
    w = 2 * np.pi * hour / 24.0
    f_q = 1 + 0.28 * np.sin(w - 2.0) + 0.10 * np.sin(2 * w - 1.0)
    f_c = 1 + 0.22 * np.sin(w - 2.4) + 0.08 * np.sin(2 * w - 1.3)
    return f_q, f_c


def generate(scenario_id: str, days: float, dt_min: float = 1.0, seed: int = 7,
             start_day: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
    """Return (Q[n], C[n, 13]) sampled every dt_min minutes."""
    if scenario_id not in SCENARIOS:
        raise KeyError(scenario_id)
    n = int(round(days * 1440 / dt_min))
    t_day = start_day + np.arange(n) * dt_min / 1440.0
    hour = (t_day % 1.0) * 24.0
    rng = np.random.default_rng(seed)
    # AR(1) noise, ~1 h correlation
    a = np.exp(-dt_min / 60.0)
    e = rng.normal(0, 1, (n, 2))
    noise = np.zeros((n, 2))
    for i in range(1, n):
        noise[i] = a * noise[i - 1] + np.sqrt(1 - a * a) * e[i]
    f_q, f_c = _diurnal(hour)
    f_q = f_q * (1 + 0.04 * noise[:, 0])
    f_c = f_c * (1 + 0.05 * noise[:, 1])

    Q = BSM1_QIN * f_q
    C = np.tile(BSM1_INFLUENT, (n, 1))
    variable = [IDX[k] for k in ("SS", "XI", "XS", "XBH", "SNH", "SND", "XND")]
    C[:, variable] *= f_c[:, None]

    in_day = t_day % 1.0
    if scenario_id == "storm":
        first_day = t_day < 1.0
        rain = first_day & (hour >= 9) & (hour < 15)
        ramp = np.clip(np.minimum(hour - 9, 15 - hour), 0, 1.0)  # 1 h ramps
        mult = 1 + 1.5 * ramp * rain
        Q = Q * mult
        sol = [IDX[k] for k in ("SI", "SS", "SNH", "SND")]
        C[:, sol] /= mult[:, None]
        flush = rain & (hour < 11)
        part = [IDX[k] for k in ("XI", "XS", "XBH", "XND")]
        C[np.ix_(flush, part)] *= 1.4
    elif scenario_id == "nh4_shock":
        shock = (in_day * 24 >= 10) & (in_day * 24 < 16)
        C[shock, IDX["SNH"]] *= 2.2
    return Q, C
