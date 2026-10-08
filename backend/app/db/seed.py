"""Load catalogue (plants, layouts, tags, controllers, scenarios) and synthetic data."""
from __future__ import annotations

import time

from sqlalchemy import func, select

from ..catalog import plants as catalog
from ..control.controllers import CONTROLLERS
from ..sim.influent import SCENARIOS
from .models import ControllerDef, Link, Measurement, Plant, ScenarioDef, Tag, Unit


def seed_catalog(session) -> None:
    for p in catalog.PLANTS:
        session.merge(Plant(**p))
    session.flush()
    for p in catalog.PLANTS:
        units, links = catalog.layout(p["id"])
        for u in units:
            session.merge(Unit(uid=f"{p['id']}.{u['id']}", plant_id=p["id"], unit_id=u["id"], name=u["name"],
                               type=u["type"], mesh_id=u["mesh_id"], shape=u["shape"], position=u["position"],
                               size=u["size"], meta=u["meta"]))
        for lk in links:
            session.merge(Link(uid=f"{p['id']}.{lk['id']}", plant_id=p["id"], link_id=lk["id"],
                               from_unit=lk["from"], to_unit=lk["to"], kind=lk["kind"], flow_var=lk["flow_var"]))
        for t in catalog.tags(p["id"]):
            session.merge(Tag(**t))
    for c in CONTROLLERS.values():
        session.merge(ControllerDef(id=c.id, name=c.name, type=c.type, description=c.description))
    for s in SCENARIOS.values():
        session.merge(ScenarioDef(id=s.id, name=s.name, description=s.description, default_days=s.default_days))
    session.commit()


def ensure_synthetic(session, days: float) -> dict | None:
    """Generate synthetic history once (when the measurement table is empty)."""
    n = session.scalar(select(func.count()).select_from(Measurement))
    if n:
        return None
    from ..synth.generator import populate
    t = time.time()
    counts = populate(session, days)
    counts["seconds"] = round(time.time() - t, 1)
    return counts
