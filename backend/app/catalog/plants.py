"""Demo plants: parametric 3D layouts and tag catalogues.

* muni : municipal A/O pre-denitrification plant = BSM1 layout (simulator-backed)
* semi : semiconductor fab wastewater, segregated streams (fluoride / CMP / ammonia / acid-base)
* pcb  : printed-circuit-board wastewater (chelated copper breaking, metal precipitation, IX polishing)

Industrial flowsheets are classic textbook/vendor sequences (see docs) and are
used with synthetic statistical data until a mechanistic model is added.
Discharge limits marked "示範值" must be checked against the plant permit.
"""
from __future__ import annotations

import math

PLANTS = [
    dict(id="muni", name="示範市政汙水廠（A/O 前置脫硝，BSM1）", wastewater_type="municipal",
         process_type="AO_BSM1", has_simulator=True,
         description="IWA BSM1 基準廠：2 座缺氧槽 + 3 座好氧槽 + 10 層二沉池，設計流量 18,446 m³/d。"),
    dict(id="semi", name="示範半導體廢水廠", wastewater_type="semiconductor", process_type="SEMI_PHYCHEM",
         has_simulator=False,
         description="分流處理：含氟廢水鈣鹽除氟、CMP 研磨廢水混凝沉澱、含氨廢水吹脫、酸鹼廢水，合併後兩段中和放流。"),
    dict(id="pcb", name="示範 PCB 廢水廠", wastewater_type="pcb", process_type="PCB_PHYCHEM", has_simulator=False,
         description="分流處理：化銅螯合廢水 Fenton 破錯→鹼化沉澱、清洗水、有機油墨廢水酸析，合併混凝沉澱、砂濾、離子交換放流。"),
]

LIMITS = {
    "muni": {"EFF.SNH": 4.0, "EFF.TN": 18.0, "EFF.COD": 100.0, "EFF.TSS": 30.0, "EFF.BOD5": 10.0},
    # 示範值：常見放流水標準量級，實際以許可證為準
    "semi": {"EFF.F": 15.0, "EFF.COD": 100.0, "EFF.SS": 30.0, "EFF.Cu": 3.0, "EFF.pH_hi": 9.0, "EFF.pH_lo": 6.0},
    "pcb": {"EFF.Cu": 3.0, "EFF.Ni": 1.0, "EFF.COD": 100.0, "EFF.SS": 30.0, "EFF.pH_hi": 9.0, "EFF.pH_lo": 6.0},
}


def _u(uid, name, typ, pos, size, shape="box", **meta):
    return dict(id=uid, name=name, type=typ, mesh_id=None, shape=shape, position=list(pos), size=list(size), meta=meta)


def _l(a, b, kind="water", flow_var=None):
    return dict(id=f"L_{a}_{b}", **{"from": a, "to": b}, kind=kind, flow_var=flow_var)


