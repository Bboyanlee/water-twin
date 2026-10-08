import { useMemo } from 'react';
import * as THREE from 'three';
import type { Layout, LayoutUnit, Limits, Plant, Tag } from '../api/types';
import type { AsyncState } from '../hooks/useAsync';
import type { LiveState } from '../hooks/useLive';
import { t } from '../i18n';
import { Empty, Loading, Panel } from '../components/Panel';
import { FlowNormalizer, fmtNum, KIND_COLOR, pick, unitDO, unitLabelSpecs, violations } from '../lib/vars';
import { doColor } from '../three/colors';
import { routeLink } from '../three/Pipes';

interface Props {
  plant: Plant;
  layout: AsyncState<Layout>;
  tags: Tag[];
  limits: Limits;
  live: LiveState;
}

const VB_W = 1600;
const VB_H = 760;
const PAD = 70;
const STROKE: Record<string, number> = { water: 7, recycle: 5, sludge: 4.5, air: 3, chemical: 3 };

// 頁面重繪間共用的流量正規化
const normalizer = new FlowNormalizer();

export default function FlowPage({ plant, layout, tags, limits, live }: Props) {
  const geo = useMemo(() => {
    const L = layout.data;
    if (!L) return null;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const u of L.units) {
      minX = Math.min(minX, u.position[0] - u.size[0] / 2); maxX = Math.max(maxX, u.position[0] + u.size[0] / 2);
      minZ = Math.min(minZ, u.position[2] - u.size[2] / 2); maxZ = Math.max(maxZ, u.position[2] + u.size[2] / 2);
    }
    const s = Math.min((VB_W - PAD * 2) / (maxX - minX || 1), (VB_H - PAD * 2 - 40) / (maxZ - minZ || 1));
    const ox = (VB_W - (maxX - minX) * s) / 2 - minX * s;
    const oy = (VB_H - (maxZ - minZ) * s) / 2 - minZ * s;
    const P = (x: number, z: number) => [x * s + ox, z * s + oy] as const;
    const byId = new Map(L.units.map((u) => [u.id, u]));
    const overheadY = Math.max(...L.units.map((u) => u.size[1])) + 1.6;
    const pipes = L.links.map((link) => {
      const a = byId.get(link.from), b = byId.get(link.to);
      if (!a || !b) return null;
      const pts3 = routeLink(link, a, b, overheadY);
      const pts: (readonly [number, number])[] = [];
      for (const p of pts3) {
        const q = P(p.x, p.z);
        const last = pts[pts.length - 1];
        if (!last || Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.5) pts.push(q);
      }
      // 起點/終點裁到單元輪廓外（俯視）
      const clip = (u: LayoutUnit, p: readonly [number, number], toward: readonly [number, number]) => {
        const c = new THREE.Vector2(...P(u.position[0], u.position[2]));
        const d = new THREE.Vector2(toward[0] - p[0], toward[1] - p[1]);
        if (d.length() < 1e-3 || Math.hypot(p[0] - c.x, p[1] - c.y) > 2) return p;
        d.normalize();
        const hw = (u.size[0] * s) / 2, hh = (u.size[2] * s) / 2;
        const tt = u.shape === 'cylinder' ? hw : Math.min(Math.abs(d.x) > 1e-6 ? hw / Math.abs(d.x) : Infinity, Math.abs(d.y) > 1e-6 ? hh / Math.abs(d.y) : Infinity);
        return [p[0] + d.x * tt, p[1] + d.y * tt] as const;
      };
      if (pts.length >= 2) {
        pts[0] = clip(a, pts[0], pts[1]);
        pts[pts.length - 1] = clip(b, pts[pts.length - 1], pts[pts.length - 2]);
      }
      return { link, d: pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ') };
    }).filter(Boolean) as { link: Layout['links'][number]; d: string }[];
    const units = L.units.map((u) => {
      const [cx, cy] = P(u.position[0], u.position[2]);
      return { u, cx, cy, w: u.size[0] * s, h: u.size[2] * s, specs: unitLabelSpecs(u, L, tags) };
    });
    return { pipes, units };
  }, [layout.data, tags]);

  const bad = violations(live.vars, limits);

  if (layout.loading && !layout.data) return <Loading />;
  if (layout.error || !geo) return <Empty error={layout.error} />;

  return (
    <div className="flow-page">
      <Panel title={`${t.flow.title} — ${plant.name}`} bodyClass="nopad" extra={<span>資料時間 {live.ts ? new Date(live.ts).toLocaleTimeString('zh-TW') : '—'}</span>}>
        <svg className="flow-svg" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3.5" result="b" />
              <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <linearGradient id="unitFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0f2a4d" stopOpacity="0.95" />
              <stop offset="1" stopColor="#081a33" stopOpacity="0.95" />
            </linearGradient>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="rgba(0,229,255,0.06)" />
            </pattern>
          </defs>
          <rect width={VB_W} height={VB_H} fill="url(#grid)" />

          {geo.pipes.map(({ link, d }) => {
            const color = KIND_COLOR[link.kind] ?? '#00E5FF';
            let n = 0.3;
            let v: number | null = null;
            if (link.flow_var) {
              v = pick(live.vars, link.flow_var);
              n = normalizer.norm(link.flow_var, v);
            }
            const stopped = link.flow_var !== null && (v === null || n < 0.01);
            const dur = 0.4 + 2.6 * (1 - Math.min(n, 1));
            const w = STROKE[link.kind] ?? 4;
            return (
              <g key={link.id}>
                <path d={d} className="flow-pipe-bg" stroke={color} strokeWidth={w + 4} />
                <path d={d} className="flow-pipe" stroke={color} strokeWidth={w * 0.55} strokeDasharray="14 26" filter="url(#glow)"
                  style={{ animationDuration: `${dur}s`, animationPlayState: stopped ? 'paused' : 'running', opacity: stopped ? 0.3 : 1 }}>
                  <title>{`${t.linkKind[link.kind] ?? link.kind}：${link.from} → ${link.to}${link.flow_var ? `（${link.flow_var} = ${fmtNum(v, 0)}）` : ''}`}</title>
                </path>
              </g>
            );
          })}

          {geo.units.map(({ u, cx, cy, w, h, specs }) => {
            const dov = unitDO(live.vars, u.id);
            const fill = dov !== null ? `#${doColor(dov, new THREE.Color()).getHexString()}` : null;
            const alarm = u.type === 'effluent' && bad.length > 0;
            const stroke = alarm ? '#FF4D4F' : '#00E5FF';
            const vals = specs.map((sp) => `${sp.label} ${fmtNum(pick(live.vars, ...sp.keys), sp.digits)}`);
            const minDim = Math.min(w, h);
            const textY = cy + Math.max(h / 2, minDim / 2) + 18;
            return (
              <g key={u.id} className="flow-unit">
                {u.shape === 'cylinder' ? (
                  <>
                    <circle cx={cx} cy={cy} r={w / 2} fill="url(#unitFill)" stroke={stroke} strokeWidth={2} filter="url(#glow)" className={alarm ? 'flow-alarm' : ''} />
                    {u.type === 'clarifier' && <circle cx={cx} cy={cy} r={w / 2 - 8} fill="none" stroke="rgba(0,229,255,0.3)" strokeDasharray="4 6" />}
                  </>
                ) : (
                  <>
                    <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={4} fill="url(#unitFill)" stroke={stroke} strokeWidth={2} filter="url(#glow)" className={alarm ? 'flow-alarm' : ''} />
                    {fill && <rect x={cx - w / 2 + 5} y={cy - h / 2 + 5} width={w - 10} height={h - 10} rx={3} fill={fill} opacity={0.35} />}
                  </>
                )}
                <text x={cx} y={cy - (vals.length ? 6 : -5)} textAnchor="middle" fill="#e6f7ff" fontSize={minDim > 70 ? 16 : 13} fontWeight={700}>{u.name}</text>
                {minDim > 70
                  ? vals.map((tx, i) => <text key={i} className="val" x={cx} y={cy + 16 + i * 17} textAnchor="middle" fill={alarm ? '#FF4D4F' : '#00E5FF'} fontSize={13}>{tx}</text>)
                  : vals.map((tx, i) => <text key={i} className="val" x={cx} y={textY + i * 15} textAnchor="middle" fill={alarm ? '#FF4D4F' : '#00E5FF'} fontSize={12}>{tx}</text>)}
              </g>
            );
          })}
        </svg>
      </Panel>
      <Panel style={{ flex: 'none' }}>
        <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--text-2)' }}>
          <b style={{ color: 'var(--text-1)' }}>{t.flow.legend}</b>
          {Object.entries(KIND_COLOR).map(([k, c]) => (
            <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <svg width="38" height="8"><line x1="0" y1="4" x2="38" y2="4" stroke={c} strokeWidth="4" strokeDasharray="8 6" /></svg>{t.linkKind[k]}
            </span>
          ))}
          <span>流動速度依管線流量（flow_var）正規化；灰暗停止表示無流量資料</span>
          {bad.length > 0 && <span className="badge danger pulse"><span className="dot" />放流超標：{bad.join('、')}</span>}
        </div>
      </Panel>
    </div>
  );
}
