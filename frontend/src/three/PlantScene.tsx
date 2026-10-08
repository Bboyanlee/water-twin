import { Suspense, useEffect, useMemo } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Edges, Environment, Grid, Lightformer, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Layout, Limits, Tag, VarDict } from '../api/types';
import type { FlowNormalizer } from '../lib/vars';
import { Pipes } from './Pipes';
import { Unit } from './Units';

export type ColorMode = 'do' | 'nh4';

/** 場景內各元件在 useFrame 中讀取的共享狀態（不經 React state） */
export interface SceneCtx {
  getVars: () => VarDict;
  normalizer: FlowNormalizer;
  limits: Limits;
  colorMode: ColorMode;
  showLabels: boolean;
}

interface Props {
  layout: Layout;
  tags: Tag[];
  getVars: () => VarDict;
  normalizer: FlowNormalizer;
  limits: Limits;
  colorMode?: ColorMode;
  showLabels?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

function bounds(layout: Layout) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const u of layout.units) {
    const [x, , z] = u.position;
    const [w, , d] = u.size;
    minX = Math.min(minX, x - w / 2); maxX = Math.max(maxX, x + w / 2);
    minZ = Math.min(minZ, z - d / 2); maxZ = Math.max(maxZ, z + d / 2);
  }
  if (!Number.isFinite(minX)) return { cx: 0, cz: 0, sx: 50, sz: 50 };
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, sx: maxX - minX, sz: maxZ - minZ };
}

/** 依畫布長寬比自動調整相機距離，讓整個廠區入鏡（等角感方向固定） */
function FitCamera({ cx, cz, sx, sz }: { cx: number; cz: number; sx: number; sz: number }) {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(size.height, 1);
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dir = new THREE.Vector3(0.26, 0.6, 0.8).normalize();
    const needW = (Math.max(sx, 30) * 0.5 * 1.08) / Math.tan(hfov / 2);
    const needH = (Math.max(sz, 20) * 0.5 * 1.25 + 4) / Math.tan(vfov / 2);
    // 以邊界框 8 個角點投影做二分搜尋，找出剛好入鏡的距離
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const corners: THREE.Vector3[] = [];
    for (const x of [cx - sx / 2, cx + sx / 2]) for (const z of [cz - sz / 2, cz + sz / 2]) for (const y of [0, 6]) corners.push(new THREE.Vector3(x, y, z));
    const fits = (d: number) => {
      cam.position.set(cx + dir.x * d, dir.y * d, cz + dir.z * d);
      cam.lookAt(cx, 0, cz);
      cam.updateMatrixWorld();
      return corners.every((p) => { const q = p.clone().project(cam); return Math.abs(q.x) < 0.94 && Math.abs(q.y) < 0.86 && q.z < 1; });
    };
    let lo = 10, hi = Math.max(needW, needH) * 2;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    const d = hi;
    cam.position.set(cx + dir.x * d, dir.y * d, cz + dir.z * d);
    cam.far = d * 6;
    cam.updateProjectionMatrix();
    const c = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (c?.target) { c.target.set(cx, 0, cz); c.update?.(); } else cam.lookAt(cx, 0, cz);
  }, [camera, size.width, size.height, controls, cx, cz, sx, sz]);
  return null;
}

export default function PlantScene({ layout, tags, getVars, normalizer, limits, colorMode = 'do', showLabels = true, selectedId, onSelect }: Props) {
  const b = useMemo(() => bounds(layout), [layout]);
  const span = Math.max(b.sx, b.sz * 1.6, 40);
  const camPos: [number, number, number] = [b.cx + span * 0.55, span * 0.85, b.cz + span * 1.05];
  const target: [number, number, number] = [b.cx, 0, b.cz];
  const ctx: SceneCtx = useMemo(
    () => ({ getVars, normalizer, limits, colorMode, showLabels }),
    [getVars, normalizer, limits, colorMode, showLabels],
  );

  return (
    <Canvas
      key={layout.plant_id}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: camPos, fov: 34, near: 0.5, far: 2000 }}
      onPointerMissed={() => onSelect?.(null)}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.05; }}
    >
      <fog attach="fog" args={['#06142B', span * 2, span * 5]} />
      <ambientLight intensity={0.22} color="#9fd8ff" />
      <hemisphereLight args={['#bfe9ff', '#0a1a33', 0.3]} />
      <directionalLight position={[b.cx + 40, 80, b.cz + 30]} intensity={1.05} color="#ffffff" />
      <directionalLight position={[b.cx - 60, 40, b.cz - 40]} intensity={0.45} color="#5fd4ff" />
      <Suspense fallback={null}>
        {/* 離線環境光（不下載 HDR） */}
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={0.8} color="#7fe9ff" position={[0, 10, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[30, 30, 1]} />
          <Lightformer form="rect" intensity={0.6} color="#ffffff" position={[20, 5, 10]} scale={[10, 4, 1]} />
          <Lightformer form="ring" intensity={0.8} color="#19b6ff" position={[-20, 4, -10]} scale={8} />
        </Environment>
      </Suspense>

      {/* 地面平台 */}
      <mesh position={[b.cx, -0.4, b.cz]} receiveShadow>
        <boxGeometry args={[b.sx + 24, 0.8, b.sz + 24]} />
        <meshStandardMaterial color="#0b1e3a" metalness={0.55} roughness={0.6} />
        <Edges color="#00E5FF" />
      </mesh>
      <Grid
        position={[b.cx, 0.02, b.cz]}
        args={[b.sx + 24, b.sz + 24]}
        cellSize={2}
        cellThickness={0.6}
        cellColor="#0f4a6e"
        sectionSize={10}
        sectionThickness={1}
        sectionColor="#00a6c8"
        fadeDistance={span * 5}
        fadeStrength={1}
      />

      <Pipes layout={layout} ctx={ctx} />
      {layout.units.map((u) => (
        <Unit key={u.id} unit={u} layout={layout} tags={tags} ctx={ctx} selected={selectedId === u.id} onSelect={onSelect ?? undefined} />
      ))}

      <FitCamera cx={b.cx} cz={b.cz} sx={b.sx} sz={b.sz} />
      <OrbitControls
        makeDefault
        target={target}
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={15}
        maxDistance={span * 4}
      />
    </Canvas>
  );
}
