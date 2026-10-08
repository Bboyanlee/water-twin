"""Diagnostics: fixed DO setpoint x Qa trade-off, and surrogate sensitivity to the setpoint."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.control.controllers import PIDController  # noqa: E402
from app.control.surrogate import load_or_train  # noqa: E402
from app.sim.runner import simulate  # noqa: E402

keys = ["EQI", "AE_kWh_d", "eff_SNH_avg", "eff_TN_avg", "viol_SNH_pct", "viol_TN_pct"]
scen = sys.argv[1] if len(sys.argv) > 1 else "dry"
for qa in (0.6, 1.0, 1.4):
    for sp in (0.75, 1.0, 1.5, 2.0, 2.5, 3.0):
        c = PIDController(do_sp=sp)
        orig = c.reset

        def reset(c=c, orig=orig, qa=qa):
            orig()
            c.qa_factor = qa
        c.reset = reset
        r = simulate(c, scen, 1)
        print(f"qa={qa} sp={sp}", {k: round(r["kpis"][k], 1) for k in keys}, flush=True)

s = load_or_train()
r = simulate(PIDController(), scen, 1)
ser = r["series"]
for t in (240, 600, 900, 1200):
    obs = {k: ser[k][t] for k in ser}
    sps = np.array([0.5, 1.0, 1.5, 2.0, 2.5, 3.0])
    p = s.predict(obs, t, 2.0, 1.0, sps, np.ones_like(sps))
    print(f"t={t} R5.SNH={obs['R5.SNH']:.2f}", {k: np.round(v, 2).tolist() for k, v in p.items()})