def _muni_layout():
    depth, width, gap = 4.5, 12.0, 1.0
    vols = [1000, 1000, 1333, 1333, 1333]
    names = ["缺氧槽 1", "缺氧槽 2", "好氧槽 1", "好氧槽 2", "好氧槽 3"]
    units, x = [], 0.0
    for i, (v, n) in enumerate(zip(vols, names)):
        length = v / (depth * width)
        aerobic = i >= 2
        units.append(_u(f"R{i + 1}", n, "aerobic_tank" if aerobic else "anoxic_tank",
                        (x + length / 2, 0, 0), (length, depth, width), volume_m3=v, aerated=aerobic))
        x += length + gap
    r5_end = x - gap
    cl_d = round(math.sqrt(1500 * 4 / math.pi), 1)
    cl_x = r5_end + 10 + cl_d / 2
    units += [
        _u("INF", "進流抽水井", "influent", (-24, 0, 0), (8, 5, 8)),
        _u("SCR", "攔汙柵", "screen", (-10, 0, 0), (6, 3, 5)),
        _u("CL", "二沉池", "clarifier", (cl_x, 0, 0), (cl_d, 4, cl_d), shape="cylinder", area_m2=1500, layers=10),
        _u("EFF", "放流井", "effluent", (cl_x + cl_d / 2 + 14, 0, 0), (8, 3, 8)),
        _u("BLW", "鼓風機房", "blower", (76, 0, -22), (16, 6, 9)),
        _u("P_A", "內循環泵", "pump", (52, 0, 14), (2.6, 2.6, 2.6), shape="cylinder"),
        _u("P_R", "回流汙泥泵", "pump", (cl_x - 10, 0, cl_d / 2 + 6), (2.6, 2.6, 2.6), shape="cylinder"),
        _u("P_W", "廢棄汙泥泵", "pump", (cl_x + 8, 0, cl_d / 2 + 6), (2.2, 2.2, 2.2), shape="cylinder"),
        _u("SLG", "汙泥處理（濃縮脫水）", "sludge", (cl_x + 22, 0, cl_d / 2 + 14), (14, 6, 10)),
        _u("CTRL", "中央控制室", "control_room", (-14, 0, -24), (14, 5, 9)),
    ]
    links = [
        _l("INF", "SCR", flow_var="INF.Q"), _l("SCR", "R1", flow_var="INF.Q"),
        _l("R1", "R2", flow_var="FLOW.Qmain"), _l("R2", "R3", flow_var="FLOW.Qmain"),
        _l("R3", "R4", flow_var="FLOW.Qmain"), _l("R4", "R5", flow_var="FLOW.Qmain"),
        _l("R5", "CL", flow_var="FLOW.Qmain"), _l("CL", "EFF", flow_var="EFF.Q"),
        _l("R5", "P_A", "recycle", "FLOW.Qa"), _l("P_A", "R1", "recycle", "FLOW.Qa"),
        _l("CL", "P_R", "sludge", "FLOW.Qr"), _l("P_R", "R1", "sludge", "FLOW.Qr"),
        _l("CL", "P_W", "sludge", "FLOW.Qw"), _l("P_W", "SLG", "sludge", "FLOW.Qw"),
        _l("BLW", "R3", "air", "R3.KLa"), _l("BLW", "R4", "air", "R4.KLa"), _l("BLW", "R5", "air", "R5.KLa"),
    ]
    return units, links


def _semi_layout():
    U, L = _u, _l
    units = [
        U("EQ_HF", "含氟廢水調勻池", "equalization", (0, 0, -32), (12, 4, 10)),
        U("F1", "除氟反應槽（鈣鹽）", "reactor", (20, 0, -32), (8, 4.5, 8), shape="cylinder"),
        U("F2", "除氟沉澱池", "clarifier", (40, 0, -32), (14, 4, 14), shape="cylinder"),
        U("EQ_CMP", "CMP 研磨廢水池", "equalization", (0, 0, -10), (12, 4, 10)),
        U("C1", "混凝槽（FeCl₃）", "reactor", (18, 0, -10), (6, 4, 6), shape="cylinder"),
        U("C2", "絮凝槽（PAM）", "reactor", (29, 0, -10), (6, 4, 6), shape="cylinder"),
        U("C3", "斜板沉澱池", "clarifier", (44, 0, -10), (14, 4.5, 9)),
        U("EQ_NH", "含氨廢水池", "equalization", (0, 0, 10), (12, 4, 10)),
        U("NH1", "氨氮吹脫塔", "reactor", (22, 0, 10), (4.5, 12, 4.5), shape="cylinder"),
        U("EQ_AB", "酸鹼廢水池", "equalization", (0, 0, 30), (12, 4, 10)),
        U("N1", "一段中和槽", "reactor", (68, 0, 4), (7, 4.5, 7), shape="cylinder"),
        U("N2", "二段中和槽", "reactor", (82, 0, 4), (7, 4.5, 7), shape="cylinder"),
        U("EFF", "放流槽", "effluent", (98, 0, 4), (9, 3, 9)),
        U("CHEM_CA", "鈣鹽加藥桶", "chem_tank", (20, 0, -48), (3, 4, 3), shape="cylinder"),
        U("CHEM_FE", "FeCl₃ 加藥桶", "chem_tank", (30, 0, -48), (3, 4, 3), shape="cylinder"),
        U("CHEM_PAM", "PAM 加藥桶", "chem_tank", (40, 0, -48), (3, 4, 3), shape="cylinder"),
        U("CHEM_NAOH", "NaOH 加藥桶", "chem_tank", (66, 0, -14), (3, 4, 3), shape="cylinder"),
        U("CHEM_H2SO4", "H₂SO₄ 加藥桶", "chem_tank", (76, 0, -14), (3, 4, 3), shape="cylinder"),
        U("SLG", "汙泥壓濾機房", "sludge", (62, 0, -34), (12, 6, 9)),
    ]
    links = [
        L("EQ_HF", "F1", flow_var="EQ_HF.Q"), L("F1", "F2", flow_var="EQ_HF.Q"), L("F2", "N1", flow_var="EQ_HF.Q"),
        L("EQ_CMP", "C1", flow_var="EQ_CMP.Q"), L("C1", "C2", flow_var="EQ_CMP.Q"), L("C2", "C3", flow_var="EQ_CMP.Q"),
        L("C3", "N1", flow_var="EQ_CMP.Q"), L("EQ_NH", "NH1", flow_var="EQ_NH.Q"), L("NH1", "N1", flow_var="EQ_NH.Q"),
        L("EQ_AB", "N1", flow_var="EQ_AB.Q"), L("N1", "N2", flow_var="EFF.Q"), L("N2", "EFF", flow_var="EFF.Q"),
        L("CHEM_CA", "F1", "chemical", "F1.CA_DOSE"), L("CHEM_FE", "C1", "chemical", "C1.FECL3_DOSE"),
        L("CHEM_PAM", "C2", "chemical", "C2.PAM_DOSE"), L("CHEM_NAOH", "N1", "chemical", "N1.NAOH_DOSE"),
        L("CHEM_H2SO4", "N1", "chemical", "N1.H2SO4_DOSE"),
        L("F2", "SLG", "sludge", None), L("C3", "SLG", "sludge", None),
    ]
    return units, links


