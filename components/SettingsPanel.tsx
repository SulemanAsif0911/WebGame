'use client';

import { useState } from 'react';
import {
  ACTION_LABELS,
  GRAPHICS_HELP,
  prettyKey,
  type ActionName,
  type GameSettings,
  type GraphicsPreset,
} from '@/game/settings';

const ACTIONS = Object.keys(ACTION_LABELS) as ActionName[];

export default function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: GameSettings;
  onChange: (s: GameSettings) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<'graphics' | 'look' | 'controls' | 'crosshair'>('graphics');
  const [waiting, setWaiting] = useState<ActionName | null>(null);
  const x = settings.crosshair;

  function patch(p: Partial<GameSettings>) {
    onChange({ ...settings, ...p });
  }

  function bind(action: ActionName) {
    setWaiting(action);
    const handler = (e: KeyboardEvent | MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      let code = '';
      if ('code' in e) {
        if ((e as KeyboardEvent).code === 'Escape') {
          cleanup();
          return;
        }
        code = (e as KeyboardEvent).code;
      } else {
        code = 'Mouse' + (e as MouseEvent).button;
      }
      patch({ bindings: { ...settings.bindings, [action]: code } });
      cleanup();
    };
    const cleanup = () => {
      setWaiting(null);
      window.removeEventListener('keydown', handler as any, true);
      window.removeEventListener('mousedown', handler as any, true);
    };
    window.addEventListener('keydown', handler as any, true);
    window.addEventListener('mousedown', handler as any, true);
  }

  return (
    <div className="panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className="sheet">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>OPERATOR SETTINGS</h2>
          <button className="btn ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="tabs">
          {(['graphics', 'look', 'controls', 'crosshair'] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </div>

        {tab === 'graphics' && (
          <>
            <p className="help">{GRAPHICS_HELP[settings.graphics]}</p>
            <div className="row">
              <label>Preset</label>
              <select
                value={settings.graphics}
                onChange={(e) => patch({ graphics: e.target.value as GraphicsPreset })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="ultra">Ultra</option>
              </select>
              <span />
            </div>
            <div className="row">
              <label>Field of View</label>
              <input
                type="range"
                min={65}
                max={110}
                value={settings.fov}
                onChange={(e) => patch({ fov: Number(e.target.value) })}
              />
              <span>{settings.fov}°</span>
            </div>
            <div className="row">
              <label>Master Volume</label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.volume}
                onChange={(e) => patch({ volume: Number(e.target.value) })}
              />
              <span>{Math.round(settings.volume * 100)}%</span>
            </div>
          </>
        )}

        {tab === 'look' && (
          <>
            <p className="help">Mouse look is applied in first-person from the operator camera bone.</p>
            <div className="row">
              <label>Sensitivity</label>
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.05}
                value={settings.sensitivity}
                onChange={(e) => patch({ sensitivity: Number(e.target.value) })}
              />
              <span>{settings.sensitivity.toFixed(2)}</span>
            </div>
            <div className="row">
              <label>ADS Multiplier</label>
              <input
                type="range"
                min={0.3}
                max={1}
                step={0.01}
                value={settings.adsSensitivity}
                onChange={(e) => patch({ adsSensitivity: Number(e.target.value) })}
              />
              <span>{settings.adsSensitivity.toFixed(2)}</span>
            </div>
            <div className="row">
              <label>Invert Y</label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.invertY}
                  onChange={(e) => patch({ invertY: e.target.checked })}
                />
                Reverse vertical look
              </label>
              <span />
            </div>
          </>
        )}

        {tab === 'controls' && (
          <>
            <p className="help">Click a bind, then press a key or mouse button. Esc cancels.</p>
            {ACTIONS.map((a) => (
              <div className="row" key={a}>
                <label>{ACTION_LABELS[a]}</label>
                <button className={`bind ${waiting === a ? 'wait' : ''}`} onClick={() => bind(a)}>
                  {waiting === a ? 'Press key…' : prettyKey(settings.bindings[a])}
                </button>
                <span />
              </div>
            ))}
          </>
        )}

        {tab === 'crosshair' && (
          <>
            <div className="xhair-preview">
              <CrosshairSVG settings={settings} />
            </div>
            <div className="row">
              <label>Style</label>
              <select
                value={x.style}
                onChange={(e) =>
                  patch({ crosshair: { ...x, style: e.target.value as typeof x.style } })
                }
              >
                <option value="cross">Cross</option>
                <option value="dot">Dot</option>
                <option value="t">T-shape</option>
                <option value="circle">Circle</option>
              </select>
              <span />
            </div>
            <div className="row">
              <label>Color</label>
              <input
                type="color"
                value={x.color}
                onChange={(e) => patch({ crosshair: { ...x, color: e.target.value } })}
              />
              <span />
            </div>
            <div className="row">
              <label>Size</label>
              <input
                type="range"
                min={2}
                max={16}
                value={x.size}
                onChange={(e) => patch({ crosshair: { ...x, size: Number(e.target.value) } })}
              />
              <span>{x.size}</span>
            </div>
            <div className="row">
              <label>Gap</label>
              <input
                type="range"
                min={0}
                max={18}
                value={x.gap}
                onChange={(e) => patch({ crosshair: { ...x, gap: Number(e.target.value) } })}
              />
              <span>{x.gap}</span>
            </div>
            <div className="row">
              <label>Thickness</label>
              <input
                type="range"
                min={1}
                max={6}
                value={x.thickness}
                onChange={(e) => patch({ crosshair: { ...x, thickness: Number(e.target.value) } })}
              />
              <span>{x.thickness}</span>
            </div>
            <div className="row">
              <label>Opacity</label>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={x.opacity}
                onChange={(e) => patch({ crosshair: { ...x, opacity: Number(e.target.value) } })}
              />
              <span>{Math.round(x.opacity * 100)}%</span>
            </div>
            <div className="row">
              <label>Dot</label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={x.dot}
                  onChange={(e) => patch({ crosshair: { ...x, dot: e.target.checked } })}
                />
                Center dot
              </label>
              <span />
            </div>
            <div className="row">
              <label>Outline</label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={x.outline}
                  onChange={(e) => patch({ crosshair: { ...x, outline: e.target.checked } })}
                />
                Black outline
              </label>
              <span />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function CrosshairSVG({ settings }: { settings: GameSettings }) {
  const { color, size, gap, thickness, dot, outline, opacity, style } = settings.crosshair;
  const s = 80;
  const c = s / 2;
  const stroke = outline ? { stroke: '#000', strokeWidth: thickness + 2 } : {};
  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      className="crosshair"
      style={{ opacity }}
    >
      {style === 'circle' && (
        <circle
          cx={c}
          cy={c}
          r={gap + size}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          {...stroke}
        />
      )}
      {style !== 'dot' && style !== 'circle' && (
        <>
          <line x1={c} y1={c - gap - size} x2={c} y2={c - gap} stroke={color} strokeWidth={thickness} {...stroke} />
          {style !== 't' && (
            <line x1={c} y1={c + gap} x2={c} y2={c + gap + size} stroke={color} strokeWidth={thickness} {...stroke} />
          )}
          <line x1={c - gap - size} y1={c} x2={c - gap} y2={c} stroke={color} strokeWidth={thickness} {...stroke} />
          <line x1={c + gap} y1={c} x2={c + gap + size} y2={c} stroke={color} strokeWidth={thickness} {...stroke} />
        </>
      )}
      {(dot || style === 'dot') && <circle cx={c} cy={c} r={Math.max(1.2, thickness)} fill={color} />}
    </svg>
  );
}
