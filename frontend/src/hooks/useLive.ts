import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, backendStatus, subscribeLive } from '../api/client';
import type { Tag, VarDict } from '../api/types';
import { buildVarDict } from '../lib/vars';

export function useBackendStatus() {
  return useSyncExternalStore(backendStatus.subscribe, backendStatus.get);
}

export interface LiveState {
  ts: number | null;
  values: Record<string, number | null>;
  connected: boolean;
  /** 給 3D useFrame 讀取用（不觸發 React render） */
  varsRef: React.MutableRefObject<VarDict>;
  vars: VarDict;
  /** 最近 N 筆（每秒一筆）的 tag 值，供即時曲線 */
  history: React.MutableRefObject<{ t: number[]; v: Record<string, (number | null)[]> }>;
  tick: number;
}

const MAX_HIST = 240;

export function useLive(plantId: string | undefined, tags: Tag[] | undefined): LiveState {
  const [ts, setTs] = useState<number | null>(null);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [connected, setConnected] = useState(false);
  const [tick, setTick] = useState(0);
  const varsRef = useRef<VarDict>({});
  const [vars, setVars] = useState<VarDict>({});
  const history = useRef<{ t: number[]; v: Record<string, (number | null)[]> }>({ t: [], v: {} });
  const resets = useRef(0);
  const tagsRef = useRef<Tag[]>(tags ?? []);
  tagsRef.current = tags ?? [];

  useEffect(() => {
    if (!plantId || !tags) return;
    let alive = true;
    history.current = { t: [], v: {} };
    varsRef.current = {};
    setValues({});
    setVars({});
    setTs(null);
    const push = (msgTs: number, vals: Record<string, number | null>) => {
      let h = history.current;
      if (h.t.length && msgTs === h.t[h.t.length - 1]) return;
      // 時間倒退（重播循環、或 latest 與 WS 重播起點不同）→ 重設歷史
      if (h.t.length && msgTs < h.t[h.t.length - 1]) {
        h = history.current = { t: [], v: {} };
        resets.current += 1;
      }
      h.t.push(msgTs);
      const n = h.t.length;
      for (const k of Object.keys(vals)) {
        const arr = (h.v[k] ??= new Array(n - 1).fill(null));
        while (arr.length < n - 1) arr.push(null);
        arr.push(vals[k]);
      }
      if (h.t.length > MAX_HIST) {
        h.t.shift();
        for (const k in h.v) h.v[k].shift();
      }
    };
    const apply = (msgTs: number, vals: Record<string, number | null>) => {
      if (!alive) return;
      const merged = { ...vals };
      const d = buildVarDict(merged, tagsRef.current);
      varsRef.current = d;
      setVars(d);
      setValues(merged);
      setTs(msgTs);
      push(msgTs, merged);
      setTick((x) => x + 1);
    };
    // 先抓最新值當初始值，再接 WS
    api.latest(plantId).then((l) => apply(l.ts, l.values)).catch(() => undefined);
    const stop = subscribeLive(plantId, (m) => apply(m.ts, m.values), (c) => alive && setConnected(c));
    return () => {
      alive = false;
      stop();
    };
  }, [plantId, tags]);

  return { ts, values, connected, varsRef, vars, history, tick };
}