def _pcb_layout():
    U, L = _u, _l
    units = [
        U("EQ_CU", "化銅螯合廢水池", "equalization", (0, 0, -24), (11, 4, 9)),
        U("BRK", "破錯反應槽（Fenton）", "reactor", (17, 0, -24), (6.5, 4.5, 6.5), shape="cylinder"),
        U("PH1", "鹼化反應槽", "reactor", (29, 0, -24), (6, 4.5, 6), shape="cylinder"),
        U("PREC", "重金屬沉澱池", "clarifier", (45, 0, -24), (12, 4, 12), shape="cylinder"),
        U("EQ_RINSE", "含銅清洗水池", "equalization", (0, 0, -6), (11, 4, 9)),
        U("EQ_ORG", "有機油墨廢水池", "equalization", (0, 0, 12), (11, 4, 9)),
        U("ORG1", "酸析槽", "reactor", (17, 0, 12), (6, 4.5, 6), shape="cylinder"),
        U("EQ_AB", "酸鹼廢水池", "equalization", (0, 0, 30), (11, 4, 9)),
        U("COAG", "混凝槽（PAC）", "reactor", (66, 0, 2), (6, 4, 6), shape="cylinder"),
        U("FLOC", "絮凝槽（PAM）", "reactor", (77, 0, 2), (6, 4, 6), shape="cylinder"),
        U("SED", "混凝沉澱池", "clarifier", (93, 0, 2), (12, 4, 12), shape="cylinder"),
        U("FIL", "砂濾槽", "filter", (108, 0, 2), (6, 5, 6)),
        U("IX", "離子交換塔", "filter", (118, 0, 2), (3, 6.5, 3), shape="cylinder"),
        U("EFF", "放流槽", "effluent", (130, 0, 2), (8, 3, 8)),
        U("CHEM_H2O2", "H₂O₂ 加藥桶", "chem_tank", (12, 0, -40), (3, 4, 3), shape="cylinder"),
        U("CHEM_FESO4", "FeSO₄ 加藥桶", "chem_tank", (22, 0, -40), (3, 4, 3), shape="cylinder"),
        U("CHEM_NAOH", "NaOH 加藥桶", "chem_tank", (32, 0, -40), (3, 4, 3), shape="cylinder"),
        U("CHEM_PAC", "PAC 加藥桶", "chem_tank", (66, 0, -14), (3, 4, 3), shape="cylinder"),
        U("CHEM_PAM", "PAM 加藥桶", "chem_tank", (77, 0, -14), (3, 4, 3), shape="cylinder"),
        U("SLG", "汙泥壓濾機房", "sludge", (70, 0, -30), (12, 6, 9)),
    ]
    links = [
        L("EQ_CU", "BRK", flow_var="EQ_CU.Q"), L("BRK", "PH1", flow_var="EQ_CU.Q"), L("PH1", "PREC", flow_var="EQ_CU.Q"),
        L("PREC", "COAG", flow_var="EQ_CU.Q"), L("EQ_RINSE", "COAG", flow_var="EQ_RINSE.Q"),
        L("EQ_ORG", "ORG1", flow_var="EQ_ORG.Q"), L("ORG1", "COAG", flow_var="EQ_ORG.Q"),
        L("EQ_AB", "COAG", flow_var="EQ_AB.Q"), L("COAG", "FLOC", flow_var="EFF.Q"), L("FLOC", "SED", flow_var="EFF.Q"),
        L("SED", "FIL", flow_var="EFF.Q"), L("FIL", "IX", flow_var="EFF.Q"), L("IX", "EFF", flow_var="EFF.Q"),
        L("CHEM_H2O2", "BRK", "chemical", "BRK.H2O2_DOSE"), L("CHEM_FESO4", "BRK", "chemical", "BRK.FESO4_DOSE"),
        L("CHEM_NAOH", "PH1", "chemical", "PH1.NAOH_DOSE"), L("CHEM_PAC", "COAG", "chemical", "COAG.PAC_DOSE"),
        L("CHEM_PAM", "FLOC", "chemical", "FLOC.PAM_DOSE"),
        L("PREC", "SLG", "sludge", None), L("SED", "SLG", "sludge", None),
    ]
    return units, links


