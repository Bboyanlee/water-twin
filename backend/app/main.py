"""FastAPI entry point. API contract: docs/api-contract.md."""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from . import config
from .catalog import plants as catalog
from .db.models import (AssetLicense, ControllerDef, KpiResult, Link, Measurement, Plant, ScenarioDef, SimRun,
                        SimSeries, Tag, Unit)
from .db.seed import ensure_synthetic, seed_catalog
from .db.session import SessionLocal, engine, init_db
from .sim.runner import KPI_META

log = logging.getLogger("water_twin")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    with SessionLocal() as s:
        seed_catalog(s)
        created = ensure_synthetic(s, config.SYNTH_DAYS)
        if created:
            log.warning("synthetic history generated: %s", created)
    yield


app = FastAPI(title="智慧水務平台 API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


def db():
    with SessionLocal() as s:
        yield s


def _plant_or_404(s, plant_id: str) -> Plant:
    p = s.get(Plant, plant_id)
    if not p:
        raise HTTPException(404, f"unknown plant {plant_id}")
    return p


# ---------------------------------------------------------------- plants
@app.get("/api/health")
def health():
    return {"status": "ok", "db": engine.dialect.name}


@app.get("/api/plants")
def plants(s=Depends(db)):
    return [dict(id=p.id, name=p.name, wastewater_type=p.wastewater_type, process_type=p.process_type,
                 has_simulator=p.has_simulator, description=p.description)
            for p in s.scalars(select(Plant).order_by(Plant.id.desc()))]


@app.get("/api/plants/{plant_id}/layout")
def layout(plant_id: str, s=Depends(db)):
    _plant_or_404(s, plant_id)
    units = s.scalars(select(Unit).where(Unit.plant_id == plant_id)).all()
    links = s.scalars(select(Link).where(Link.plant_id == plant_id)).all()
    return {
        "plant_id": plant_id,
        "units": [dict(id=u.unit_id, name=u.name, type=u.type, mesh_id=u.mesh_id, shape=u.shape,
                       position=u.position, size=u.size, meta=u.meta) for u in units],
        "links": [{"id": lk.link_id, "from": lk.from_unit, "to": lk.to_unit, "kind": lk.kind,
                   "flow_var": lk.flow_var} for lk in links],
    }


def _tag_dict(t: Tag) -> dict:
    return dict(tag_id=t.tag_id, plant_id=t.plant_id, unit_id=t.unit_id, name=t.name, category=t.category,
                param=t.param, eng_unit=t.eng_unit, lo=t.lo, hi=t.hi, period_s=t.period_s,
                is_setpoint=t.is_setpoint, sim_var=t.sim_var)


@app.get("/api/plants/{plant_id}/tags")
def tags(plant_id: str, s=Depends(db)):
    _plant_or_404(s, plant_id)
    return [_tag_dict(t) for t in s.scalars(select(Tag).where(Tag.plant_id == plant_id))]


@app.get("/api/plants/{plant_id}/latest")
def latest(plant_id: str, s=Depends(db)):
    _plant_or_404(s, plant_id)
    sub = (select(Measurement.tag_id, func.max(Measurement.ts).label("ts"))
           .join(Tag, Tag.tag_id == Measurement.tag_id).where(Tag.plant_id == plant_id)
           .group_by(Measurement.tag_id).subquery())
    rows = s.execute(select(Measurement.tag_id, Measurement.ts, Measurement.value)
                     .join(sub, (Measurement.tag_id == sub.c.tag_id) & (Measurement.ts == sub.c.ts))).all()
    return {"ts": max((r.ts for r in rows), default=None), "values": {r.tag_id: r.value for r in rows}}


@app.get("/api/limits")
def limits(plant_id: str = "muni"):
    return catalog.LIMITS.get(plant_id, {})


# ---------------------------------------------------------------- measurements
AGG_MS = {"raw": None, "15m": 900_000, "1h": 3_600_000}


@app.get("/api/measurements")
def measurements(tag_ids: str, start: int | None = None, end: int | None = None,
                 agg: str = Query("raw", pattern="^(raw|15m|1h)$"), s=Depends(db)):
    ids = [t for t in tag_ids.split(",") if t]
    if not ids:
        raise HTTPException(400, "tag_ids required")
    if end is None:
        end = s.scalar(select(func.max(Measurement.ts)).where(Measurement.tag_id.in_(ids))) or int(time.time() * 1000)
    if start is None:
        start = end - 86_400_000
    bucket = AGG_MS[agg]
    cond = (Measurement.tag_id.in_(ids)) & (Measurement.ts >= start) & (Measurement.ts <= end)
    if bucket:
        b = (Measurement.ts - Measurement.ts % bucket).label("b")
        q = select(Measurement.tag_id, b, func.avg(Measurement.value)).where(cond).group_by(Measurement.tag_id, b).order_by(b)
    else:
        q = select(Measurement.tag_id, Measurement.ts, Measurement.value).where(cond).order_by(Measurement.ts)
    out = {i: {"t": [], "v": []} for i in ids}
    for tag_id, ts, v in s.execute(q):
        out[tag_id]["t"].append(int(ts))
        out[tag_id]["v"].append(None if v is None else round(float(v), 4))
    return {"series": out}


class Point(BaseModel):
    tag_id: str
    ts: int | str
    value: float | None
    quality: int = 0


class Batch(BaseModel):
    points: list[Point] = Field(..., max_length=100_000)


def _to_ms(ts: int | str) -> int:
    if isinstance(ts, int):
        return ts
    return int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)


