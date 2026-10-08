def test_catalogue(client):
    assert client.get("/api/health").json()["status"] == "ok"
    ids = {p["id"] for p in client.get("/api/plants").json()}
    assert ids == {"muni", "semi", "pcb"}
    for pid in ids:
        lay = client.get(f"/api/plants/{pid}/layout").json()
        unit_ids = {u["id"] for u in lay["units"]}
        assert all(lk["from"] in unit_ids and lk["to"] in unit_ids for lk in lay["links"])
        tags = client.get(f"/api/plants/{pid}/tags").json()
        assert tags and all(t["unit_id"] in unit_ids for t in tags)
    assert client.get("/api/plants/nope/layout").status_code == 404


def test_measurements_and_latest(client):
    latest = client.get("/api/plants/muni/latest").json()
    assert latest["ts"] and "muni.R5.DO" in latest["values"]
    raw = client.get("/api/measurements", params={"tag_ids": "muni.R5.DO,semi.EFF.F"}).json()["series"]
    assert len(raw["muni.R5.DO"]["t"]) > 300 and len(raw["semi.EFF.F"]["v"]) > 300
    agg = client.get("/api/measurements", params={"tag_ids": "muni.R5.DO", "agg": "1h"}).json()["series"]
    assert 8 <= len(agg["muni.R5.DO"]["t"]) <= 25


def test_ingest_upsert(client):
    pts = [{"tag_id": "pcb.EFF.Cu", "ts": 1_000_000_000_000, "value": 0.5},
           {"tag_id": "pcb.EFF.Cu", "ts": "2001-09-09T01:47:40Z", "value": 0.6},
           {"tag_id": "nope.X", "ts": 1, "value": 1}]
    r1 = client.post("/api/ingest/batch", json={"points": pts}).json()
    assert r1["inserted"] == 2 and r1["updated"] == 0 and r1["rejected"][0]["index"] == 2
    r2 = client.post("/api/ingest/batch", json={"points": pts[:1]}).json()
    assert r2 == {"inserted": 0, "updated": 1, "rejected": []}


def test_compare_and_playback(client):
    r = client.post("/api/sim/compare", json={"scenario_id": "dry", "controller_ids": ["manual", "pid"], "days": 0.25})
    assert r.status_code == 200, r.text
    runs = r.json()["runs"]
    assert [x["controller_id"] for x in runs] == ["manual", "pid"]
    st = client.get(f"/api/sim/runs/{runs[1]['run_id']}/states", params={"step": 5}).json()
    assert len(st["t_min"]) == 72 and len(st["series"]["R5.SO"]) == 72 and "CL.blanket_m" in st["series"]
    k = client.get(f"/api/sim/runs/{runs[0]['run_id']}/kpis").json()["kpis"]
    meta_keys = {m["key"] for m in client.get("/api/kpis/meta").json()}
    assert meta_keys <= set(k)
    assert client.post("/api/sim/compare", json={"plant_id": "semi"}).status_code == 400


def test_live_websocket(client):
    with client.websocket_connect("/ws/live/muni") as ws:
        msg = ws.receive_json()
    assert msg["ts"] and "muni.R5.DO" in msg["values"]
