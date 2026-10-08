"""Control strategies sharing one interface: ``actuators = controller.step(obs, t_min)``.

* manual  : fixed blower settings chosen by an operator (BSM1 open loop KLa values)
* pid     : PI dissolved-oxygen loops in the three aerobic tanks, fixed setpoint 2 mg/L
* ai_mpc  : same PI loops, but the DO setpoint is re-optimised every 15 min by a
            data-driven surrogate model (model predictive control)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..sim.bsm1 import Actuators

AEROBIC = (2, 3, 4)          # reactor indices R3..R5
KLA_MAX = 360.0
BASE_FLOWS = dict(Qa=55338.0, Qr=18446.0, Qw=385.0)


@dataclass(frozen=True)
class ControllerInfo:
    id: str
    name: str
    type: str
    description: str


CONTROLLERS = {
    c.id: c for c in [
        ControllerInfo("manual", "傳統定值（人工設定）", "manual",
                       "操作員固定鼓風機出力：好氧槽 1、2 的 KLa=240 1/d，好氧槽 3 的 KLa=84 1/d，不隨負荷調整。"),
        ControllerInfo("pid", "PID 溶氧控制", "PID",
                       "三座好氧槽各一組 PI 迴路，以 KLa（曝氣量）追蹤固定 DO 設定值 2.0 mg/L。"),
        ControllerInfo("ai_mpc", "AI 智慧控制（代理模型 MPC）", "MPC",
                       "每 15 分鐘以機器學習代理模型預測未來 1 小時的放流氨氮、總氮與曝氣能耗，"
                       "在能耗與出水品質之間取最佳平衡，同時決定 DO 設定值與內循環流量，再交給 PI 迴路執行。"),
    ]
}


class PI:
    """Discrete PI with back-calculation anti-windup (time in days)."""

    def __init__(self, K: float, Ti: float, Tt: float, u0: float, lo: float = 0.0, hi: float = KLA_MAX):
        self.K, self.Ti, self.Tt, self.lo, self.hi = K, Ti, Tt, lo, hi
        self.integral = u0
        self.u = u0

    def update(self, sp: float, pv: float, dt: float) -> float:
        e = sp - pv
        v = self.K * e + self.integral
        u = min(max(v, self.lo), self.hi)
        self.integral += (self.K / self.Ti * e + (u - v) / self.Tt) * dt
        self.u = u
        return u


class Controller:
    info: ControllerInfo

    def reset(self) -> None: ...

    def step(self, obs: dict, t_min: float, dt_day: float) -> Actuators:
        raise NotImplementedError

    def setpoints(self) -> dict:
        return {}


class ManualController(Controller):
    info = CONTROLLERS["manual"]

    def __init__(self, kla=(0.0, 0.0, 240.0, 240.0, 84.0)):
        self.kla = np.array(kla, dtype=float)

    def step(self, obs, t_min, dt_day):
        return Actuators(kla=self.kla.copy(), **BASE_FLOWS)

    def setpoints(self):
        return {"R3.DO_sp": None, "R4.DO_sp": None, "R5.DO_sp": None}


class PIDController(Controller):
    info = CONTROLLERS["pid"]

    def __init__(self, do_sp: float = 2.0):
        self.base_sp = do_sp
        self.reset()

    def reset(self):
        self.sp = np.full(3, self.base_sp)
        self.qa_factor = 1.0
        self.loops = [PI(K=60.0, Ti=0.01, Tt=0.005, u0=150.0) for _ in AEROBIC]

    def _apply(self, obs, dt_day):
        kla = np.zeros(5)
        for loop, k, sp in zip(self.loops, AEROBIC, self.sp):
            kla[k] = loop.update(sp, obs[f"R{k + 1}.SO"], dt_day)
        flows = dict(BASE_FLOWS, Qa=BASE_FLOWS["Qa"] * self.qa_factor)
        return Actuators(kla=kla, **flows)

    def step(self, obs, t_min, dt_day):
        return self._apply(obs, dt_day)

    def setpoints(self):
        return {f"R{k + 1}.DO_sp": float(s) for k, s in zip(AEROBIC, self.sp)}


class AIMPCController(PIDController):
    info = CONTROLLERS["ai_mpc"]
    DECISION_MIN = 15
    CANDIDATES = np.round(np.arange(0.5, 3.01, 0.25), 2)      # DO setpoints, mg/L
    QA_FACTORS = np.array([0.6, 1.0, 1.4])                      # internal recycle x 55338 m3/d

    def __init__(self, surrogate, snh_target: float = 2.0, max_move: float = 0.75):
        self.surrogate = surrogate
        self.snh_target, self.max_move = snh_target, max_move
        super().__init__(do_sp=2.0)

    def reset(self):
        super().reset()
        self._next_decision = 0.0
        self.last_prediction: dict | None = None

    def _decide(self, obs, t_min):
        cur, qa_now = float(self.sp[0]), self.qa_factor
        sps = self.CANDIDATES[np.abs(self.CANDIDATES - cur) <= self.max_move + 1e-9]
        sp_grid, qa_grid = (g.ravel() for g in np.meshgrid(sps, self.QA_FACTORS))
        pred = self.surrogate.predict(obs, t_min, cur, qa_now, sp_grid, qa_grid)
        # Economic objective per hour: aeration + pumping energy (kWh) plus the nitrogen leaving the
        # aerobic zone priced with BSM1 EQI weights (30 per kg NH4-N, 10 per kg NO3-N; 1 EQI unit
        # valued as 1 kWh), and a steep penalty once R5 ammonia would exceed its target.
        qe_k = obs["INF.Q"] / 24.0 / 1000.0                      # 1000 m3/h
        pump_kw = 0.004 * 55338.0 * qa_grid / 24.0
        cost = (pred["kw"] + pump_kw
                + qe_k * (30.0 * pred["snh"] + 10.0 * pred["sno"])
                + qe_k * 300.0 * np.maximum(pred["snh"] - self.snh_target, 0.0)
                + 3.0 * np.abs(sp_grid - cur) + 3.0 * np.abs(qa_grid - qa_now))
        i = int(np.argmin(cost))
        self.sp[:] = sp_grid[i]
        self.qa_factor = float(qa_grid[i])
        self.last_prediction = {k: float(v[i]) for k, v in pred.items()}

    def step(self, obs, t_min, dt_day):
        if t_min >= self._next_decision:
            self._decide(obs, t_min)
            self._next_decision = t_min + self.DECISION_MIN
        return self._apply(obs, dt_day)


def make_controller(controller_id: str) -> Controller:
    if controller_id == "manual":
        return ManualController()
    if controller_id == "pid":
        return PIDController()
    if controller_id == "ai_mpc":
        from .surrogate import load_or_train
        return AIMPCController(load_or_train())
    raise KeyError(controller_id)
