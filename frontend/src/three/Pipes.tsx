import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Layout, LayoutLink, LayoutUnit } from '../api/types';
import { KIND_COLOR, pick } from '../lib/vars';
import { flowTexture } from './colors';
import type { SceneCtx } from './PlantScene';

const RADIUS: Record<string, number> = { water: 0.5, recycle: 0.38, sludge: 0.34, air: 0.24, chemical: 0.2 };
const PIPE_Y: Record<string, number> = { water: 1.4, recycle: 0.9, sludge: 0.6, air: 0, chemical: 0 };

/** 射線自單元中心往 dir 方向離開底面輪廓的距離 */
function exitDist(u: LayoutUnit, dx: number, dz: number): number {
  const len = Math.hypot(dx, dz) || 1;
  const nx = dx / len, nz = dz / len;
  if (u.shape === 'cylinder') return u.size[0] / 2;
  const hx = u.size[0] / 2, hz = u.size[2] / 2;
  const tx = Math.abs(nx) > 1e-6 ? hx / Math.abs(nx) : Infinity;
  const tz = Math.abs(nz) > 1e-6 ? hz / Math.abs(nz) : Infinity;
  return Math.min(tx, tz);
}

function clipToward(u: LayoutUnit, center: THREE.Vector3, toward: THREE.Vector3): THREE.Vector3 {
  const dx = toward.x - center.x, dz = toward.z - center.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return center.clone();
  const d = Math.min(exitDist(u, dx, dz) + 0.2, len);
  return new THREE.Vector3(center.x + (dx / len) * d, center.y, center.z + (dz / len) * d);
}

/** 依連結計算正交折線路徑（與 2D 流程圖共用規則） */
export function routeLink(link: LayoutLink, a: LayoutUnit, b: LayoutUnit, overheadY: number): THREE.Vector3[] {
  const kind = link.kind;
  const [ax, , az] = a.position;
  const [bx, , bz] = b.position;
  const overhead = kind === 'air' || kind === 'chemical';
  const y = overhead ? overheadY + (kind === 'chemical' ? 0.8 : 0) : PIPE_Y[kind] ?? 1;
  const A = new THREE.Vector3(ax, y, az);
  const B = new THREE.Vector3(bx, y, bz);
  let mids: THREE.Vector3[] = [];
  if (Math.abs(az - bz) > 0.5 && Math.abs(ax - bx) > 0.5) {
    // 選擇離主軸較遠（|z| 較大）的轉角，避開主流程槽體
    const c1 = new THREE.Vector3(ax, y, bz);
    const c2 = new THREE.Vector3(bx, y, az);
    mids = [Math.abs(c1.z) >= Math.abs(c2.z) ? c1 : c2];
  }
  let pts: THREE.Vector3[];
  if (overhead) {
    const start = new THREE.Vector3(ax, a.size[1], az);
    const end = new THREE.Vector3(bx, b.size[1] - 0.3, bz);
    pts = [start, A, ...mids, B, end];
  } else {
    const first = clipToward(a, A, mids[0] ?? B);
    const last = clipToward(b, B, mids[mids.length - 1] ?? A);
    pts = [first, ...mids, last];
  }
  // 去除重複點
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.05);
}

function buildPath(pts: THREE.Vector3[]) {
  const path = new THREE.CurvePath<THREE.Vector3>();
  for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
  return path;
}

function Pipe({ link, a, b, overheadY, ctx }: { link: LayoutLink; a: LayoutUnit; b: LayoutUnit; overheadY: number; ctx: SceneCtx }) {
  const kind = link.kind;
  const color = KIND_COLOR[kind] ?? '#00E5FF';
  const r = RADIUS[kind] ?? 0.3;
  const { geo, flowGeo, length } = useMemo(() => {
    const pts = routeLink(link, a, b, overheadY);
    const path = buildPath(pts);
    const length = path.getLength();
    const seg = Math.max(16, Math.round(length * 3));
    return {
      geo: new THREE.TubeGeometry(path, seg, r, 10, false),
      flowGeo: new THREE.TubeGeometry(path, seg, r * 1.12, 10, false),
      length,
    };
  }, [link, a, b, overheadY, r]);
  const tex = useMemo(() => {
    const t = flowTexture().clone();
    t.needsUpdate = true;
    t.repeat.set(Math.max(1, length / 3.5), 1);
    return t;
  }, [length]);
  const flowMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, dt) => {
    const vars = ctx.getVars();
    let speed = 0.35; // flow_var 為 null 時固定慢速
    let alpha = 0.75;
    if (link.flow_var) {
      const v = pick(vars, link.flow_var);
      const n = ctx.normalizer.norm(link.flow_var, v);
      speed = v === null ? 0 : n * 1.6;
      alpha = v === null ? 0.12 : 0.25 + 0.7 * n;
    }
    // 世界速度（m/s）÷ 貼圖週期長度（m）= 每秒位移的貼圖單位
    const period = length / tex.repeat.x;
    tex.offset.x -= ((speed * 6) / period) * Math.min(dt, 0.1);
    if (flowMat.current) flowMat.current.opacity = alpha;
  });

  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.35} transparent opacity={0.28} emissive={color} emissiveIntensity={0.15} />
      </mesh>
      <mesh geometry={flowGeo}>
        <meshBasicMaterial ref={flowMat} map={tex} color={color} transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Pipes({ layout, ctx }: { layout: Layout; ctx: SceneCtx }) {
  const byId = useMemo(() => new Map(layout.units.map((u) => [u.id, u])), [layout]);
  const overheadY = useMemo(() => Math.max(...layout.units.map((u) => u.size[1]), 3) + 1.6, [layout]);
  return (
    <group>
      {layout.links.map((link) => {
        const a = byId.get(link.from);
        const b = byId.get(link.to);
        if (!a || !b) return null;
        return <Pipe key={link.id} link={link} a={a} b={b} overheadY={overheadY} ctx={ctx} />;
      })}
    </group>
  );
}
