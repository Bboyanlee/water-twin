"""Synthetic 1-minute IoT data (stands in until real sensor data is available).

* muni : simulator run under current practice (PID DO loops + operator setpoint bumps),
         mapped to sensor tags with noise, DO-probe drift (daily calibration reset),
         random packet loss, communication outages and spikes.
* semi / pcb : statistical AR(1) signals around catalogue profiles, sharing a common
         production-load factor, with diurnal pattern and occasional excursions.
Quality flag: 0 = good, 1 = suspect (spike).
"""
from __future__ import annotations

import time

import numpy as np
from sqlalchemy import delete, insert

from ..catalog import plants as catalog
from ..control.controllers import PIDController
from ..db.models import Measurement, SetpointEvent
from ..sim.runner import simulate

MIN_MS = 60_000


class OperatorPID(PIDController):
    """Current practice: PI DO loops, operators raise the setpoint during the daily peak."""

    def __init__(self):
        super().__init__(do_sp=2.0)
        self.events: list[tuple[float, float]] = []

    def step(self, obs, t_min, dt_day):
        hour = (t_min % 1440) / 60.0
        sp = 2.5 if 9.0 <= hour < 17.0 else 2.0
        if sp != self.sp[0]:
            self.events.append((t_min, sp))
        self.sp[:] = sp
        return self._apply(obs, dt_day)


def _ar1(n: int, tau: float, rng) -> np.ndarray:
    a = np.exp(-1.0 / max(tau, 1.0))
    e = rng.normal(0, 1, n)
    x = np.empty(n)
    x[0] = e[0]
    for i in range(1, n):
        x[i] = a * x[i - 1] + np.sqrt(1 - a * a) * e[i]
    return x


def _impair(values: np.ndarray, rng, outages: list[tuple[int, int]], spike_rate=0.0005):
    """Return (keep_mask, values, quality) after packet loss, outages and spikes."""
    n = len(values)
    keep = rng.random(n) > 0.002
    for a, b in outages:
        keep[a:b] = False
    quality = np.zeros(n, dtype=int)
    spikes = rng.random(n) < spike_rate
    values = values.copy()
    values[spikes] *= rng.choice([0.2, 2.5], spikes.sum())
    quality[spikes] = 1
    return keep, values, quality


def _outages(n: int, rng) -> list[tuple[int, int]]:
    days = max(1, n // 1440)
    out = []
    for d in range(days):
        start = d * 1440 + int(rng.integers(0, 1400))
        out.append((start, start + int(rng.integers(10, 35))))
    return out


def _rows_for_tag(tag_id, values, keep, quality, start_ms, lo, hi):
    vals = np.clip(values, lo if lo is not None else -np.inf, hi if hi is not None else np.inf)
    idx = np.nonzero(keep)[0]
    return [{"tag_id": tag_id, "ts": int(start_ms + i * MIN_MS), "value": round(float(vals[i]), 4),
             "quality": int(quality[i])} for i in idx]


def generate_muni(days: float, end_ms: int, seed: int = 11):
    rng = np.random.default_rng(seed)
    ctrl = OperatorPID()
    res = simulate(ctrl, "dry", days, warmup_days=1.0, seed=seed)
    s = res["series"]
    n = len(s["EFF.Q"])
    start_ms = end_ms - n * MIN_MS
    unit_outages = {}
    rows = []
    t = np.arange(n)
    production = 1 + 0.03 * _ar1(n, 240, rng)
    for tg in catalog.tags("muni"):
        prof = tg["synth"]
        if tg["sim_var"]:
            base = np.array([np.nan if v is None else v for v in s[tg["sim_var"]]], dtype=float)
            if tg["is_setpoint"]:
                vals = base
            else:
                drift = prof.get("drift", 0.0) * (((t - 9 * 60) % 1440) / 1440.0)  # recalibrated 09:00 daily
                vals = base + drift + rng.normal(0, prof["noise"], n)
        else:
            diurnal = prof["diurnal"] * np.sin(2 * np.pi * (t % 1440) / 1440.0 - 2.0)
            vals = prof["mean"] * (1 + diurnal) + prof["sd"] * _ar1(n, prof["tau"], rng)
            vals *= production if tg["category"] == "operation" else 1.0
        if tg["is_setpoint"]:
            keep, quality = np.ones(n, bool), np.zeros(n, int)
        else:
            outs = unit_outages.setdefault(tg["unit_id"], _outages(n, rng))
            keep, vals, quality = _impair(vals, rng, outs)
        rows += _rows_for_tag(tg["tag_id"], vals, keep, quality, start_ms, tg["lo"], tg["hi"])
    events = [{"ts": int(start_ms + tm * MIN_MS), "tag_id": f"muni.{u}.DO_SP", "value": sp, "source": "operator"}
              for tm, sp in ctrl.events if tm < n for u in ("R3", "R4", "R5")]
    return rows, events


def generate_statistical(plant_id: str, days: float, end_ms: int, seed: int = 21):
    rng = np.random.default_rng(seed + sum(map(ord, plant_id)))
    n = int(days * 1440)
    start_ms = end_ms - n * MIN_MS
    t = np.arange(n)
    production = 1 + 0.06 * _ar1(n, 180, rng)
    unit_outages, rows = {}, []
    for tg in catalog.tags(plant_id):
        p = tg["synth"]
        diurnal = p["diurnal"] * np.sin(2 * np.pi * (t % 1440) / 1440.0 - 1.6)
        vals = p["mean"] * (1 + diurnal) + p["sd"] * _ar1(n, p["tau"], rng)
        if tg["param"] in ("Q",) or tg["param"].endswith("_DOSE"):
            vals *= production
        # process excursions (e.g. pH swing, concentration slug) lasting 20-90 min
        n_exc = rng.poisson(p["spikes"] * days)
        for _ in range(n_exc):
            a = int(rng.integers(0, n))
            b = min(n, a + int(rng.integers(20, 90)))
            shape = np.sin(np.linspace(0, np.pi, b - a))
            vals[a:b] += p["spike"] * shape * rng.choice([-1, 1] if tg["param"] == "pH" else [1])
        if tg["is_setpoint"]:
            vals = np.full(n, p["mean"])
            keep, quality = np.ones(n, bool), np.zeros(n, int)
        else:
            outs = unit_outages.setdefault(tg["unit_id"], _outages(n, rng))
            keep, vals, quality = _impair(vals, rng, outs)
        rows += _rows_for_tag(tg["tag_id"], vals, keep, quality, start_ms, tg["lo"], tg["hi"])
    return rows, []


def populate(session, days: float, end_ms: int | None = None, plant_ids=("muni", "semi", "pcb")) -> dict:
    end_ms = end_ms or (int(time.time() * 1000) // MIN_MS) * MIN_MS
    counts = {}
    for pid in plant_ids:
        rows, events = generate_muni(days, end_ms) if pid == "muni" else generate_statistical(pid, days, end_ms)
        tag_ids = [t["tag_id"] for t in catalog.tags(pid)]
        session.execute(delete(Measurement).where(Measurement.tag_id.in_(tag_ids)))
        session.execute(delete(SetpointEvent).where(SetpointEvent.tag_id.in_(tag_ids)))
        for i in range(0, len(rows), 20000):
            session.execute(insert(Measurement), rows[i:i + 20000])
        if events:
            session.execute(insert(SetpointEvent), events)
        session.commit()
        counts[pid] = len(rows)
    return counts
