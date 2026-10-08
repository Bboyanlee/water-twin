"""BSM1 plant: 2 anoxic + 3 aerobic CSTRs in series and a 10-layer Takács secondary settler.

Layout and parameters follow the IWA/COST Benchmark Simulation Model No.1.
Time unit: day. Concentrations: g/m3 (= mg/L). Flows: m3/d.

State vector (145):
    [0:65]    5 reactors x 13 ASM1 components
    [65:75]   settler TSS per layer, index 0 = top layer, 9 = bottom
    [75:145]  settler solubles, 10 layers x 7 (SI, SS, SO, SNO, SNH, SND, SALK)
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .asm1 import ASM1Params, IDX, N_COMP, PART_IDX, SOL_IDX, reaction_rates, tss

N_REACT = 5
N_LAYER = 10
N_SOL = len(SOL_IDX)
I_REACT = slice(0, N_REACT * N_COMP)
I_TSS = slice(65, 75)
I_SOL = slice(75, 145)
N_STATE = 145

# BSM1 constant influent (dry weather average)
BSM1_INFLUENT = np.array([30.0, 69.5, 51.2, 202.32, 28.17, 0.0, 0.0, 0.0, 0.0, 31.56, 6.95, 10.59, 7.0])
BSM1_QIN = 18446.0


@dataclass
class PlantConfig:
    volumes: tuple = (1000.0, 1000.0, 1333.0, 1333.0, 1333.0)
    so_sat: float = 8.0
    settler_area: float = 1500.0
    settler_height: float = 4.0
    feed_layer: int = 5            # 0-based from top (6th layer from top, BSM1 feed point)
    # Takács double-exponential settling model
    v0_max: float = 250.0
    v0: float = 474.0
    r_h: float = 0.000576
    r_p: float = 0.00286
    f_ns: float = 0.00228
    X_t: float = 3000.0
    asm: ASM1Params = field(default_factory=ASM1Params)

    @property
    def layer_h(self) -> float:
        return self.settler_height / N_LAYER


@dataclass
class Actuators:
    kla: np.ndarray            # (5,) 1/d
    Qa: float = 55338.0        # internal recycle
    Qr: float = 18446.0        # return activated sludge
    Qw: float = 385.0          # waste sludge


class BSM1Plant:
    def __init__(self, cfg: PlantConfig | None = None):
        self.cfg = cfg or PlantConfig()
        self.V = np.array(self.cfg.volumes)

    # ---------- settler helpers ----------
    def _vs(self, X: np.ndarray, X_min: float) -> np.ndarray:
        c = self.cfg
        Xs = np.maximum(X - X_min, 0.0)
        v = c.v0 * (np.exp(-c.r_h * Xs) - np.exp(-c.r_p * Xs))
        return np.clip(v, 0.0, c.v0_max)

    def settler_outputs(self, y: np.ndarray, Qf: float, Qu: float):
        """Effluent and underflow composition (13 components each) from the settler state."""
        C5 = y[I_REACT].reshape(N_REACT, N_COMP)[4]
        X = y[I_TSS]
        S = y[I_SOL].reshape(N_LAYER, N_SOL)
        tss_f = max(float(tss(C5)), 1e-6)
        frac = C5[PART_IDX] / tss_f
        eff = np.zeros(N_COMP)
        und = np.zeros(N_COMP)
        eff[SOL_IDX] = S[0]
        und[SOL_IDX] = S[-1]
        eff[PART_IDX] = frac * X[0]
        und[PART_IDX] = frac * X[-1]
        return eff, und

    # ---------- dynamics ----------
    def derivatives(self, y: np.ndarray, Qin: float, Cin: np.ndarray, act: Actuators) -> np.ndarray:
        c = self.cfg
        dy = np.zeros_like(y)
        C = y[I_REACT].reshape(N_REACT, N_COMP)
        Qu = act.Qr + act.Qw
        Q1 = Qin + act.Qa + act.Qr
        Qf = Q1 - act.Qa
        Qe = Qf - Qu

        _, und = self.settler_outputs(y, Qf, Qu)

        # reactors
        Cin1 = (Qin * Cin + act.Qa * C[4] + act.Qr * und) / Q1
        Cprev = np.vstack([Cin1, C[:-1]])
        dC = (Q1 / self.V)[:, None] * (Cprev - C) + reaction_rates(C, c.asm)
        so = IDX["SO"]
        dC[:, so] += act.kla * (c.so_sat - C[:, so])
        dy[I_REACT] = dC.ravel()

        # settler, particulates (Takács)
        X = np.maximum(y[I_TSS], 0.0)
        Xf = float(tss(C[4]))
        A, h, fl = c.settler_area, c.layer_h, c.feed_layer
        v_up, v_dn = Qe / A, Qu / A
        vs = self._vs(X, c.f_ns * Xf)
        flux = vs * X
        # gravity flux from layer j to j+1 (j = 0..8)
        Js = np.minimum(flux[:-1], flux[1:])
        for j in range(fl):  # clarification zone (above feed layer)
            Js[j] = min(flux[j], flux[j + 1]) if X[j + 1] > c.X_t else flux[j]
        dX = np.zeros(N_LAYER)
        dX[0] = (v_up * (X[1] - X[0]) - Js[0]) / h
        for j in range(1, fl):
            dX[j] = (v_up * (X[j + 1] - X[j]) + Js[j - 1] - Js[j]) / h
        dX[fl] = (Qf * Xf / A + Js[fl - 1] - (v_up + v_dn) * X[fl] - Js[fl]) / h
        for j in range(fl + 1, N_LAYER - 1):
            dX[j] = (v_dn * (X[j - 1] - X[j]) + Js[j - 1] - Js[j]) / h
        dX[-1] = (v_dn * (X[-2] - X[-1]) + Js[-1]) / h
        dy[I_TSS] = dX

        # settler, solubles (no reaction, advective transport only)
        S = y[I_SOL].reshape(N_LAYER, N_SOL)
        Sf = C[4][SOL_IDX]
        dS = np.zeros_like(S)
        dS[:fl] = v_up * (S[1:fl + 1] - S[:fl]) / h
        dS[fl] = (Qf * Sf / A - (v_up + v_dn) * S[fl]) / h
        dS[fl + 1:] = v_dn * (S[fl:-1] - S[fl + 1:]) / h
        dy[I_SOL] = dS.ravel()
        return dy

    def step_rk4(self, y: np.ndarray, dt: float, Qin: float, Cin: np.ndarray, act: Actuators) -> np.ndarray:
        f = self.derivatives
        k1 = f(y, Qin, Cin, act)
        k2 = f(y + 0.5 * dt * k1, Qin, Cin, act)
        k3 = f(y + 0.5 * dt * k2, Qin, Cin, act)
        k4 = f(y + dt * k3, Qin, Cin, act)
        return np.maximum(y + dt / 6.0 * (k1 + 2 * k2 + 2 * k3 + k4), 0.0)

    # ---------- initial state ----------
    def initial_guess(self) -> np.ndarray:
        y = np.zeros(N_STATE)
        C0 = np.array([30, 2.8, 1149, 82, 2552, 148, 449, 0.5, 5.4, 1.2, 1.0, 5.3, 4.9], dtype=float)
        y[I_REACT] = np.tile(C0, N_REACT)
        y[I_TSS] = np.array([12, 18, 30, 70, 360, 360, 360, 360, 360, 6400], dtype=float)
        y[I_SOL] = np.tile(C0[SOL_IDX], N_LAYER)
        return y

    def steady_state(self, kla=(0, 0, 240, 240, 84), days: float = 150.0) -> np.ndarray:
        """Steady state under constant BSM1 influent and fixed aeration (stiff solver)."""
        from scipy.integrate import solve_ivp

        act = Actuators(kla=np.array(kla, dtype=float))
        sol = solve_ivp(lambda t, y: self.derivatives(np.maximum(y, 0), BSM1_QIN, BSM1_INFLUENT, act),
                        (0.0, days), self.initial_guess(), method="LSODA", rtol=1e-6, atol=1e-6)
        if not sol.success:
            raise RuntimeError(f"steady state failed: {sol.message}")
        return np.maximum(sol.y[:, -1], 0.0)

    # ---------- derived outputs ----------
    def outputs(self, y: np.ndarray, Qin: float, Cin: np.ndarray, act: Actuators) -> dict:
        c = self.cfg
        p = c.asm
        C = y[I_REACT].reshape(N_REACT, N_COMP)
        Qu = act.Qr + act.Qw
        Q1 = Qin + act.Qa + act.Qr
        Qf = Q1 - act.Qa
        Qe = Qf - Qu
        eff, _ = self.settler_outputs(y, Qf, Qu)
        X = y[I_TSS]

        def quality(v):
            cod = v[0] + v[1] + v[2] + v[3] + v[4] + v[5] + v[6]
            bod5 = 0.25 * (v[1] + v[3] + (1 - p.fP) * (v[4] + v[5]))
            tkn = v[9] + v[10] + v[11] + p.iXB * (v[4] + v[5]) + p.iXP * (v[6] + v[2])
            return cod, bod5, tkn, tkn + v[8], float(tss(v))

        e_cod, e_bod, e_tkn, e_tn, e_tss = quality(eff)
        i_cod, _, _, _, i_tss = quality(Cin)

        out = {}
        for k in range(N_REACT):
            n = f"R{k + 1}"
            out[f"{n}.SO"] = C[k, 7]
            out[f"{n}.SNO"] = C[k, 8]
            out[f"{n}.SNH"] = C[k, 9]
            out[f"{n}.SS"] = C[k, 1]
            out[f"{n}.TSS"] = float(tss(C[k]))
            out[f"{n}.KLa"] = float(act.kla[k])
        for j in range(N_LAYER):
            out[f"CL.TSS_{j + 1}"] = X[j]
        out["CL.blanket_m"] = self.blanket_height(X)
        out.update({
            "INF.Q": Qin, "INF.COD": i_cod, "INF.SNH": Cin[9], "INF.TSS": i_tss,
            "EFF.Q": Qe, "EFF.COD": e_cod, "EFF.BOD5": e_bod, "EFF.SNH": eff[9],
            "EFF.SNO": eff[8], "EFF.TN": e_tn, "EFF.TSS": e_tss, "EFF.TKN": e_tkn,
            "FLOW.Qmain": Q1, "FLOW.Qa": act.Qa, "FLOW.Qr": act.Qr, "FLOW.Qw": act.Qw,
            "ENERGY.aeration_kW": self.aeration_kw(act.kla),
            "ENERGY.pumping_kW": (0.004 * act.Qa + 0.008 * act.Qr + 0.05 * act.Qw) / 24.0,
        })
        return {k: float(v) for k, v in out.items()}

    def actuator_outputs(self, act: Actuators) -> dict:
        """Output fields that depend only on the actuator values."""
        out = {f"R{k + 1}.KLa": float(act.kla[k]) for k in range(N_REACT)}
        out.update({
            "FLOW.Qa": act.Qa, "FLOW.Qr": act.Qr, "FLOW.Qw": act.Qw,
            "ENERGY.aeration_kW": self.aeration_kw(act.kla),
            "ENERGY.pumping_kW": (0.004 * act.Qa + 0.008 * act.Qr + 0.05 * act.Qw) / 24.0,
        })
        return out

    def aeration_kw(self, kla: np.ndarray) -> float:
        """BSM1 aeration energy, AE = SOsat/(1.8*1000) * sum(V*KLa) [kWh/d], returned in kW."""
        return float(self.cfg.so_sat / 1800.0 * np.sum(self.V * kla) / 24.0)

    def blanket_height(self, X: np.ndarray) -> float:
        """Sludge blanket height above the settler floor (m): where layer TSS crosses X_t."""
        h = self.cfg.layer_h
        thr = self.cfg.X_t
        # walk upward from the bottom layer
        for j in range(N_LAYER - 1, 0, -1):
            if X[j] >= thr and X[j - 1] < thr:
                frac = (X[j] - thr) / max(X[j] - X[j - 1], 1e-9)
                return float((N_LAYER - 1 - j) * h + h * (0.5 + min(frac, 1.0)))
            if X[j] < thr:
                return float((N_LAYER - 1 - j) * h + h * 0.5 * min(X[j] / thr, 1.0))
        return float(self.cfg.settler_height)
