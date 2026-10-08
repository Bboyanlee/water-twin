// 驗證瀏覽器模擬引擎與 Python 結果一致：
//   npx esbuild scripts/verify-engine.ts --bundle --platform=node --outfile=<tmp>/verify.cjs && node <tmp>/verify.cjs
import { readFileSync } from 'node:fs';
import { Plant } from '../src/engine/bsm1';
import { makeController, predictTree, type ControllerId, type SurrogateJson } from '../src/engine/controllers';
import { simulate } from '../src/engine/runner';

const dir = new URL('../public/data/engine/', import.meta.url);
const load = (f: string) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const model: SurrogateJson = load('surrogate.json');
const y0: number[] = load('steady_state.json');
const ref = load('reference.json');

let ok = true;
const x = ref.surrogate_check.x as number[];
for (const k of ['snh', 'sno', 'kw'] as const) {
  const js = predictTree(model.targets[k], x), py = ref.surrogate_check.y[k];
  const pass = Math.abs(js - py) < 1e-6;
  ok &&= pass;
  console.log(`surrogate ${k}: js=${js.toFixed(6)} py=${py.toFixed(6)} ${pass ? 'OK' : 'MISMATCH'}`);
}

for (const scale of [1, 0.1]) {
  const sc = (inf: { Q: number[]; C: number[][] }) => ({ Q: inf.Q.map((q) => q * scale), C: inf.C });
  for (const id of ['manual', 'pid', 'ai_mpc'] as ControllerId[]) {
    const t = Date.now();
    const r = simulate(new Plant(scale), makeController(id, scale, model), y0, sc(ref.warmup), sc(ref.main));
    const py = ref.kpis[id];
    const rel = (k: string, s = 1) => Math.abs(r.kpis[k] - py[k] * s) / Math.max(Math.abs(py[k] * s), 1e-9);
    const tol = id === 'ai_mpc' ? 0.02 : 0.002;   // AI 為離散決策，容許些微浮點差異
    const keys: [string, number][] = [['EQI', scale], ['AE_kWh_d', scale], ['eff_SNH_avg', 1], ['eff_TN_avg', 1]];
    const pass = keys.every(([k, s]) => rel(k, s) < tol);
    ok &&= pass;
    console.log(`scale=${scale} ${id.padEnd(7)} ${Date.now() - t}ms`,
      keys.map(([k, s]) => `${k} js=${r.kpis[k].toFixed(2)} py=${(py[k] * s).toFixed(2)}`).join(' | '), pass ? 'OK' : 'MISMATCH');
  }
}
console.log(ok ? 'ALL OK' : 'FAILED');
process.exit(ok ? 0 : 1);
