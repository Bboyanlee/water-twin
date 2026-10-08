"""IWA Activated Sludge Model No.1 (ASM1) kinetics.

Component order (13), same as the BSM1 benchmark:
    SI, SS, XI, XS, XBH, XBA, XP, SO, SNO, SNH, SND, XND, SALK
Default parameters are the BSM1 values at 15 °C (Copp 2002; Alex et al. 2008).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

COMPONENTS = ("SI", "SS", "XI", "XS", "XBH", "XBA", "XP", "SO", "SNO", "SNH", "SND", "XND", "SALK")
IDX = {name: i for i, name in enumerate(COMPONENTS)}
N_COMP = len(COMPONENTS)

SOLUBLES = ("SI", "SS", "SO", "SNO", "SNH", "SND", "SALK")
PARTICULATES = ("XI", "XS", "XBH", "XBA", "XP", "XND")
SOL_IDX = np.array([IDX[c] for c in SOLUBLES])
PART_IDX = np.array([IDX[c] for c in PARTICULATES])


@dataclass(frozen=True)
class ASM1Params:
    # stoichiometry
    YA: float = 0.24
    YH: float = 0.67
    fP: float = 0.08
    iXB: float = 0.08
    iXP: float = 0.06
    # kinetics (1/d, g/m3)
    muH: float = 4.0
    KS: float = 10.0
    KOH: float = 0.2
    KNO: float = 0.5
    bH: float = 0.3
    etag: float = 0.8
    etah: float = 0.8
    kh: float = 3.0
    KX: float = 0.1
    muA: float = 0.5
    KNH: float = 1.0
    bA: float = 0.05
    KOA: float = 0.4
    ka: float = 0.05


def reaction_rates(C: np.ndarray, p: ASM1Params) -> np.ndarray:
    """Conversion rates dC/dt (g/m3/d) for an array of reactors, shape (n, 13)."""
    C = np.maximum(C, 0.0)
    SS, XS, XBH, XBA = C[:, 1], C[:, 3], C[:, 4], C[:, 5]
    SO, SNO, SNH, SND, XND = C[:, 7], C[:, 8], C[:, 9], C[:, 10], C[:, 11]

    o_h = SO / (p.KOH + SO)
    i_h = p.KOH / (p.KOH + SO)
    no = SNO / (p.KNO + SNO)
    monod_s = SS / (p.KS + SS)

    r1 = p.muH * monod_s * o_h * XBH                       # aerobic growth heterotrophs
    r2 = p.muH * monod_s * i_h * no * p.etag * XBH         # anoxic growth heterotrophs
    r3 = p.muA * SNH / (p.KNH + SNH) * SO / (p.KOA + SO) * XBA  # aerobic growth autotrophs
    r4 = p.bH * XBH                                         # decay heterotrophs
    r5 = p.bA * XBA                                         # decay autotrophs
    r6 = p.ka * SND * XBH                                   # ammonification
    ratio = np.divide(XS, XBH, out=np.zeros_like(XS), where=XBH > 1e-9)
    r7 = p.kh * ratio / (p.KX + ratio) * (o_h + p.etah * i_h * no) * XBH  # hydrolysis of organics
    r8 = np.divide(r7 * XND, XS, out=np.zeros_like(XS), where=XS > 1e-9)  # hydrolysis of organic N

    out = np.zeros_like(C)
    out[:, 1] = -(r1 + r2) / p.YH + r7
    out[:, 3] = (1 - p.fP) * (r4 + r5) - r7
    out[:, 4] = r1 + r2 - r4
    out[:, 5] = r3 - r5
    out[:, 6] = p.fP * (r4 + r5)
    out[:, 7] = -(1 - p.YH) / p.YH * r1 - (4.57 - p.YA) / p.YA * r3
    out[:, 8] = -(1 - p.YH) / (2.86 * p.YH) * r2 + r3 / p.YA
    out[:, 9] = -p.iXB * (r1 + r2) - (p.iXB + 1 / p.YA) * r3 + r6
    out[:, 10] = -r6 + r8
    out[:, 11] = (p.iXB - p.fP * p.iXP) * (r4 + r5) - r8
    out[:, 12] = (-p.iXB / 14 * r1
                  + ((1 - p.YH) / (14 * 2.86 * p.YH) - p.iXB / 14) * r2
                  - (p.iXB / 14 + 1 / (7 * p.YA)) * r3
                  + r6 / 14)
    return out


def tss(C: np.ndarray) -> np.ndarray:
    """Total suspended solids (g/m3) from particulate COD, BSM1 convention (0.75 gSS/gCOD)."""
    return 0.75 * (C[..., 2] + C[..., 3] + C[..., 4] + C[..., 5] + C[..., 6])
