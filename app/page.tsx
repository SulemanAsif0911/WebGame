'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import MainMenu from '@/components/MainMenu';
import { loadSettings, saveSettings, type GameSettings } from '@/game/settings';

const GameView = dynamic(() => import('@/components/GameView'), { ssr: false });

export default function Page() {
  const [settings, setSettings] = useState<GameSettings | null>(null);
  const [name, setName] = useState('OPERATOR');
  const [play, setPlay] = useState(false);
  const [sky, setSky] = useState<'day' | 'night'>('day');
  const [arenaLocked, setArenaLocked] = useState(false);
  const [arenaSky, setArenaSky] = useState<'day' | 'night'>('day');
  const [arenaPlayers, setArenaPlayers] = useState(0);

  useEffect(() => {
    setSettings(loadSettings());
    const stored = localStorage.getItem('iron-district-name');
    if (stored) setName(stored);
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch('/arena', { cache: 'no-store' });
        if (!r.ok || stop) return;
        const a = await r.json();
        if (stop) return;
        const nextSky = a.sky === 'night' ? 'night' : 'day';
        setArenaSky(nextSky);
        setArenaPlayers(Number(a.players) || 0);
        setArenaLocked(!!a.locked);
        if (!a.locked) setSky(nextSky);
      } catch {
        /* offline menu */
      }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  function updateSettings(s: GameSettings) {
    setSettings(s);
    saveSettings(s);
  }

  function updateName(v: string) {
    setName(v);
    localStorage.setItem('iron-district-name', v);
  }

  if (!settings) {
    return <div className="load" />;
  }

  if (!play) {
    return (
      <>
        <div className="grain" />
        <MainMenu
          name={name}
          onName={updateName}
          settings={settings}
          onSettings={updateSettings}
          onDeploy={() => setPlay(true)}
          sky={sky}
          onSky={setSky}
          arenaLocked={arenaLocked}
          arenaSky={arenaSky}
          arenaPlayers={arenaPlayers}
        />
      </>
    );
  }

  return (
    <>
      <div className="grain" />
      <GameView
        name={name || 'OPERATOR'}
        settings={settings}
        onSettings={updateSettings}
        onLeave={() => setPlay(false)}
      />
    </>
  );
}
