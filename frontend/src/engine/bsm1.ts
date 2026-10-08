// BSM1 汙水廠模擬器的瀏覽器版（逐行對應 backend/app/sim/asm1.py 與 bsm1.py）。
// 時間單位：天；濃度 g/m³ (= mg/L)；流量 m³/d。
// scale：依業主平均流量等比例縮放 BSM1 廠（槽體積、二沉池面積、迴流量皆 × scale），
// 水力停留時間與汙泥齡不變，因此濃度動態與原 BSM1 相同。

export const N_COMP = 13; // SI SS XI XS XBH XBA XP SO SNO SNH SND XND SALK
export const N_REACT = 5;
export const N_LAYER = 10;
const SOL_IDX = [0, 1, 7, 8, 9, 10, 12];
const PART_IDX = [2, 3, 4, 5, 6, 11];
const N_SOL = SOL_IDX.length;
export const N_STATE = 145;
const I_TSS = 65;
const I_SOL = 75;

export const BSM1_INFLUENT = [30.0, 69.5, 51.2, 202.32, 28.17, 0.0, 0.0, 0.0, 0.0, 31.56, 6.95, 10.59, 7.0];
export const BSM1_QIN = 18446.0;
export const BASE_FLOWS = { Qa: 55338.0, Qr: 18446.0, Qw: 385.0 };

const P = { YA: 0.24, YH: 0.67, fP: 0.08, iXB: 0.08, iXP: 0.06, muH: 4.0, KS: 10.0, KOH: 0.2, KNO: 0.5, bH: 0.3,
  etag: 0.8, etah: 0.8, kh: 3.0, KX: 0.1, muA: 0.5, KNH: 1.0, bA: 0.05, KOA: 0.4, ka: 0.05 };

export interface Actuators { kla: number[]; Qa: number; Qr: number; Qw: number }

const tssOf = (c: ArrayLike<number>, o = 0) => 0.75 * (c[o + 2] + c[o + 3] + c[o + 4] + c[o + 5] + c[o + 6]);

/** ASM1 反應速率，寫入 out[o..o+13) */
function rates(c: Float64Array, o: number, out: Float64Array) {
  const m = (i: number) => Math.max(c[o + i], 0);
  const SS = m(1), XS = m(3), XBH = m(4), XBA = m(5), SO = m(7), SNO = m(8), SNH = m(9), SND = m(10), XND = m(11);
  const oh = SO / (P.KOH + SO), ih = P.KOH / (P.KOH + SO), no = SNO / (P.KNO + SNO), ms = SS / (P.KS + SS);
  const r1 = P.muH * ms * oh * XBH;
  const r2 = P.muH * ms * ih * no * P.etag * XBH;
  const r3 = P.muA * SNH / (P.KNH + SNH) * SO / (P.KOA + SO) * XBA;
  const r4 = P.bH * XBH;
  const r5 = P.bA * XBA;
  const r6 = P.ka * SND * XBH;
  const ratio = XBH > 1e-9 ? XS / XBH : 0;
  const r7 = P.kh * ratio / (P.KX + ratio) * (oh + P.etah * ih * no) * XBH;
  const r8 = XS > 1e-9 ? r7 * XND / XS : 0;
  out[o] = 0;
  out[o + 1] = -(r1 + r2) / P.YH + r7;
  out[o + 2] = 0;
  out[o + 3] = (1 - P.fP) * (r4 + r5) - r7;
  out[o + 4] = r1 + r2 - r4;
  out[o + 5] = r3 - r5;
  out[o + 6] = P.fP * (r4 + r5);
  out[o + 7] = -(1 - P.YH) / P.YH * r1 - (4.57 - P.YA) / P.YA * r3;
  out[o + 8] = -(1 - P.YH) / (2.86 * P.YH) * r2 + r3 / P.YA;
  out[o + 9] = -P.iXB * (r1 + r2) - (P.iXB + 1 / P.YA) * r3 + r6;
  out[o + 10] = -r6 + r8;
  out[o + 11] = (P.iXB - P.fP * P.iXP) * (r4 + r5) - r8;
  out[o + 12] = -P.iXB / 14 * r1 + ((1 - P.YH) / (14 * 2.86 * P.YH) - P.iXB / 14) * r2
    - (P.iXB / 14 + 1 / (7 * P.YA)) * r3 + r6 / 14;
}

export class Plant {
  readonly V: number[];
  readonly area: number;
  readonly height = 4.0;
  readonly feed = 5;
  readonly soSat = 8.0;
  // Takács
  private v0max = 250; private v0 = 474; private rh = 0.000576; private rp = 0.00286; private fns = 0.00228; private Xt = 3000;
  private k = [new Float64Array(N_STATE), new Float64Array(N_STATE), new Float64Array(N_STATE), new Float64Array(N_STATE)];
  private tmp = new Float64Array(N_STATE);
  private r = new Float64Array(N_REACT * N_COMP);
  private und = new Float64Array(N_COMP);
  private eff = new Float64Array(N_COMP);
  private cin1 = new Float64Array(N_COMP);

