import * as THREE from 'three';

type Stop = [number, string];

function ramp(stops: Stop[]) {
  const cs = stops.map(([v, c]) => [v, new THREE.Color(c)] as const);
  return (v: number, out: THREE.Color) => {
    if (v <= cs[0][0]) return out.copy(cs[0][1]);
    for (let i = 1; i < cs.length; i++) {
      if (v <= cs[i][0]) {
        const a = (v - cs[i - 1][0]) / (cs[i][0] - cs[i - 1][0]);
        return out.copy(cs[i - 1][1]).lerp(cs[i][1], a);
      }
    }
    return out.copy(cs[cs.length - 1][1]);
  };
}

/** 溶氧：低→暗紅/橘，2 mg/L→青綠 */
export const DO_STOPS: Stop[] = [[0, '#6e1212'], [0.5, '#b8321a'], [1.0, '#ff9f1c'], [1.5, '#a6d64a'], [2.0, '#19d3b5']];
/** 氨氮：低→青綠，高→紅 */
export const NH4_STOPS: Stop[] = [[0, '#19d3b5'], [1, '#2bd99f'], [2.5, '#d6d84a'], [4, '#ff9f1c'], [7, '#ff4d4f']];

export const doColor = ramp(DO_STOPS);
export const nh4Color = ramp(NH4_STOPS);
export const NEUTRAL_WATER = new THREE.Color('#1f6a86');

export function stopsGradient(stops: Stop[]): string {
  const max = stops[stops.length - 1][0];
  return `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${(v / max) * 100}%`).join(', ')})`;
}

let dotTex: THREE.Texture | null = null;
export function bubbleTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(210,250,255,0.85)');
  gr.addColorStop(0.7, 'rgba(120,230,255,0.25)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

let flowTex: THREE.Texture | null = null;
/** 管線流動貼圖：沿 U 方向的箭頭光點 */
export function flowTexture(): THREE.Texture {
  if (flowTex) return flowTex;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 32);
  const gr = g.createLinearGradient(0, 0, 128, 0);
  gr.addColorStop(0, 'rgba(255,255,255,0)');
  gr.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  gr.addColorStop(0.85, 'rgba(255,255,255,0.95)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 32);
  flowTex = new THREE.CanvasTexture(c);
  flowTex.wrapS = THREE.RepeatWrapping;
  flowTex.wrapT = THREE.RepeatWrapping;
  return flowTex;
}