@app.post("/api/ingest/batch")
def ingest(batch: Batch, s=Depends(db)):
    known = set(s.scalars(select(Tag.tag_id).where(Tag.tag_id.in_({p.tag_id for p in batch.points}))))
    rows, rejected = {}, []
    for i, p in enumerate(batch.points):
        if p.tag_id not in known:
            rejected.append({"index": i, "reason": "unknown tag"})
            continue
        try:
            ts = _to_ms(p.ts)
        except ValueError:
            rejected.append({"index": i, "reason": "bad timestamp"})
            continue
        rows[(p.tag_id, ts)] = {"tag_id": p.tag_id, "ts": ts, "value": p.value, "quality": p.quality}
    existing = 0
    if rows:
        keys = list(rows)
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            found = s.execute(select(Measurement.tag_id, Measurement.ts).where(
                Measurement.tag_id.in_({k[0] for k in chunk}), Measurement.ts.in_({k[1] for k in chunk})))
            existing += len(set(map(tuple, found)) & set(chunk))
        ins =(pg_insert if engine.dialect.name == "postgresql" else sqlite_insert)(Measurement)
        stmt = ins.on_conflict_do_update(index_elements=["tag_id", "ts"],
                                         set_={"value": ins.excluded.value, "quality": ins.excluded.quality})
        s.execute(stmt, list(rows.values()))
        s.commit()
    return {"inserted": len(rows) - existing, "updated": existing, "rejected": rejected}


# ---------------------------------------------------------------- simulation
@app.get("/api/controllers")
def controllers(s=Depends(db)):
    return [dict(id=c.id, name=c.name, type=c.type, description=c.description)
            for c in s.scalars(select(ControllerDef))]


@app.get("/api/scenarios")
def scenarios(s=Depends(db)):
    return [dict(id=x.id, name=x.name, description=x.description, default_days=x.default_days)
            for x in s.scalars(select(ScenarioDef))]


@app.get("/api/kpis/meta")
def kpi_meta():
    return KPI_META


class CompareRequest(BaseModel):
    plant_id: str = "muni"
    scenario_id: str = "dry"
    controller_ids: list[str] = Field(default_factory=lambda: ["pid", "ai_mpc"], min_length=1, max_length=3)
    days: float = Field(1, gt=0, le=3)


