export type GunAlign = {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
};

export const DEFAULT_GUN_ALIGN: GunAlign = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

const KEY = 'iron-district-gun-align-v1';

export function loadGunAlign(): GunAlign {
  if (typeof window === 'undefined') return { ...DEFAULT_GUN_ALIGN };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_GUN_ALIGN };
    const p = JSON.parse(raw);
    return {
      x: num(p.x),
      y: num(p.y),
      z: num(p.z),
      rx: num(p.rx),
      ry: num(p.ry),
      rz: num(p.rz),
    };
  } catch {
    return { ...DEFAULT_GUN_ALIGN };
  }
}

export function saveGunAlign(a: GunAlign) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* ignore */
  }
}

function num(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
