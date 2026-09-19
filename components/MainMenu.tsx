'use client';

import { useEffect, useState } from 'react';
import MenuPreview from './MenuPreview';
import SettingsPanel from './SettingsPanel';
import type { GameSettings } from '@/game/settings';

export default function MainMenu({
  name,
  onName,
  settings,
  onSettings,
  onDeploy,
}: {
  name: string;
  onName: (v: string) => void;
  settings: GameSettings;
  onSettings: (s: GameSettings) => void;
  onDeploy: () => void;
}) {
  const [panel, setPanel] = useState<null | 'settings' | 'credits'>(null);
  const [host, setHost] = useState('LAN');

  useEffect(() => {
    setHost(window.location.host);
  }, []);

  return (
    <div className="menu-root">
      <MenuPreview />
      <div className="menu-shade" />
      <div className="menu-frame">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
          <div className="brand">
            <div className="kicker">Network Arena · Free For All</div>
            <h1 className="logo">
              IRON
              <br />
              <span>DISTRICT</span>
            </h1>
            <p className="tag">
              One urban killbox. Every operator who deploys on this address is in the same
              live arena. No bots. No instances. Optic carbine. Free for all.
            </p>
          </div>
          <div className="callsign">
            <label>Callsign</label>
            <input
              maxLength={16}
              value={name}
              placeholder="OPERATOR"
              onChange={(e) => onName(e.target.value.toUpperCase())}
            />
          </div>
          <div className="menu-actions">
            <button className="btn primary" onClick={onDeploy}>
              Deploy
            </button>
            <button className="btn" onClick={() => setPanel('settings')}>
              Settings
            </button>
            <button className="btn" onClick={() => setPanel('credits')}>
              Credits
            </button>
          </div>
          <div className="meta-foot">
            <span>NODE {host}</span>
            <span>WASD MOVE · LMB FIRE · RMB ADS · R RELOAD · TAB BOARD</span>
            <span>Shared instance · all clients join the same FFA</span>
          </div>
        </div>
        <div className="right-col">
          <div className="live-chip">SECTOR ONLINE</div>
          <div className="live-chip">CARBINE · OPTIC</div>
        </div>
      </div>

      {panel === 'settings' && (
        <SettingsPanel settings={settings} onChange={onSettings} onClose={() => setPanel(null)} />
      )}
      {panel === 'credits' && (
        <div className="panel" onClick={() => setPanel(null)}>
          <div className="sheet credits" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <h2>CREDITS</h2>
              <button className="btn ghost" onClick={() => setPanel(null)}>
                Close
              </button>
            </div>
            <p>
              <strong>IRON DISTRICT</strong> is a LAN free-for-all built around the assets in
              this repository. Every client that hits the server IP deploys into a single
              shared arena.
            </p>
            <p>
              <strong>Shooting Game Environment Map TDM</strong>
              <br />
              00amza — Sketchfab — CC BY 4.0
            </p>
            <p>
              <strong>Operator (third person)</strong>
              <br />
              Stavich — Sketchfab — CC BY-NC-ND 4.0
            </p>
            <p>
              <strong>FPV carbine with optic (DJMaesen)</strong>
              <br />
              From SulemanAsif0911/Gun-Models — fps_animated_carbine. Sketchfab / DJMaesen.
            </p>
            <p>
              First-person view uses the carbine POV rig. Hold ADS to look through the sight
              with zoom. Other operators who deploy share this arena and the opponent mesh.
              Firearms audio is synthesized locally.
            </p>
            <small>Not affiliated with any publisher. For private network play.</small>
          </div>
        </div>
      )}
    </div>
  );
}
