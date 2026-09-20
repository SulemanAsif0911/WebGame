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

  useEffect(() => {
    setSettings(loadSettings());
    const stored = localStorage.getItem('iron-district-name');
    if (stored) setName(stored);
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
