"""Trace AI-MPC decisions over one day."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.control.controllers import AIMPCController  # noqa: E402
from app.control.surrogate import load_or_train  # noqa: E402
from app.sim.runner import simulate  # noqa: E402


class Traced(AIMPCController):
    def _decide(self, obs, t_min):
        super()._decide(obs, t_min)
        if int(t_min) % 120 == 0:
            print(f"t={t_min:6.0f} R5.SNH={obs['R5.SNH']:.2f} R5.SO={obs['R5.SO']:.2f} -> sp={self.sp[0]} "
                  f"qa={self.qa_factor} pred={ {k: round(v, 2) for k, v in self.last_prediction.items()} }")


r = simulate(Traced(load_or_train()), "dry", 1, warmup_days=0.25)
sp = np.array(r["series"]["R5.DO_sp"])
print("sp unique:", np.unique(sp), "changes:", r["kpis"]["setpoint_changes"])
