import { useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Layout, LayoutUnit, Tag } from '../api/types';
import { fmtNum, pick, unitBlanket, unitDO, unitDriveVar, unitKLa, unitLabelSpecs, unitNH4, violations } from '../lib/vars';
import { bubbleTexture, doColor, NEUTRAL_WATER, nh4Color } from './colors';
import type { SceneCtx } from './PlantScene';

const OPEN_TOP = new Set(['influent', 'screen', 'equalization', 'anoxic_tank', 'aerobic_tank', 'reactor', 'effluent']);
const WALL_COLOR: Record<string, string> = {
  aerobic_tank: '#1d3b5e', anoxic_tank: '#1b3355', clarifier: '#1d3b5e', influent: '#223a55', effluent: '#223a55',
  blower: '#2c4766', pump: '#2c4766', chem_tank: '#5a5130', filter: '#26425f', ro: '#2a4a6a', sludge: '#3d3328',
  reactor: '#24405f', equalization: '#1d3b5e', screen: '#223a55', control_room: '#2a3f5c',
};
const MAX_BUBBLES = 300;
const LABEL_INTERVAL = 0.25;

interface UnitProps {
  unit: LayoutUnit;
  layout: Layout;
  tags: Tag[];
  ctx: SceneCtx;
  selected: boolean;
  onSelect?: (id: string) => void;
}

/** 開頂槽體：四面牆＋底，頂面透明 */
function useWallMaterials(color: string, openTop: boolean) {
  return useMemo(() => {
    const wall = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55, emissive: new THREE.Color('#000000') });
    const hidden = new THREE.MeshBasicMaterial({ visible: false });
    const mats = openTop ? [wall, wall, hidden, wall, wall, wall] : wall;
    return { wall, mats };
  }, [color, openTop]);
}

function Bubbles({ unit, ctx, waterY }: { unit: LayoutUnit; ctx: SceneCtx; waterY: number }) {
  const [w, , d] = unit.size;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_BUBBLES * 3);
    for (let i = 0; i < MAX_BUBBLES; i++) {
      pos[i * 3] = (Math.random() - 0.5) * w * 0.85;
      pos[i * 3 + 1] = Math.random() * waterY;
      pos[i * 3 + 2] = (Math.random() - 0.5) * d * 0.85;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setDrawRange(0, 0);
    return g;
  }, [w, d, waterY]);
  const speeds = useMemo(() => Float32Array.from({ length: MAX_BUBBLES }, () => 0.6 + Math.random() * 0.8), []);
  useFrame((_, dt) => {
    const kla = unitKLa(ctx.getVars(), unit.id) ?? 0;
    const frac = Math.min(Math.max(kla / 240, 0), 1.3);
    const n = kla <= 0 ? 0 : Math.max(8, Math.round(MAX_BUBBLES * Math.min(frac, 1)));
    geo.setDrawRange(0, n);
    if (n === 0) return;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const rise = (0.8 + 2.6 * frac) * Math.min(dt, 0.1);
    for (let i = 0; i < n; i++) {
      const k = i * 3 + 1;
      arr[k] += rise * speeds[i];
      if (arr[k] > waterY) {
        arr[k] = 0.2;
        arr[k - 1] = (Math.random() - 0.5) * w * 0.85;
        arr[k + 1] = (Math.random() - 0.5) * d * 0.85;
      }
    }
    pos.needsUpdate = true;
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial map={bubbleTexture()} size={0.55} sizeAttenuation transparent opacity={0.85} depthWrite={false} color="#dffaff" blending={THREE.AdditiveBlending} />
    </points>
  );
}