def layout(plant_id: str) -> tuple[list, list]:
    units, links = {"muni": _muni_layout, "semi": _semi_layout, "pcb": _pcb_layout}[plant_id]()
    # centre the plant around the origin
    xs = [u["position"][0] for u in units]
    zs = [u["position"][2] for u in units]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    for u in units:
        u["position"] = [round(u["position"][0] - cx, 2), 0.0, round(u["position"][2] - cz, 2)]
        u["size"] = [round(s, 2) for s in u["size"]]
        u["mesh_id"] = f"{plant_id}_{u['id']}"
    return units, links


# ---------------------------------------------------------------------------
# Tag catalogue
# (unit, param, name, category, eng_unit, lo, hi, is_setpoint, sim_var, synth)
# synth for simulator-mapped tags: {"noise": sd, "drift": per-day}
# synth for statistical tags:      {"mean", "sd", "tau", "diurnal", "spikes"(per day), "spike"(magnitude)}
# ---------------------------------------------------------------------------
WQ, OP, CT, IND, EV = "water_quality", "operation", "control", "industrial", "event"


def _sim(noise, drift=0.0):
    return {"noise": noise, "drift": drift}


def _st(mean, sd, tau=60, diurnal=0.0, spikes=0.0, spike=0.0):
    return {"mean": mean, "sd": sd, "tau": tau, "diurnal": diurnal, "spikes": spikes, "spike": spike}


