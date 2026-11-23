import { GameState, SimEvent } from '../sim/types';

/**
 * Rebuilt procedural WebAudio soundscape for Bayou State 3D:
 * - Warm, understated tactile placement sounds (never harsh or abrupt)
 * - Soft filtered bayou rain & gentle wind ambience
 * - Resonant Memorial Bell Tower Westminster chimes
 * - Epic layered brass section & snare drumline fanfare for game day!
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private rainFilter: BiquadFilterNode | null = null;
  muted = false;
  private unlocked = false;

  unlock(): void {
    if (this.unlocked) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.42;
      this.masterGain.connect(this.ctx.destination);

      // Gentle filtered pink-ish noise layer for rain & bayou breeze
      const bufSize = this.ctx.sampleRate * 2;
      const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < bufSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        data[i] = (b0 + b1 + b2 + white * 0.04) * 0.6;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;

      this.rainFilter = this.ctx.createBiquadFilter();
      this.rainFilter.type = 'bandpass';
      this.rainFilter.frequency.value = 900;
      this.rainFilter.Q.value = 0.65;

      this.rainGain = this.ctx.createGain();
      this.rainGain.gain.value = 0.0;

      src.connect(this.rainFilter);
      this.rainFilter.connect(this.rainGain);
      this.rainGain.connect(this.masterGain);
      src.start();

      this.unlocked = true;
    } catch {
      // Headless or restricted browser audio
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.08);
    }
  }

  updateAmbience(state: GameState): void {
    if (!this.ctx || !this.rainGain || !this.rainFilter || this.muted) return;
    const rain = Math.max(state.rainRate, state.storm.active ? state.storm.rainRate : 0);
    const targetVol = rain > 0.05 ? 0.04 + rain * 0.24 : 0.012;
    this.rainGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.25);
    this.rainFilter.frequency.setTargetAtTime(rain > 0.4 ? 1250 : 720, this.ctx.currentTime, 0.3);
  }

  handleEvent(ev: SimEvent): void {
    if (this.muted || !this.ctx || !this.masterGain) return;
    switch (ev.type) {
      case 'place':
        this.playSoftThud(220, 0.14);
        break;
      case 'demolish':
        this.playSoftThud(140, 0.16);
        break;
      case 'upgrade':
      case 'goal_complete':
        this.playSuccessChord();
        break;
      case 'bell_chime':
        this.playBellChimes();
        break;
      case 'kickoff':
        this.playBrassFanfare(false);
        break;
      case 'touchdown':
      case 'game_win':
        this.playBrassFanfare(true);
        break;
      case 'lightning':
        this.playSoftThunder();
        break;
      case 'toast':
      case 'dilemma':
        this.playPing(587.33, 0.14);
        break;
      case 'parade_start':
        this.playSecondLineGroove();
        break;
    }
  }

  private playSecondLineGroove(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Festive New Orleans Mardi Gras brass second-line bounce!
    const notes = [
      { f: 261.63, t: 0.0, d: 0.14 },
      { f: 329.63, t: 0.16, d: 0.14 },
      { f: 392.0, t: 0.32, d: 0.16 },
      { f: 440.0, t: 0.50, d: 0.14 },
      { f: 392.0, t: 0.66, d: 0.14 },
      { f: 523.25, t: 0.82, d: 0.38 },
    ];
    for (const n of notes) {
      const t = now + n.t;
      const osc = this.ctx.createOscillator();
      const flt = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(n.f, t);
      flt.type = 'lowpass';
      flt.frequency.setValueAtTime(1600, t);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + n.d + 0.06);
      osc.connect(flt);
      flt.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + n.d + 0.08);
      this.playSnareHit(t);
    }
  }

  private playSoftThud(freq: number, dur: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.48, now + dur);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private playPing(freq: number, dur: number): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.16, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  private playSuccessChord(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const notes = [392.0, 493.88, 587.33, 783.99]; // Warm G major arpeggio
    notes.forEach((f, idx) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + idx * 0.07;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  private playBellChimes(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Gentle Westminster-inspired 4-note Memorial Bell Tower motif
    const notes = [659.25, 523.25, 587.33, 392.0];
    notes.forEach((freq, i) => {
      if (!this.ctx || !this.masterGain) return;
      const t = now + i * 0.42;
      const osc = this.ctx.createOscillator();
      const over = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      over.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      over.frequency.setValueAtTime(freq * 2.005, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.11, t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0008, t + 1.4);

      const overGain = this.ctx.createGain();
      overGain.gain.value = 0.28;
      osc.connect(gain);
      over.connect(overGain);
      overGain.connect(gain);
      gain.connect(this.masterGain);

      osc.start(t);
      over.start(t);
      osc.stop(t + 1.45);
      over.stop(t + 1.45);
    });
  }

  /**
   * Epic Southern Marching-Band Brass & Snare Fanfare!
   */
  private playBrassFanfare(touchdown: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    // Heroic Bb-major stadium brass riff!
    const phrase = touchdown
      ? [
          { f: 233.08, t: 0.0, d: 0.16 },
          { f: 293.66, t: 0.17, d: 0.16 },
          { f: 349.23, t: 0.34, d: 0.22 },
          { f: 466.16, t: 0.58, d: 0.52 },
        ]
      : [
          { f: 233.08, t: 0.0, d: 0.18 },
          { f: 349.23, t: 0.2, d: 0.18 },
          { f: 466.16, t: 0.4, d: 0.42 },
        ];

    for (const note of phrase) {
      const t = now + note.t;
      // Layer two slightly detuned sawtooth oscillators through a warm brass lowpass filter
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(520, t);
      filter.frequency.exponentialRampToValueAtTime(2100, t + 0.06);
      filter.frequency.exponentialRampToValueAtTime(1100, t + note.d);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.16, t + 0.035);
      gain.gain.setValueAtTime(0.14, t + note.d * 0.72);
      gain.gain.exponentialRampToValueAtTime(0.001, t + note.d + 0.08);

      for (const detune of [-7, 0, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(note.f, t);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + note.d + 0.1);
      }

      // Low tuba fifth anchor on final triumphant hit
      if (note.d > 0.35) {
        const tuba = this.ctx.createOscillator();
        tuba.type = 'triangle';
        tuba.frequency.setValueAtTime(note.f * 0.25, t);
        tuba.connect(filter);
        tuba.start(t);
        tuba.stop(t + note.d + 0.1);
      }

      filter.connect(gain);
      gain.connect(this.masterGain);
    }

    // Crisp snare drum hits
    for (const st of [0.0, 0.17, 0.34, 0.58]) {
      this.playSnareHit(now + st);
    }
  }

  private playSnareHit(t: number): void {
    if (!this.ctx || !this.masterGain) return;
    const len = Math.floor(this.ctx.sampleRate * 0.09);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25));
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1400;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.12;
    src.connect(hp);
    hp.connect(gain);
    gain.connect(this.masterGain);
    src.start(t);
  }

  private playSoftThunder(): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 1.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.sin(Math.min(1, i / (len * 0.12)) * Math.PI * 0.5) * Math.exp(-i / (len * 0.42));
      d[i] = (Math.random() * 2 - 1) * env;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.28;
    src.connect(lp);
    lp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
  }
}