@app.post("/api/sim/compare")
def compare(req: CompareRequest, s=Depends(db)):
    from .control.controllers import make_controller
    from .sim.runner import simulate

    p = _plant_or_404(s, req.plant_id)
    if not p.has_simulator:
        raise HTTPException(400, "此廠區尚未建置機理模擬器（目前只有 muni 可模擬）")
    if not s.get(ScenarioDef, req.scenario_id):
        raise HTTPException(404, f"unknown scenario {req.scenario_id}")
    group = uuid.uuid4().hex[:10]
    out = []
    for cid in req.controller_ids:
        if not s.get(ControllerDef, cid):
            raise HTTPException(404, f"unknown controller {cid}")
        res = simulate(make_controller(cid), req.scenario_id, req.days)
        run_id = "r_" + uuid.uuid4().hex[:10]
        s.add(SimRun(run_id=run_id, plant_id=req.plant_id, scenario_id=req.scenario_id, controller_id=cid,
                     days=req.days, created_at=int(time.time() * 1000), group_id=group))
        s.flush()
        for var, vals in res["series"].items():
            s.add(SimSeries(run_id=run_id, var=var,
                            values=[None if v is None else round(v, 4) for v in vals]))
        for k, v in res["kpis"].items():
            s.add(KpiResult(run_id=run_id, kpi=k, value=float(v)))
        out.append({"run_id": run_id, "controller_id": cid, "scenario_id": req.scenario_id, "kpis": res["kpis"]})
    s.commit()
    return {"group_id": group, "runs": out}


def _run_or_404(s, run_id: str) -> SimRun:
    r = s.get(SimRun, run_id)
    if not r:
        raise HTTPException(404, f"unknown run {run_id}")
    return r


@app.get("/api/sim/runs/{run_id}/states")
def run_states(run_id: str, step: int = Query(1, ge=1, le=60), s=Depends(db)):
    r = _run_or_404(s, run_id)
    series = {x.var: x.values[::step] for x in s.scalars(select(SimSeries).where(SimSeries.run_id == run_id))}
    n = len(next(iter(series.values()), []))
    return {"run_id": run_id, "controller_id": r.controller_id, "scenario_id": r.scenario_id,
            "dt_min": r.dt_min * step, "t_min": [i * r.dt_min * step for i in range(n)], "series": series}


@app.get("/api/sim/runs/{run_id}/kpis")
def run_kpis(run_id: str, s=Depends(db)):
    _run_or_404(s, run_id)
    return {"run_id": run_id, "kpis": {k.kpi: k.value for k in s.scalars(select(KpiResult).where(KpiResult.run_id == run_id))}}


@app.get("/api/models")
def models():
    from .control.surrogate import metadata
    return {"ai_mpc_surrogate": metadata()}


@app.get("/api/assets/licenses")
def asset_licenses(s=Depends(db)):
    return [dict(asset_name=a.asset_name, author=a.author, source_url=a.source_url, license=a.license,
                 modifications=a.modifications, used_in=a.used_in) for a in s.scalars(select(AssetLicense))]


# ---------------------------------------------------------------- live stream
def _replay_frames(plant_id: str) -> list[tuple[int, dict]]:
    """Last 24 h of a plant's data as forward-filled per-minute frames."""
    with SessionLocal() as s:
        end = s.scalar(select(func.max(Measurement.ts)).join(Tag, Tag.tag_id == Measurement.tag_id)
                       .where(Tag.plant_id == plant_id))
        if end is None:
            return []
        rows = s.execute(select(Measurement.ts, Measurement.tag_id, Measurement.value)
                         .join(Tag, Tag.tag_id == Measurement.tag_id)
                         .where(Tag.plant_id == plant_id, Measurement.ts > end - 86_400_000)
                         .order_by(Measurement.ts)).all()
    frames, current, last_ts = [], {}, None
    for ts, tag_id, v in rows:
        if last_ts is not None and ts != last_ts:
            frames.append((last_ts, dict(current)))
        current[tag_id] = v
        last_ts = ts
    if last_ts is not None:
        frames.append((last_ts, dict(current)))
    return frames


@app.websocket("/ws/live/{plant_id}")
async def live(ws: WebSocket, plant_id: str):
    await ws.accept()
    frames = await asyncio.to_thread(_replay_frames, plant_id)
    if not frames:
        await ws.close(code=1011)
        return
    i = 0
    try:
        while True:
            ts, values = frames[i % len(frames)]
            await ws.send_json({"ts": ts, "values": values})
            i += 1
            await asyncio.sleep(1.0)
    except (WebSocketDisconnect, RuntimeError):
        pass