MUNI_TAGS = [
    ("INF", "Q", "進流流量", OP, "m³/d", 0, 60000, False, "INF.Q", _sim(150)),
    ("INF", "COD", "進流 COD", WQ, "mg/L", 0, 1200, False, "INF.COD", _sim(8)),
    ("INF", "NH4", "進流氨氮", WQ, "mg N/L", 0, 120, False, "INF.SNH", _sim(0.8)),
    ("INF", "TSS", "進流懸浮固體", WQ, "mg/L", 0, 800, False, "INF.TSS", _sim(6)),
    ("INF", "pH", "進流 pH", WQ, "pH", 0, 14, False, None, _st(7.25, 0.08, 90, 0.01)),
    ("INF", "TEMP", "進流水溫", WQ, "°C", 0, 40, False, None, _st(24.5, 0.3, 240, 0.03)),
    ("R1", "NO3", "缺氧槽 1 硝酸氮", WQ, "mg N/L", 0, 30, False, "R1.SNO", _sim(0.15)),
    ("R1", "ORP", "缺氧槽 1 ORP", WQ, "mV", -500, 500, False, None, _st(-120, 12, 60, 0.05)),
    ("R2", "NO3", "缺氧槽 2 硝酸氮", WQ, "mg N/L", 0, 30, False, "R2.SNO", _sim(0.15)),
    ("R2", "ORP", "缺氧槽 2 ORP", WQ, "mV", -500, 500, False, None, _st(-160, 12, 60, 0.05)),
    ("R3", "DO", "好氧槽 1 溶氧", WQ, "mg/L", 0, 10, False, "R3.SO", _sim(0.05, 0.08)),
    ("R3", "KLA", "好氧槽 1 曝氣強度 KLa", CT, "1/d", 0, 400, False, "R3.KLa", _sim(1.0)),
    ("R3", "DO_SP", "好氧槽 1 DO 設定值", CT, "mg/L", 0, 5, True, "R3.DO_sp", _sim(0.0)),
    ("R4", "DO", "好氧槽 2 溶氧", WQ, "mg/L", 0, 10, False, "R4.SO", _sim(0.05, 0.05)),
    ("R4", "KLA", "好氧槽 2 曝氣強度 KLa", CT, "1/d", 0, 400, False, "R4.KLa", _sim(1.0)),
    ("R4", "DO_SP", "好氧槽 2 DO 設定值", CT, "mg/L", 0, 5, True, "R4.DO_sp", _sim(0.0)),
    ("R5", "DO", "好氧槽 3 溶氧", WQ, "mg/L", 0, 10, False, "R5.SO", _sim(0.05, 0.06)),
    ("R5", "NH4", "好氧槽 3 氨氮", WQ, "mg N/L", 0, 60, False, "R5.SNH", _sim(0.08)),
    ("R5", "NO3", "好氧槽 3 硝酸氮", WQ, "mg N/L", 0, 40, False, "R5.SNO", _sim(0.15)),
    ("R5", "MLSS", "好氧槽 3 MLSS", OP, "mg/L", 0, 8000, False, "R5.TSS", _sim(25)),
    ("R5", "KLA", "好氧槽 3 曝氣強度 KLa", CT, "1/d", 0, 400, False, "R5.KLa", _sim(1.0)),
    ("R5", "DO_SP", "好氧槽 3 DO 設定值", CT, "mg/L", 0, 5, True, "R5.DO_sp", _sim(0.0)),
    ("R5", "SVI", "汙泥容積指數 SVI", OP, "mL/g", 0, 400, False, None, _st(115, 6, 720, 0.0)),
    ("CL", "SBH", "二沉池汙泥界面高度", OP, "m", 0, 4, False, "CL.blanket_m", _sim(0.03)),
    ("EFF", "Q", "放流流量", OP, "m³/d", 0, 60000, False, "EFF.Q", _sim(150)),
    ("EFF", "COD", "放流 COD", WQ, "mg/L", 0, 300, False, "EFF.COD", _sim(1.2)),
    ("EFF", "BOD5", "放流 BOD5", WQ, "mg/L", 0, 100, False, "EFF.BOD5", _sim(0.3)),
    ("EFF", "NH4", "放流氨氮", WQ, "mg N/L", 0, 60, False, "EFF.SNH", _sim(0.08)),
    ("EFF", "NO3", "放流硝酸氮", WQ, "mg N/L", 0, 40, False, "EFF.SNO", _sim(0.15)),
    ("EFF", "TN", "放流總氮", WQ, "mg N/L", 0, 80, False, "EFF.TN", _sim(0.2)),
    ("EFF", "TSS", "放流懸浮固體", WQ, "mg/L", 0, 200, False, "EFF.TSS", _sim(0.4)),
    ("EFF", "TP", "放流總磷", WQ, "mg P/L", 0, 10, False, None, _st(1.1, 0.12, 180, 0.08)),
    ("P_A", "Q", "內循環流量 Qa", CT, "m³/d", 0, 120000, False, "FLOW.Qa", _sim(200)),
    ("P_R", "Q", "回流汙泥流量 Qr", CT, "m³/d", 0, 60000, False, "FLOW.Qr", _sim(80)),
    ("P_W", "Q", "廢棄汙泥流量 Qw", CT, "m³/d", 0, 2000, False, "FLOW.Qw", _sim(3)),
    ("BLW", "KW", "鼓風機電力", OP, "kW", 0, 600, False, "ENERGY.aeration_kW", _sim(1.0)),
    ("CTRL", "PUMP_KW", "泵送總電力", OP, "kW", 0, 100, False, "ENERGY.pumping_kW", _sim(0.2)),
]

