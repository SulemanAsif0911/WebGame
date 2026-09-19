export type GraphicsPreset = 'low' | 'medium' | 'high' | 'ultra';

export type ActionName =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'crouch'
  | 'reload'
  | 'fire'
  | 'ads'
  | 'scoreboard';

export type CrosshairSettings = {
  color: string;
  size: number;
  gap: number;
  thickness: number;
  dot: boolean;
  outline: boolean;
  opacity: number;
  style: 'cross' | 'dot' | 't' | 'circle';
};

export type GameSettings = {
  graphics: GraphicsPreset;
  fov: number;
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  volume: number;
  bindings: Record<ActionName, string>;
  crosshair: CrosshairSettings;
};

export const DEFAULT_SETTINGS: GameSettings = {
  graphics: 'high',
  fov: 82,
  sensitivity: 1.15,
  adsSensitivity: 0.78,
  invertY: false,
  volume: 0.75,
  bindings: {
    forward: 'KeyW',
    back: 'KeyS',
    left: 'KeyA',
    right: 'KeyD',
    jump: 'Space',
    sprint: 'ShiftLeft',
    crouch: 'KeyC',
    reload: 'KeyR',
    fire: 'Mouse0',
    ads: 'Mouse2',
    scoreboard: 'Tab',
  },
  crosshair: {
    color: '#d6ff3a',
    size: 5,
    gap: 5,
    thickness: 2,
    dot: true,
    outline: true,
    opacity: 0.92,
    style: 'cross',
  },
};

const KEY = 'iron-district-settings-v1';

export function loadSettings(): GameSettings {
  if (typeof window === 'undefined') return structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      bindings: { ...DEFAULT_SETTINGS.bindings, ...(parsed.bindings || {}) },
      crosshair: { ...DEFAULT_SETTINGS.crosshair, ...(parsed.crosshair || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: GameSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const ACTION_LABELS: Record<ActionName, string> = {
  forward: 'Move Forward',
  back: 'Move Back',
  left: 'Strafe Left',
  right: 'Strafe Right',
  jump: 'Jump',
  sprint: 'Sprint',
  crouch: 'Crouch',
  reload: 'Reload',
  fire: 'Fire',
  ads: 'Aim Down Sights',
  scoreboard: 'Scoreboard',
};

export function prettyKey(code: string) {
  const map: Record<string, string> = {
    Space: 'Space',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    Tab: 'Tab',
    Mouse0: 'LMB',
    Mouse1: 'MMB',
    Mouse2: 'RMB',
  };
  if (map[code]) return map[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export const GRAPHICS_HELP: Record<GraphicsPreset, string> = {
  low: 'Fastest — no shadows, reduced resolution',
  medium: 'Balanced shadows and draw distance',
  high: 'Full shadows, high anisotropy, ACES tone map',
  ultra: 'Max pixel ratio, 2K shadows, extra fill light',
};
