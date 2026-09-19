'use client';

import { useEffect, useRef, useState } from 'react';
import { ArenaEngine, type HudState } from '@/game/engine';
import type { GameSettings } from '@/game/settings';
import SettingsPanel, { CrosshairSVG } from './SettingsPanel';

const EMPTY: HudState = {
  health: 100,
  mag: 20,
  reserve: 80,
  reloading: false,
  ads: false,
  sprint: false,
  grounded: true,
  alive: true,
  kills: 0,
  deaths: 0,
  players: 1,
  ping: 0,
  connected: false,
  connecting: true,
  hitmarker: 0,
  hurt: 0,
  killfeed: [],
  scoreboard: [],
  killedBy: null,
  respawnIn: 0,
  load: 0,
  loadMsg: 'Booting',
  ammoFlash: 0,
  headshot: false,
};

export default function GameView({
  name,
  settings,
  onSettings,
  onLeave,
}: {
  name: string;
  settings: GameSettings;
  onSettings: (s: GameSettings) => void;
  onLeave: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ArenaEngine | null>(null);
  const [hud, setHud] = useState<HudState>(EMPTY);
  const [paused, setPaused] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [board, setBoard] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new ArenaEngine(canvas, settingsRef.current, name, {
      onHud: setHud,
      onPause: (p) => {
        setPaused(p);
        if (!p) setShowSettings(false);
      },
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [name]);

  useEffect(() => {
    engineRef.current?.applySettings(settings);
  }, [settings]);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === settings.bindings.scoreboard) {
        e.preventDefault();
        setBoard(true);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === settings.bindings.scoreboard) setBoard(false);
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [settings.bindings.scoreboard]);

  const loading = hud.load < 1;

  return (
    <div className="game-root">
      <canvas
        ref={canvasRef}
        onClick={() => {
          if (!paused && hud.alive) engineRef.current?.requestLock();
        }}
      />
      <div className="hud">
        <div className="hurt-vignette" style={{ opacity: hud.hurt * 0.85 }} />
        {!loading && hud.alive && !hud.ads && <CrosshairSVG settings={settings} />}
        <div
          className="hit"
          style={{
            opacity: hud.hitmarker,
            borderColor: hud.headshot ? '#ff5a2a' : '#ffffff',
          }}
        />
        <div className="top-left">
          IRON DISTRICT FFA
          <br />
          {hud.connected ? `LINK ${hud.ping}ms` : hud.connecting ? 'LINKING…' : 'OFFLINE'}
          <br />
          {hud.players} OPERATORS · {hud.kills} K / {hud.deaths} D
        </div>
        <div className="feed">
          {hud.killfeed.map((k) => (
            <div key={k.id} className={`feed-item ${k.head ? 'hs' : ''}`}>
              {k.text}
            </div>
          ))}
        </div>
        <div className="hp">
          <div className="hp-label">VITALS</div>
          <div className="hp-bar">
            <div className="hp-fill" style={{ width: `${Math.max(0, hud.health)}%` }} />
          </div>
          <div className="hp-num">{Math.max(0, Math.round(hud.health))}</div>
        </div>
        <div className={`ammo ${hud.reloading || hud.ammoFlash > 0 ? 'reload' : ''}`}>
          <div className="hp-label" style={{ textAlign: 'right' }}>
            {hud.reloading ? 'RELOADING FN FAL' : '7.62 NATO'}
          </div>
          <div className="mag">{String(hud.mag).padStart(2, '0')}</div>
          <div className="res">/ {String(hud.reserve).padStart(2, '0')}</div>
        </div>
        {board && !paused && (
          <div className="board">
            <h3>ARENA SCOREBOARD</h3>
            <table>
              <thead>
                <tr>
                  <th>OPERATOR</th>
                  <th>K</th>
                  <th>D</th>
                  <th>HP</th>
                </tr>
              </thead>
              <tbody>
                {hud.scoreboard.map((s) => (
                  <tr key={s.id} className={s.you ? 'you' : ''}>
                    <td>
                      {s.name}
                      {s.you ? '  (YOU)' : ''}
                      {!s.alive ? '  — DOWN' : ''}
                    </td>
                    <td>{s.kills}</td>
                    <td>{s.deaths}</td>
                    <td>{s.alive ? s.health : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!hud.alive && !loading && (
          <div className="death">
            <div className="kicker">ELIMINATED</div>
            <h2>KIA</h2>
            <p>BY {hud.killedBy || 'UNKNOWN'}</p>
            <p>RETURNING IN {(hud.respawnIn / 1000).toFixed(1)}s</p>
          </div>
        )}
      </div>

      {loading && (
        <div className="load">
          <div className="kicker">DEPLOYING</div>
          <h1>IRON DISTRICT</h1>
          <div className="load-bar">
            <div className="load-fill" style={{ width: `${Math.round(hud.load * 100)}%` }} />
          </div>
          <div className="kicker">{hud.loadMsg}</div>
        </div>
      )}

      {paused && (
        <div className="pause">
          {showSettings ? (
            <SettingsPanel
              settings={settings}
              onChange={onSettings}
              onClose={() => setShowSettings(false)}
            />
          ) : (
            <div className="sheet" style={{ width: 360 }}>
              <h2>PAUSED</h2>
              <p className="help">Pointer released. Arena is still live.</p>
              <div className="menu-actions" style={{ width: '100%' }}>
                <button
                  className="btn primary"
                  onClick={() => {
                    setPaused(false);
                    engineRef.current?.setPaused(false);
                  }}
                >
                  Resume
                </button>
                <button className="btn" onClick={() => setShowSettings(true)}>
                  Settings
                </button>
                <button className="btn" onClick={onLeave}>
                  Leave Arena
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
