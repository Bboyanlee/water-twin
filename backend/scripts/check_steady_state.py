"""Sanity check: BSM1 open-loop steady state vs. published benchmark values."""
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.sim.bsm1 import BSM1Plant, BSM1_INFLUENT, BSM1_QIN, Actuators  # noqa: E402

p = BSM1Plant()
t = time.time()
y = p.steady_state()
print("steady-state solve s:", round(time.time() - t, 1))
np.set_printoptions(precision=2, suppress=True, linewidth=200)
print(y[:65].reshape(5, 13))
print("settler TSS:", y[65:75])
act = Actuators(kla=np.array([0, 0, 240, 240, 84.0]))
o = p.outputs(y, BSM1_QIN, BSM1_INFLUENT, act)
print({k: round(v, 2) for k, v in o.items() if k.startswith(("EFF", "ENERGY", "CL.blanket"))})
# published BSM1 open-loop steady state, reactor 5 (Copp 2002)
ref = {"SO": 0.49, "SNO": 10.42, "SNH": 1.73, "XBH": 2559.0, "XBA": 149.8}
C5 = y[:65].reshape(5, 13)[4]
print("ref R5", ref, "| got", dict(SO=C5[7], SNO=C5[8], SNH=C5[9], XBH=C5[4], XBA=C5[5]))
t = time.time()
for _ in range(1440):
    y = p.step_rk4(y, 1 / 1440, BSM1_QIN, BSM1_INFLUENT, act)
print("1 day RK4 s:", round(time.time() - t, 2))
print("R5 after 1 day RK4:", y[:65].reshape(5, 13)[4])
