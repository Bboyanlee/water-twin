// Web Worker：在瀏覽器背景執行業主上傳資料的模擬，避免畫面卡住。
import { BSM1_QIN, Plant } from './bsm1';
import { makeController, type ControllerId, type SurrogateJson } from './controllers';
import { resampleToMinutes, simulate, type Influent, type InfluentRow, type RunResult } from './runner';

export interface WorkerRequest { rows: InfluentRow[]; controllers: ControllerId[]; engineBase: string; clockOffsetMin: number }
export type WorkerMessage =
  | { type: 'progress'; frac: number; label: string }
  | { type: 'done'; runs: (RunResult & { controller_id: ControllerId })[]; scale: number; meanQ: number; minutes: number }
  | { type: 'error'; message: string };

const MAX_MIN = 7 * 1440;
let cache: Promise<[SurrogateJson, number[]]> | null = null;

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const post = (m: WorkerMessage) => (self as unknown as Worker).postMessage(m);
  try {
    const { rows, controllers, engineBase, clockOffsetMin } = ev.data;
    cache ??= Promise.all([
      fetch(engineBase + 'surrogate.json').then((r) => r.json()),
      fetch(engineBase + 'steady_state.json').then((r) => r.json()),
    ]);
    const [model, y0] = await cache;
    const main0 = resampleToMinutes(rows);
    const main: Influent = { Q: main0.Q.slice(0, MAX_MIN), C: main0.C.slice(0, MAX_MIN) };
    // 暖機：以資料的第一天（不足一天則循環補滿）運轉 1 天，讓汙泥與控制器進入穩定狀態
    const warm: Influent = { Q: [], C: [] };
    for (let i = 0; i < 1440; i++) { warm.Q.push(main.Q[i % main.Q.length]); warm.C.push(main.C[i % main.C.length]); }
    const meanQ = main.Q.reduce((a, b) => a + b, 0) / main.Q.length;
    const scale = meanQ / BSM1_QIN;
    const runs: (RunResult & { controller_id: ControllerId })[] = [];
    controllers.forEach((id, k) => {
      const r = simulate(new Plant(scale), makeController(id, scale, model, clockOffsetMin), y0, warm, main, 2,
        (f) => post({ type: 'progress', frac: (k + f) / controllers.length, label: id }));
      runs.push({ ...r, controller_id: id });
    });
    post({ type: 'done', runs, scale, meanQ, minutes: main.Q.length });
  } catch (e) {
    post({ type: 'error', message: (e as Error).message });
  }
};