SEMI_TAGS = [
    ("EQ_HF", "Q", "含氟廢水流量", OP, "m³/h", 0, 120, False, None, _st(40, 4, 60, 0.12)),
    ("EQ_HF", "pH", "含氟廢水 pH", WQ, "pH", 0, 14, False, None, _st(2.6, 0.2, 60)),
    ("EQ_HF", "F", "含氟廢水氟離子", IND, "mg/L", 0, 3000, False, None, _st(850, 90, 120, 0.1, 1.0, 600)),
    ("EQ_HF", "LEVEL", "含氟調勻池液位", OP, "%", 0, 100, False, None, _st(55, 6, 180, 0.15)),
    ("F1", "pH", "除氟反應 pH", CT, "pH", 0, 14, False, None, _st(8.0, 0.15, 30)),
    ("F1", "pH_SP", "除氟反應 pH 設定值", CT, "pH", 0, 14, True, None, _st(8.0, 0.0, 600)),
    ("F1", "CA_DOSE", "鈣鹽加藥量", CT, "L/h", 0, 400, False, None, _st(160, 15, 60, 0.12)),
    ("F2", "F", "除氟沉澱出水氟離子", IND, "mg/L", 0, 200, False, None, _st(11, 1.5, 90, 0.08, 0.5, 8)),
    ("F2", "TURB", "除氟沉澱出水濁度", WQ, "NTU", 0, 200, False, None, _st(6, 1.2, 60)),
    ("EQ_CMP", "Q", "CMP 廢水流量", OP, "m³/h", 0, 200, False, None, _st(60, 6, 60, 0.12)),
    ("EQ_CMP", "TURB", "CMP 廢水濁度", WQ, "NTU", 0, 3000, False, None, _st(320, 40, 90, 0.1)),
    ("EQ_CMP", "TSS", "CMP 廢水懸浮固體", WQ, "mg/L", 0, 5000, False, None, _st(650, 80, 90, 0.1)),
    ("EQ_CMP", "Cu", "CMP 廢水銅", IND, "mg/L", 0, 50, False, None, _st(3.5, 0.6, 120)),
    ("C1", "pH", "混凝 pH", CT, "pH", 0, 14, False, None, _st(6.6, 0.12, 30)),
    ("C1", "FECL3_DOSE", "FeCl₃ 加藥量", CT, "L/h", 0, 100, False, None, _st(22, 2.5, 60, 0.1)),
    ("C2", "PAM_DOSE", "PAM 加藥量", CT, "L/h", 0, 30, False, None, _st(5.5, 0.6, 60, 0.1)),
    ("C3", "TURB", "斜板沉澱出水濁度", WQ, "NTU", 0, 200, False, None, _st(4.5, 0.8, 60, 0.0, 0.5, 10)),
    ("EQ_NH", "Q", "含氨廢水流量", OP, "m³/h", 0, 60, False, None, _st(15, 2, 60, 0.12)),
    ("EQ_NH", "NH4", "含氨廢水氨氮", IND, "mg N/L", 0, 2000, False, None, _st(320, 35, 120, 0.1)),
    ("NH1", "pH", "吹脫塔 pH", CT, "pH", 0, 14, False, None, _st(11.2, 0.15, 30)),
    ("NH1", "AIR", "吹脫風量", CT, "Nm³/h", 0, 4000, False, None, _st(1500, 60, 120)),
    ("NH1", "NH4", "吹脫出水氨氮", IND, "mg N/L", 0, 500, False, None, _st(38, 5, 90)),
    ("EQ_AB", "Q", "酸鹼廢水流量", OP, "m³/h", 0, 120, False, None, _st(30, 4, 60, 0.12)),
    ("EQ_AB", "pH", "酸鹼廢水 pH", WQ, "pH", 0, 14, False, None, _st(5.0, 0.8, 45, 0.0, 1.0, 3)),
    ("N1", "pH", "一段中和 pH", CT, "pH", 0, 14, False, None, _st(7.0, 0.25, 20)),
    ("N1", "pH_SP", "一段中和 pH 設定值", CT, "pH", 0, 14, True, None, _st(7.0, 0.0, 600)),
    ("N1", "NAOH_DOSE", "NaOH 加藥量", CT, "L/h", 0, 200, False, None, _st(45, 6, 30, 0.1)),
    ("N1", "H2SO4_DOSE", "H₂SO₄ 加藥量", CT, "L/h", 0, 100, False, None, _st(8, 2, 30)),
    ("N2", "pH", "二段中和 pH", CT, "pH", 0, 14, False, None, _st(7.2, 0.12, 30)),
    ("EFF", "Q", "放流流量", OP, "m³/h", 0, 400, False, None, _st(145, 10, 60, 0.12)),
    ("EFF", "pH", "放流 pH", WQ, "pH", 0, 14, False, None, _st(7.3, 0.1, 60)),
    ("EFF", "F", "放流氟離子", IND, "mg/L", 0, 100, False, None, _st(8.5, 1.2, 120, 0.06, 0.3, 6)),
    ("EFF", "COD", "放流 COD", WQ, "mg/L", 0, 300, False, None, _st(55, 6, 180, 0.08)),
    ("EFF", "SS", "放流懸浮固體", WQ, "mg/L", 0, 200, False, None, _st(12, 2, 120)),
    ("EFF", "Cu", "放流銅", IND, "mg/L", 0, 20, False, None, _st(0.45, 0.08, 180)),
    ("EFF", "NH4", "放流氨氮", WQ, "mg N/L", 0, 200, False, None, _st(22, 3, 180, 0.08)),
    ("EFF", "EC", "放流導電度", IND, "µS/cm", 0, 20000, False, None, _st(3800, 250, 120, 0.05)),
    ("SLG", "KW", "壓濾機電力", OP, "kW", 0, 200, False, None, _st(35, 8, 60, 0.2)),
]

