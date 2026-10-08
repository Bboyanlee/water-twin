from __future__ import annotations

from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from ..config import DATABASE_URL
from .models import Base

engine = create_engine(DATABASE_URL, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

if engine.dialect.name == "sqlite":
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(conn, _):
        cur = conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()


def init_db() -> None:
    Base.metadata.create_all(engine)
    if engine.dialect.name == "postgresql":
        sql = (Path(__file__).with_name("timescale.sql")).read_text(encoding="utf-8")
        with engine.begin() as conn:
            conn.execute(text(sql))