function Rotor({ unit, ctx, layout, axis = 'y', radius, y }: { unit: LayoutUnit; ctx: SceneCtx; layout: Layout; axis?: 'x' | 'y'; radius: number; y: number }) {
  const ref = useRef<THREE.Group>(null);
  const drive = useMemo(() => unitDriveVar(unit, layout), [unit, layout]);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const vars = ctx.getVars();
    let n = 0.35;
    if (drive.length) {
      let s = 0, c = 0;
      for (const k of drive) {
        const v = pick(vars, k);
        if (v !== null) { s += ctx.normalizer.norm(k, v); c++; }
      }
      n = c ? s / c : 0;
    }
    const sp = n * 9 * Math.min(dt, 0.1);
    if (axis === 'x') ref.current.rotation.x += sp;
    else ref.current.rotation.y += sp;
  });
  const blades = [0, 1, 2, 3].map((i) => (
    <mesh key={i} rotation={axis === 'x' ? [(i * Math.PI) / 2, 0, 0] : [0, (i * Math.PI) / 2, 0]} position={[0, 0, 0]}>
      <boxGeometry args={axis === 'x' ? [0.15, radius * 1.8, 0.35] : [radius * 1.8, 0.15, 0.35]} />
      <meshStandardMaterial color="#9fe9ff" metalness={0.8} roughness={0.25} emissive="#00b8d9" emissiveIntensity={0.4} />
    </mesh>
  ));
  return (
    <group ref={ref} position={[0, y, 0]}>
      {blades}
      <mesh rotation={axis === 'x' ? [0, 0, Math.PI / 2] : [0, 0, 0]}>
        <cylinderGeometry args={[radius * 0.22, radius * 0.22, 0.5, 16]} />
        <meshStandardMaterial color="#cfefff" metalness={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
}

function Mixer({ height, radius }: { height: number; radius: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += 1.2 * Math.min(dt, 0.1); });
  return (
    <group ref={ref}>
      <mesh position={[0, height * 0.55, 0]}>
        <cylinderGeometry args={[0.12, 0.12, height * 0.9, 8]} />
        <meshStandardMaterial color="#b6c8d8" metalness={0.9} roughness={0.3} />
      </mesh>
      <mesh position={[0, height * 0.3, 0]}>
        <boxGeometry args={[radius * 1.2, 0.12, 0.5]} />
        <meshStandardMaterial color="#b6c8d8" metalness={0.9} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Clarifier({ unit, ctx }: { unit: LayoutUnit; ctx: SceneCtx }) {
  const [dia, h] = unit.size;
  const r = dia / 2;
  const sludge = useRef<THREE.Mesh>(null);
  const top = useRef<THREE.Mesh>(null);
  const bridge = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const b = unitBlanket(ctx.getVars(), unit.id);
    const hb = Math.min(Math.max(b ?? 0.6, 0.05), h * 0.92);
    if (sludge.current) { sludge.current.scale.y = hb; sludge.current.position.y = hb / 2; }
    if (top.current) top.current.position.y = hb;
    if (bridge.current) bridge.current.rotation.y += 0.15 * Math.min(dt, 0.1);
  });
  return (
    <group>
      {/* 池壁 */}
      <mesh>
        <cylinderGeometry args={[r, r, h, 64, 1, true]} />
        <meshStandardMaterial color={WALL_COLOR.clarifier} metalness={0.35} roughness={0.55} side={THREE.DoubleSide} transparent opacity={0.55} />
        <Edges color="#00E5FF" threshold={30} />
      </mesh>
      <mesh position={[0, -h / 2 + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[r, 64]} />
        <meshStandardMaterial color="#14263f" />
      </mesh>
      <group position={[0, -h / 2, 0]}>
        {/* 污泥層（高度=污泥界面） */}
        <mesh ref={sludge}>
          <cylinderGeometry args={[r * 0.97, r * 0.97, 1, 48]} />
          <meshStandardMaterial color="#6b4423" transparent opacity={0.45} depthWrite={false} />
        </mesh>
        <mesh ref={top} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r * 0.97, 48]} />
          <meshStandardMaterial color="#a0652e" transparent opacity={0.7} emissive="#5a2e0a" emissiveIntensity={0.4} side={THREE.DoubleSide} />
        </mesh>
        {/* 澄清水面 */}
        <mesh position={[0, h * 0.94, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r * 0.98, 64]} />
          <meshStandardMaterial color="#1aa6c4" transparent opacity={0.35} metalness={0.2} roughness={0.1} emissive="#0a5a73" emissiveIntensity={0.4} depthWrite={false} />
        </mesh>
        {/* 刮泥橋 */}
        <group ref={bridge} position={[0, h + 0.4, 0]}>
          <mesh>
            <boxGeometry args={[dia, 0.35, 1.0]} />
            <meshStandardMaterial color="#c9d6e2" metalness={0.8} roughness={0.35} />
          </mesh>
        </group>
        <mesh position={[0, h / 2, 0]}>
          <cylinderGeometry args={[1.2, 1.2, h + 0.6, 24]} />
          <meshStandardMaterial color="#7f95ab" metalness={0.7} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function UnitLabel({ unit, layout, tags, ctx, height }: { unit: LayoutUnit; layout: Layout; tags: Tag[]; ctx: SceneCtx; height: number }) {
  const valRef = useRef<HTMLSpanElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const specs = useMemo(() => unitLabelSpecs(unit, layout, tags), [unit, layout, tags]);
  const acc = useRef(LABEL_INTERVAL);
  useFrame((_, dt) => {
    acc.current += dt;
    if (acc.current < LABEL_INTERVAL) return;
    acc.current = 0;
    const vars = ctx.getVars();
    if (valRef.current) {
      valRef.current.textContent = specs.map((s) => `${s.label} ${fmtNum(pick(vars, ...s.keys), s.digits)}${s.unit ? ` ${s.unit}` : ''}`).join('  ');
    }
    if (boxRef.current && unit.type === 'effluent') {
      boxRef.current.classList.toggle('alarm', violations(vars, ctx.limits).length > 0);
    }
  });
  return (
    <Html position={[0, height + 1.2, 0]} zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
      <div className="unit-label" ref={boxRef}>
        <span className="n">{unit.name}</span>
        {specs.length > 0 && <span className="v" ref={valRef}>—</span>}
      </div>
    </Html>
  );
}

export function Unit({ unit, layout, tags, ctx, selected, onSelect }: UnitProps) {
  const [hover, setHover] = useState(false);
  const [w, h, d] = unit.size;
  const type = unit.type;
  const isCyl = unit.shape === 'cylinder';
  const openTop = OPEN_TOP.has(type);
  const { wall, mats } = useWallMaterials(WALL_COLOR[type] ?? '#20385a', openTop);
  const water = useRef<THREE.MeshStandardMaterial>(null);
  const tmp = useMemo(() => new THREE.Color(), []);
  const waterY = h * 0.86;
  const edgeColor = selected ? '#ffffff' : hover ? '#7ff3ff' : '#00b8d9';

  useFrame(({ clock }) => {
    const vars = ctx.getVars();
    if (water.current) {
      let c: THREE.Color = NEUTRAL_WATER;
      if (ctx.colorMode === 'nh4') {
        const v = unitNH4(vars, unit.id);
        if (v !== null) c = nh4Color(v, tmp);
      } else {
        const v = unitDO(vars, unit.id);
        if (v !== null) c = doColor(v, tmp);
      }
      water.current.color.copy(c).multiplyScalar(0.55);
      water.current.emissive.copy(c).multiplyScalar(0.5);
    }
    // 放流超標閃紅
    if (type === 'effluent') {
      const bad = violations(vars, ctx.limits).length > 0;
      const k = bad ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 7) : 0;
      wall.emissive.setRGB(k * 1.0, k * 0.12, k * 0.12);
      wall.emissiveIntensity = bad ? 1.4 : 0;
    } else {
      wall.emissive.set(selected ? '#004a5c' : hover ? '#00303c' : '#000000');
      wall.emissiveIntensity = 1;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect?.(unit.id); };
  const pointer = {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; },
    onPointerOut: () => { setHover(false); document.body.style.cursor = ''; },
    onClick,
  };

  let body: React.ReactNode;
  if (type === 'clarifier') {
    body = (
      <group position={[0, h / 2, 0]} {...pointer}>
        <Clarifier unit={unit} ctx={ctx} />
      </group>
    );
  } else if (type === 'pump') {
    const r = w / 2;
    body = (
      <group {...pointer}>
        <mesh position={[0, r + 0.1, 0]} rotation={[0, 0, Math.PI / 2]} material={wall}>
          <cylinderGeometry args={[r, r, h, 24]} />
          <Edges color={edgeColor} threshold={30} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[h * 1.3, 0.2, w * 1.1]} />
          <meshStandardMaterial color="#334c6b" metalness={0.5} roughness={0.6} />
        </mesh>
        <group position={[h / 2 + 0.15, r + 0.1, 0]}>
          <Rotor unit={unit} ctx={ctx} layout={layout} axis="x" radius={r * 0.9} y={0} />
        </group>
      </group>
    );
  } else if (type === 'blower') {
    body = (
      <group {...pointer}>
        <mesh position={[0, h / 2, 0]} material={wall}>
          <boxGeometry args={[w, h, d]} />
          <Edges color={edgeColor} />
        </mesh>
        {[-w / 4, w / 4].map((x) => (
          <group key={x} position={[x, h + 0.05, 0]}>
            <mesh>
              <cylinderGeometry args={[d * 0.36, d * 0.36, 0.3, 32]} />
              <meshStandardMaterial color="#14263f" metalness={0.6} roughness={0.4} />
            </mesh>
            <Rotor unit={unit} ctx={ctx} layout={layout} radius={d * 0.32} y={0.3} />
          </group>
        ))}
      </group>
    );
  } else if (isCyl) {
    const r = w / 2;
    body = (
      <group {...pointer}>
        <mesh position={[0, h / 2, 0]} material={wall}>
          <cylinderGeometry args={[r, r, h, 48, 1, openTop]} />
          <Edges color={edgeColor} threshold={30} />
        </mesh>
        {openTop && (
          <>
            <mesh position={[0, waterY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[r * 0.97, 48]} />
              <meshStandardMaterial ref={water} color={NEUTRAL_WATER} transparent opacity={0.9} metalness={0} roughness={0.55} envMapIntensity={0.25} />
            </mesh>
            <Mixer height={h} radius={r} />
          </>
        )}
        {type === 'chem_tank' && (
          <mesh position={[0, h + 0.2, 0]}>
            <sphereGeometry args={[r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#c7b24a" metalness={0.4} roughness={0.5} />
          </mesh>
        )}
      </group>
    );
  } else {
    body = (
      <group {...pointer}>
        <mesh position={[0, h / 2, 0]} material={mats}>
          <boxGeometry args={[w, h, d]} />
          <Edges color={edgeColor} />
        </mesh>
        {openTop && (
          <mesh position={[0, waterY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[w * 0.97, d * 0.97]} />
            <meshStandardMaterial ref={water} color={NEUTRAL_WATER} transparent opacity={0.9} metalness={0} roughness={0.55} envMapIntensity={0.25} />
          </mesh>
        )}
        {type === 'anoxic_tank' && <Mixer height={h} radius={Math.min(w, d) / 2} />}
        {type === 'control_room' && (
          <>
            {[1, -1].map((sgn) => (
              <mesh key={sgn} position={[0, h * 0.62, (sgn * d) / 2 + sgn * 0.02]} rotation={[0, sgn > 0 ? 0 : Math.PI, 0]}>
                <planeGeometry args={[w * 0.82, h * 0.28]} />
                <meshBasicMaterial color="#5fe8ff" transparent opacity={0.75} toneMapped={false} />
              </mesh>
            ))}
            <mesh position={[w * 0.3, h + 1.2, 0]}>
              <cylinderGeometry args={[0.06, 0.06, 2.4, 6]} />
              <meshStandardMaterial color="#b6c8d8" metalness={0.9} />
            </mesh>
          </>
        )}
        {type === 'ro' && [-1, 0, 1].map((i) => (
          <mesh key={i} position={[0, h + 0.5, i * d * 0.28]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.45, 0.45, w * 0.9, 16]} />
            <meshStandardMaterial color="#d8e6f2" metalness={0.8} roughness={0.25} />
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <group position={unit.position}>
      {body}
      {type === 'aerobic_tank' && <Bubbles unit={unit} ctx={ctx} waterY={waterY} />}
      {ctx.showLabels && <UnitLabel unit={unit} layout={layout} tags={tags} ctx={ctx} height={type === 'clarifier' ? h + 0.6 : h} />}
    </group>
  );
}