  constructor(readonly scale = 1) {
    this.V = [1000, 1000, 1333, 1333, 1333].map((v) => v * scale);
    this.area = 1500 * scale;
  }

  private settlerOut(y: Float64Array, eff: Float64Array, und: Float64Array) {
    const tssf = Math.max(tssOf(y, 4 * N_COMP), 1e-6);
    for (let s = 0; s < N_SOL; s++) {
      eff[SOL_IDX[s]] = y[I_SOL + s];
      und[SOL_IDX[s]] = y[I_SOL + (N_LAYER - 1) * N_SOL + s];
    }
    for (const i of PART_IDX) {
      const frac = y[4 * N_COMP + i] / tssf;
      eff[i] = frac * y[I_TSS];
      und[i] = frac * y[I_TSS + N_LAYER - 1];
    }
  }

  derivatives(y: Float64Array, Qin: number, Cin: ArrayLike<number>, a: Actuators, dy: Float64Array) {
    const Qu = a.Qr + a.Qw, Q1 = Qin + a.Qa + a.Qr, Qf = Q1 - a.Qa, Qe = Qf - Qu;
    this.settlerOut(y, this.eff, this.und);
    const und = this.und, cin1 = this.cin1;
    for (let i = 0; i < N_COMP; i++) cin1[i] = (Qin * Cin[i] + a.Qa * y[4 * N_COMP + i] + a.Qr * und[i]) / Q1;
    for (let k = 0; k < N_REACT; k++) rates(y, k * N_COMP, this.r);
    for (let k = 0; k < N_REACT; k++) {
      const d = Q1 / this.V[k];
      for (let i = 0; i < N_COMP; i++) {
        const prev = k === 0 ? cin1[i] : y[(k - 1) * N_COMP + i];
        dy[k * N_COMP + i] = d * (prev - y[k * N_COMP + i]) + this.r[k * N_COMP + i];
      }
      dy[k * N_COMP + 7] += a.kla[k] * (this.soSat - y[k * N_COMP + 7]);
    }
    // settler particulates
    const h = this.height / N_LAYER, A = this.area, fl = this.feed;
    const X = new Array<number>(N_LAYER);
    for (let j = 0; j < N_LAYER; j++) X[j] = Math.max(y[I_TSS + j], 0);
    const Xf = tssOf(y, 4 * N_COMP);
    const vup = Qe / A, vdn = Qu / A, Xmin = this.fns * Xf;
    const flux = X.map((x) => {
      const xs = Math.max(x - Xmin, 0);
      const v = Math.min(Math.max(this.v0 * (Math.exp(-this.rh * xs) - Math.exp(-this.rp * xs)), 0), this.v0max);
      return v * x;
    });
    const Js = new Array<number>(N_LAYER - 1);
    for (let j = 0; j < N_LAYER - 1; j++) Js[j] = Math.min(flux[j], flux[j + 1]);
    for (let j = 0; j < fl; j++) Js[j] = X[j + 1] > this.Xt ? Math.min(flux[j], flux[j + 1]) : flux[j];
    dy[I_TSS] = (vup * (X[1] - X[0]) - Js[0]) / h;
    for (let j = 1; j < fl; j++) dy[I_TSS + j] = (vup * (X[j + 1] - X[j]) + Js[j - 1] - Js[j]) / h;
    dy[I_TSS + fl] = (Qf * Xf / A + Js[fl - 1] - (vup + vdn) * X[fl] - Js[fl]) / h;
    for (let j = fl + 1; j < N_LAYER - 1; j++) dy[I_TSS + j] = (vdn * (X[j - 1] - X[j]) + Js[j - 1] - Js[j]) / h;
    dy[I_TSS + N_LAYER - 1] = (vdn * (X[N_LAYER - 2] - X[N_LAYER - 1]) + Js[N_LAYER - 2]) / h;
    // settler solubles
    for (let s = 0; s < N_SOL; s++) {
      const S = (j: number) => y[I_SOL + j * N_SOL + s];
      const Sf = y[4 * N_COMP + SOL_IDX[s]];
      for (let j = 0; j < fl; j++) dy[I_SOL + j * N_SOL + s] = vup * (S(j + 1) - S(j)) / h;
      dy[I_SOL + fl * N_SOL + s] = (Qf * Sf / A - (vup + vdn) * S(fl)) / h;
      for (let j = fl + 1; j < N_LAYER; j++) dy[I_SOL + j * N_SOL + s] = vdn * (S(j - 1) - S(j)) / h;
    }
  }