PCB_TAGS = [
    ("EQ_CU", "Q", "化銅廢水流量", OP, "m³/h", 0, 60, False, None, _st(12, 1.5, 60, 0.15)),
    ("EQ_CU", "pH", "化銅廢水 pH", WQ, "pH", 0, 14, False, None, _st(11.5, 0.3, 60)),
    ("EQ_CU", "Cu", "化銅廢水銅（螯合）", IND, "mg/L", 0, 1000, False, None, _st(150, 20, 120, 0.1, 1.0, 120)),
    ("EQ_CU", "COD", "化銅廢水 COD", WQ, "mg/L", 0, 5000, False, None, _st(800, 80, 120, 0.1)),
    ("BRK", "pH", "破錯反應 pH", CT, "pH", 0, 14, False, None, _st(3.0, 0.15, 20)),
    ("BRK", "pH_SP", "破錯反應 pH 設定值", CT, "pH", 0, 14, True, None, _st(3.0, 0.0, 600)),
    ("BRK", "ORP", "破錯反應 ORP", CT, "mV", -500, 1000, False, None, _st(460, 30, 30)),
    ("BRK", "H2O2_DOSE", "H₂O₂ 加藥量", CT, "L/h", 0, 100, False, None, _st(18, 2.5, 30, 0.12)),
    ("BRK", "FESO4_DOSE", "FeSO₄ 加藥量", CT, "L/h", 0, 100, False, None, _st(14, 2, 30, 0.12)),
    ("PH1", "pH", "鹼化反應 pH", CT, "pH", 0, 14, False, None, _st(9.6, 0.15, 20)),
    ("PH1", "NAOH_DOSE", "NaOH 加藥量", CT, "L/h", 0, 200, False, None, _st(32, 4, 30, 0.12)),
    ("PREC", "Cu", "沉澱出水銅", IND, "mg/L", 0, 50, False, None, _st(1.2, 0.25, 90, 0.08, 0.5, 2.5)),
    ("EQ_RINSE", "Q", "清洗水流量", OP, "m³/h", 0, 200, False, None, _st(60, 6, 60, 0.15)),
    ("EQ_RINSE", "Cu", "清洗水銅", IND, "mg/L", 0, 200, False, None, _st(25, 4, 90, 0.1)),
    ("EQ_RINSE", "pH", "清洗水 pH", WQ, "pH", 0, 14, False, None, _st(3.2, 0.3, 60)),
    ("EQ_ORG", "Q", "油墨廢水流量", OP, "m³/h", 0, 40, False, None, _st(8, 1.2, 60, 0.15)),
    ("EQ_ORG", "COD", "油墨廢水 COD", WQ, "mg/L", 0, 20000, False, None, _st(3200, 350, 180, 0.1)),
    ("EQ_ORG", "pH", "油墨廢水 pH", WQ, "pH", 0, 14, False, None, _st(12.2, 0.2, 60)),
    ("ORG1", "pH", "酸析 pH", CT, "pH", 0, 14, False, None, _st(3.5, 0.15, 20)),
    ("EQ_AB", "Q", "酸鹼廢水流量", OP, "m³/h", 0, 120, False, None, _st(30, 4, 60, 0.12)),
    ("EQ_AB", "pH", "酸鹼廢水 pH", WQ, "pH", 0, 14, False, None, _st(4.2, 0.7, 45, 0.0, 1.0, 3)),
    ("COAG", "pH", "混凝 pH", CT, "pH", 0, 14, False, None, _st(7.6, 0.15, 20)),
    ("COAG", "PAC_DOSE", "PAC 加藥量", CT, "L/h", 0, 100, False, None, _st(26, 3, 60, 0.1)),
    ("FLOC", "PAM_DOSE", "PAM 加藥量", CT, "L/h", 0, 30, False, None, _st(6, 0.7, 60, 0.1)),
    ("SED", "TURB", "沉澱出水濁度", WQ, "NTU", 0, 200, False, None, _st(5, 0.9, 60, 0.0, 0.5, 8)),
    ("FIL", "DP", "砂濾壓差", OP, "kPa", 0, 150, False, None, _st(35, 3, 600, 0.0)),
    ("IX", "Cu", "離子交換出水銅", IND, "mg/L", 0, 10, False, None, _st(0.18, 0.04, 180)),
    ("IX", "EC", "離子交換出水導電度", IND, "µS/cm", 0, 10000, False, None, _st(1500, 120, 120)),
    ("EFF", "Q", "放流流量", OP, "m³/h", 0, 400, False, None, _st(110, 9, 60, 0.12)),
    ("EFF", "pH", "放流 pH", WQ, "pH", 0, 14, False, None, _st(7.4, 0.1, 60)),
    ("EFF", "Cu", "放流銅", IND, "mg/L", 0, 20, False, None, _st(0.3, 0.06, 180, 0.05, 0.3, 1.0)),
    ("EFF", "Ni", "放流鎳", IND, "mg/L", 0, 10, False, None, _st(0.12, 0.03, 180)),
    ("EFF", "COD", "放流 COD", WQ, "mg/L", 0, 300, False, None, _st(68, 7, 180, 0.08)),
    ("EFF", "SS", "放流懸浮固體", WQ, "mg/L", 0, 200, False, None, _st(12, 2, 120)),
    ("SLG", "KW", "壓濾機電力", OP, "kW", 0, 200, False, None, _st(28, 6, 60, 0.2)),
]

TAGS = {"muni": MUNI_TAGS, "semi": SEMI_TAGS, "pcb": PCB_TAGS}


def tags(plant_id: str) -> list[dict]:
    out = []
    for unit, param, name, cat, eu, lo, hi, is_sp, sim_var, synth in TAGS[plant_id]:
        out.append(dict(tag_id=f"{plant_id}.{unit}.{param}", plant_id=plant_id, unit_id=unit, name=name,
                        category=cat, param=param, eng_unit=eu, lo=lo, hi=hi, period_s=60,
                        is_setpoint=is_sp, sim_var=sim_var, synth=synth))
    return out
