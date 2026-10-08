import numpy as np

from app.control.controllers import ManualController, PIDController
from app.sim.runner import simulate, steady_state


def test_open_loop_steady_state_matches_bsm1():
    C5 = steady_state()[:65].reshape(5, 13)[4]
    # published BSM1 open-loop steady state, reactor 5 (Copp 2002)
    assert abs(C5[7] - 0.49) < 0.05      # SO
    assert abs(C5[8] - 10.42) < 0.5      # SNO
    assert abs(C5[9] - 1.73) < 0.2       # SNH
    assert abs(C5[4] - 2559) / 2559 < 0.02  # XBH


def test_pid_tracks_do_setpoint():
    r = simulate(PIDController(do_sp=2.0), "dry", 0.5)
    so = np.array(r["series"]["R5.SO"][120:])
    assert abs(so.mean() - 2.0) < 0.1


def test_kpis_and_clock_continuity():
    """Controllers keyed on t_min must keep acting after the warm-up (regression)."""
    class Stepper(PIDController):
        def step(self, obs, t_min, dt_day):
            self.sp[:] = 1.5 if int(t_min // 60) % 2 else 2.5
            return self._apply(obs, dt_day)

    r = simulate(Stepper(), "dry", 0.5, warmup_days=1)
    assert r["kpis"]["setpoint_changes"] >= 10
    m = simulate(ManualController(), "dry", 0.5)["kpis"]
    assert m["setpoint_changes"] == 0
    assert m["AE_kWh_d"] > 0 and m["EQI"] > 0
