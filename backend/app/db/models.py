"""Database schema. Portable SQLAlchemy models (SQLite locally, PostgreSQL + TimescaleDB in the cloud).

Time columns are epoch milliseconds (BIGINT, UTC) so the same schema works on both engines;
on TimescaleDB ``measurement`` becomes a hypertable (see timescale.sql).
"""
from __future__ import annotations

from sqlalchemy import JSON, BigInteger, Boolean, Float, ForeignKey, Index, Integer, SmallInteger, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


# ---------- dimensions ----------
class Plant(Base):
    __tablename__ = "plant"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    wastewater_type: Mapped[str] = mapped_column(String(32))   # municipal|semiconductor|pcb|food|chemical
    process_type: Mapped[str] = mapped_column(String(32))
    has_simulator: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str] = mapped_column(Text, default="")


class Unit(Base):
    __tablename__ = "unit"
    uid: Mapped[str] = mapped_column(String(64), primary_key=True)          # "{plant}.{unit}"
    plant_id: Mapped[str] = mapped_column(ForeignKey("plant.id"), index=True)
    unit_id: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(32))
    mesh_id: Mapped[str] = mapped_column(String(64))                        # 3D node name
    shape: Mapped[str] = mapped_column(String(16), default="box")
    position: Mapped[list] = mapped_column(JSON)                            # [x, y, z] m
    size: Mapped[list] = mapped_column(JSON)                                # [w, h, d] m
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class Link(Base):
    __tablename__ = "link"
    uid: Mapped[str] = mapped_column(String(96), primary_key=True)
    plant_id: Mapped[str] = mapped_column(ForeignKey("plant.id"), index=True)
    link_id: Mapped[str] = mapped_column(String(64))
    from_unit: Mapped[str] = mapped_column(String(32))
    to_unit: Mapped[str] = mapped_column(String(32))
    kind: Mapped[str] = mapped_column(String(16))                           # water|recycle|sludge|air|chemical
    flow_var: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Tag(Base):
    __tablename__ = "tag"
    tag_id: Mapped[str] = mapped_column(String(96), primary_key=True)      # "{plant}.{unit}.{param}"
    plant_id: Mapped[str] = mapped_column(ForeignKey("plant.id"), index=True)
    unit_id: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(24))                       # water_quality|operation|control|industrial|event
    param: Mapped[str] = mapped_column(String(32))
    eng_unit: Mapped[str] = mapped_column(String(24))
    lo: Mapped[float | None] = mapped_column(Float, nullable=True)
    hi: Mapped[float | None] = mapped_column(Float, nullable=True)
    period_s: Mapped[int] = mapped_column(Integer, default=60)
    is_setpoint: Mapped[bool] = mapped_column(Boolean, default=False)
    sim_var: Mapped[str | None] = mapped_column(String(64), nullable=True)  # simulator variable it maps to
    synth: Mapped[dict] = mapped_column(JSON, default=dict)                 # synthetic data profile


class ControllerDef(Base):
    __tablename__ = "controller"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    type: Mapped[str] = mapped_column(String(16))                           # manual|PID|MPC|RL
    description: Mapped[str] = mapped_column(Text, default="")
    params: Mapped[dict] = mapped_column(JSON, default=dict)


class ScenarioDef(Base):
    __tablename__ = "scenario"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(Text, default="")
    default_days: Mapped[int] = mapped_column(Integer, default=1)


# ---------- time series facts ----------
class Measurement(Base):
    __tablename__ = "measurement"
    tag_id: Mapped[str] = mapped_column(ForeignKey("tag.tag_id"), primary_key=True)
    ts: Mapped[int] = mapped_column(BigInteger, primary_key=True)           # epoch ms UTC
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality: Mapped[int] = mapped_column(SmallInteger, default=0)           # 0 good, 1 suspect, 2 bad
    __table_args__ = (Index("ix_measurement_ts", "ts"),)


class SetpointEvent(Base):
    __tablename__ = "setpoint_event"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(BigInteger, index=True)
    tag_id: Mapped[str] = mapped_column(ForeignKey("tag.tag_id"))
    value: Mapped[float] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16))                         # operator|PID|AI


class LabSample(Base):
    __tablename__ = "lab_sample"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[int] = mapped_column(BigInteger, index=True)
    plant_id: Mapped[str] = mapped_column(ForeignKey("plant.id"))
    unit_id: Mapped[str] = mapped_column(String(32))
    param: Mapped[str] = mapped_column(String(32))
    value: Mapped[float] = mapped_column(Float)
    method: Mapped[str] = mapped_column(String(64), default="")


# ---------- simulation & comparison ----------
class SimRun(Base):
    __tablename__ = "sim_run"
    run_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    plant_id: Mapped[str] = mapped_column(ForeignKey("plant.id"))
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenario.id"))
    controller_id: Mapped[str] = mapped_column(ForeignKey("controller.id"))
    days: Mapped[float] = mapped_column(Float)
    dt_min: Mapped[float] = mapped_column(Float, default=1.0)
    model_version: Mapped[str] = mapped_column(String(64), default="bsm1-asm1")
    created_at: Mapped[int] = mapped_column(BigInteger)
    group_id: Mapped[str] = mapped_column(String(32), index=True)          # runs compared together
    params: Mapped[dict] = mapped_column(JSON, default=dict)


class SimSeries(Base):
    """One simulated variable of one run, stored column-wise (fast playback)."""
    __tablename__ = "sim_series"
    run_id: Mapped[str] = mapped_column(ForeignKey("sim_run.run_id"), primary_key=True)
    var: Mapped[str] = mapped_column(String(48), primary_key=True)
    values: Mapped[list] = mapped_column(JSON)


class KpiResult(Base):
    __tablename__ = "kpi_result"
    run_id: Mapped[str] = mapped_column(ForeignKey("sim_run.run_id"), primary_key=True)
    kpi: Mapped[str] = mapped_column(String(48), primary_key=True)
    value: Mapped[float] = mapped_column(Float)
    ci_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    ci_high: Mapped[float | None] = mapped_column(Float, nullable=True)


class ModelRegistry(Base):
    __tablename__ = "model_registry"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))                           # surrogate|forecast|rl
    version: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[int] = mapped_column(BigInteger)
    path: Mapped[str] = mapped_column(String(256))
    metrics: Mapped[dict] = mapped_column(JSON, default=dict)


class AssetLicense(Base):
    """Attribution record for every third-party 3D asset (CC-BY requires credit)."""
    __tablename__ = "asset_license"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    asset_name: Mapped[str] = mapped_column(String(128))
    author: Mapped[str] = mapped_column(String(128))
    source_url: Mapped[str] = mapped_column(String(512))
    license: Mapped[str] = mapped_column(String(32))                        # CC-BY-4.0|CC0|...
    modifications: Mapped[str] = mapped_column(Text, default="")
    used_in: Mapped[str] = mapped_column(String(128), default="")
