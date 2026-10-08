"""Train the AI controller surrogate and compare manual / PID / AI-MPC on each scenario."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.control.controllers import make_controller  # noqa: E402
from app.control.surrogate import train  # noqa: E402
from app.sim.runner import simulate  # noqa: E402

if "--skip-train" not in sys.argv:
    train()
keys = ["EQI", "AE_kWh_d", "total_energy_kWh_d", "eff_SNH_avg", "eff_TN_avg", "viol_SNH_pct", "viol_TN_pct", "setpoint_changes"]
for scen in ("dry", "nh4_shock", "storm"):
    print(f"\n== {scen} ==")
    for cid in ("manual", "pid", "ai_mpc"):
        t = time.time()
        r = simulate(make_controller(cid), scen, 1)
        print(f"{cid:7s} {time.time() - t:4.1f}s", {k: round(r['kpis'][k], 2) for k in keys})
