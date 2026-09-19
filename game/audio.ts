export class GameAudio {
  ctx: AudioContext | null = null;
  master = 0.75;
  private noise: AudioBuffer | null = null;

  setVolume(v: number) {
    this.master = Math.max(0, Math.min(1, v));
  }

  resume() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate * 1.2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private out(node: AudioNode, gain: number, dur: number) {
    if (!this.ctx) return;
    const g = this.ctx.createGain();
    g.gain.value = gain * this.master;
    node.connect(g);
    g.connect(this.ctx.destination);
    return g;
  }

  gunshot(distance = 0) {
    this.resume();
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const atten = 1 / (1 + distance * 0.08);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * this.master * atten, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(bp);
    bp.connect(g);
    g.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.18);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.45 * this.master * atten, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(og);
    og.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  reload() {
    this.resume();
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const clicks = [0, 0.18, 0.55, 1.15, 1.55, 2.05];
    for (const c of clicks) {
      const t = ctx.currentTime + c;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = 1800 + Math.random() * 1200;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * this.master, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      src.connect(f);
      f.connect(g);
      g.connect(ctx.destination);
      src.start(t);
      src.stop(t + 0.09);
    }
  }

  hit(head = false) {
    this.resume();
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = head ? 880 : 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime((head ? 0.18 : 0.12) * this.master, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  hurt() {
    this.resume();
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35 * this.master, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.24);
  }

  foot(sprint = false) {
    this.resume();
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = sprint ? 220 : 160;
    const g = ctx.createGain();
    g.gain.setValueAtTime((sprint ? 0.12 : 0.08) * this.master, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.09);
  }

  kill() {
    this.resume();
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(180, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16 * this.master, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
}
