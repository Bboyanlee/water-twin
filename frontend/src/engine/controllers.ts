// 控制器（對應 backend/app/control/controllers.py 與 surrogate.py）：manual / pid / ai_mpc
import { BASE_FLOWS, type Actuators } from './bsm1';

const AEROBIC = [2, 3, 4];
const KLA_MAX = 360;
export type ControllerId = 'manual' | 'pid' | 'ai_mpc';

class PI {
  integral: number;
  constructor(private K: number, private Ti: number, private Tt: number, u0: number, private lo = 0, private hi = KLA_MAX) {
    this.integral = u0;
  }
  update(sp: number, pv: number, dt: number) {
    const e = sp - pv;
    const v = this.K * e + this.integral;
    const u = Math.min(Math.max(v, this.lo), this.hi);
    this.integral += (this.K / this.Ti * e + (u - v) / this.Tt) * dt;
    return u;
  }
}

export interface Controller {
  reset(): void;
  step(obs: Record<string, number>, tMin: number, dtDay: number): Actuators;
  setpoints(): Record<string, number | null>;
}

const flows = (scale: number, qaFactor = 1) => ({ Qa: BASE_FLOWS.Qa * qaFactor * scale, Qr: BASE_FLOWS.Qr * scale, Qw: BASE_FLOWS.Qw * scale });

export class ManualController implements Controller {
  constructor(private scale: number, private kla = [0, 0, 240, 240, 84]) {}
  reset() {}
  step(): Actuators { return { kla: [...this.kla], ...flows(this.scale) }; }
  setpoints() { return { 'R3.DO_sp': null, 'R4.DO_sp': null, 'R5.DO_sp': null }; }
}

export class PIDController implements Controller {
  sp = [2, 2, 2];
  qaFactor = 1;
  private loops: PI[] = [];
  constructor(protected scale: number, private baseSp = 2.0) { this.reset(); }
  reset() {
    this.sp = [this.baseSp, this.baseSp, this.baseSp];
    this.qaFactor = 1;
    this.loops = AEROBIC.map(() => new PI(60, 0.01, 0.005, 150));
  }
  protected apply(obs: Record<string, number>, dt: number): Actuators {
    const kla = [0, 0, 0, 0, 0];
    AEROBIC.forEach((k, i) => { kla[k] = this.loops[i].update(this.sp[i], obs[`R${k + 1}.SO`], dt); });
    return { kla, ...flows(this.scale, this.qaFactor) };
  }
  step(obs: Record<string, number>, _t: number, dt: number) { return this.apply(obs, dt); }
  setpoints() { return { 'R3.DO_sp': this.sp[0], 'R4.DO_sp': this.sp[1], 'R5.DO_sp': this.sp[2] }; }
}

// ---------- AI 代理模型（梯度提升樹，與 Python 相同的樹） ----------
interface Tree { f: number[]; t: number[]; l: number[]; r: number[]; v: number[]; leaf: number[]; ml: number[] }
interface TreeModel { baseline: number; trees: Tree[] }
export interface SurrogateJson { features: string[]; targets: Record<'snh' | 'sno' | 'kw', TreeModel>; candidates: number[]; qa_factors: number[] }

export function predictTree(m: TreeModel, x: number[]): number {
  let s = m.baseline;
  for (const tr of m.trees) {
    let n = 0;
    while (!tr.leaf[n]) {
      const xv = x[tr.f[n]];
      n = Number.isNaN(xv) ? (tr.ml[n] ? tr.l[n] : tr.r[n]) : xv <= tr.t[n] ? tr.l[n] : tr.r[n];
    }
    s += tr.v[n];
  }
  return s;
}

export class AIMPCController extends PIDController {
  private next = 0;
  /** clockOffsetMin：模擬起點距當地午夜的分鐘數（代理模型使用一天中的時刻作為特徵） */
  constructor(scale: number, private model: SurrogateJson, private clockOffsetMin = 0, private snhTarget = 2.0, private maxMove = 0.75) { super(scale); }
  reset() { super.reset(); this.next = 0; }

  private decide(obs: Record<string, number>, tMin: number) {
    const s = this.scale, cur = this.sp[0], qaNow = this.qaFactor;
    const sps = this.model.candidates.filter((c) => Math.abs(c - cur) <= this.maxMove + 1e-9);
    // 代理模型以 BSM1 原尺寸訓練：流量、負荷先換回原尺寸，能耗再乘回 scale
    const q = obs['INF.Q'] / s;
    const h = 2 * Math.PI * ((tMin + this.clockOffsetMin) % 1440) / 1440;
    const base = [obs['R3.SNH'], obs['R4.SNH'], obs['R5.SNH'], obs['R5.SO'], obs['R2.SNO'], obs['R5.SNO'],
      q, obs['INF.SNH'], q * obs['INF.SNH'] / 1000, Math.sin(h), Math.cos(h), cur, qaNow];
    const qeK = obs['INF.Q'] / 24 / 1000;
    let best = Infinity, bestSp = cur, bestQa = qaNow;
    for (const qa of this.model.qa_factors) {        // 與 numpy meshgrid(sps, qa).ravel() 相同順序
      for (const sp of sps) {
        const x = [...base, sp, qa];
        const snh = predictTree(this.model.targets.snh, x);
        const sno = predictTree(this.model.targets.sno, x);
        const kw = predictTree(this.model.targets.kw, x) * s;
        const pump = 0.004 * BASE_FLOWS.Qa * qa / 24 * s;
        const cost = kw + pump + qeK * (30 * snh + 10 * sno) + qeK * 300 * Math.max(snh - this.snhTarget, 0)
          + s * (3 * Math.abs(sp - cur) + 3 * Math.abs(qa - qaNow));
        if (cost < best) { best = cost; bestSp = sp; bestQa = qa; }
      }
    }
    this.sp = [bestSp, bestSp, bestSp];
    this.qaFactor = bestQa;
  }

  step(obs: Record<string, number>, tMin: number, dt: number) {
    if (tMin >= this.next) {
      this.decide(obs, tMin);
      this.next = tMin + 15;
    }
    return this.apply(obs, dt);
  }
}

export function makeController(id: ControllerId, scale: number, model: SurrogateJson, clockOffsetMin = 0): Controller {
  if (id === 'manual') return new ManualController(scale);
  if (id === 'pid') return new PIDController(scale);
  return new AIMPCController(scale, model, clockOffsetMin);
}