  stepRK4(y: Float64Array, dt: number, Qin: number, Cin: ArrayLike<number>, a: Actuators): Float64Array {
    const [k1, k2, k3, k4] = this.k, t = this.tmp;
    this.derivatives(y, Qin, Cin, a, k1);
    for (let i = 0; i < N_STATE; i++) t[i] = y[i] + 0.5 * dt * k1[i];
    this.derivatives(t, Qin, Cin, a, k2);
    for (let i = 0; i < N_STATE; i++) t[i] = y[i] + 0.5 * dt * k2[i];
    this.derivatives(t, Qin, Cin, a, k3);
    for (let i = 0; i < N_STATE; i++) t[i] = y[i] + dt * k3[i];
    this.derivatives(t, Qin, Cin, a, k4);
    const out = new Float64Array(N_STATE);
    for (let i = 0; i < N_STATE; i++) out[i] = Math.max(y[i] + dt / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]), 0);
    return out;
  }

  aerationKw(kla: number[]) {
    let s = 0;
    for (let k = 0; k < N_REACT; k++) s += this.V[k] * kla[k];
    return this.soSat / 1800 * s / 24;
  }

  blanket(X: number[]): number {
    const h = this.height / N_LAYER, thr = this.Xt;
    for (let j = N_LAYER - 1; j > 0; j--) {
      if (X[j] >= thr && X[j - 1] < thr) {
        const frac = (X[j] - thr) / Math.max(X[j] - X[j - 1], 1e-9);
        return (N_LAYER - 1 - j) * h + h * (0.5 + Math.min(frac, 1));
      }
      if (X[j] < thr) return (N_LAYER - 1 - j) * h + h * 0.5 * Math.min(X[j] / thr, 1);
    }
    return this.height;
  }

  outputs(y: Float64Array, Qin: number, Cin: ArrayLike<number>, a: Actuators): Record<string, number> {
    const Qu = a.Qr + a.Qw, Q1 = Qin + a.Qa + a.Qr, Qf = Q1 - a.Qa, Qe = Qf - Qu;
    const eff = new Float64Array(N_COMP), und = new Float64Array(N_COMP);
    this.settlerOut(y, eff, und);
    const quality = (v: ArrayLike<number>) => {
      const cod = v[0] + v[1] + v[2] + v[3] + v[4] + v[5] + v[6];
      const bod5 = 0.25 * (v[1] + v[3] + (1 - P.fP) * (v[4] + v[5]));
      const tkn = v[9] + v[10] + v[11] + P.iXB * (v[4] + v[5]) + P.iXP * (v[6] + v[2]);
      return { cod, bod5, tkn, tn: tkn + v[8], tss: tssOf(v) };
    };
    const e = quality(eff), i = quality(Cin);
    const out: Record<string, number> = {};
    for (let k = 0; k < N_REACT; k++) {
      const o = k * N_COMP, n = `R${k + 1}`;
      out[`${n}.SO`] = y[o + 7]; out[`${n}.SNO`] = y[o + 8]; out[`${n}.SNH`] = y[o + 9];
      out[`${n}.SS`] = y[o + 1]; out[`${n}.TSS`] = tssOf(y, o); out[`${n}.KLa`] = a.kla[k];
    }
    const X: number[] = [];
    for (let j = 0; j < N_LAYER; j++) { X.push(y[I_TSS + j]); out[`CL.TSS_${j + 1}`] = y[I_TSS + j]; }
    out['CL.blanket_m'] = this.blanket(X);
    Object.assign(out, {
      'INF.Q': Qin, 'INF.COD': i.cod, 'INF.SNH': Cin[9], 'INF.TSS': i.tss,
      'EFF.Q': Qe, 'EFF.COD': e.cod, 'EFF.BOD5': e.bod5, 'EFF.SNH': eff[9], 'EFF.SNO': eff[8],
      'EFF.TN': e.tn, 'EFF.TSS': e.tss, 'EFF.TKN': e.tkn, 'FLOW.Qmain': Q1,
    });
    Object.assign(out, this.actuatorOutputs(a));
    return out;
  }

  actuatorOutputs(a: Actuators): Record<string, number> {
    const out: Record<string, number> = {};
    for (let k = 0; k < N_REACT; k++) out[`R${k + 1}.KLa`] = a.kla[k];
    out['FLOW.Qa'] = a.Qa; out['FLOW.Qr'] = a.Qr; out['FLOW.Qw'] = a.Qw;
    out['ENERGY.aeration_kW'] = this.aerationKw(a.kla);
    out['ENERGY.pumping_kW'] = (0.004 * a.Qa + 0.008 * a.Qr + 0.05 * a.Qw) / 24;
    return out;
  }
}
