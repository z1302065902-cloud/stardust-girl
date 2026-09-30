// ---------------------------------------------------------------------------
// audio.js — 纯 WebAudio 程序化音效 / BGM（无需任何音频素材文件）
// ---------------------------------------------------------------------------
export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.muted = false;
    this.musicTimer = null;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  tone({ freq = 440, dur = 0.18, type = 'sine', gain = 0.25, slide = 0, delay = 0, dest = null }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(dest || this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.16, gain = 0.2, delay = 0, hp = 600 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0);
  }

  jump() { this.tone({ freq: 520, slide: 380, dur: 0.16, type: 'triangle', gain: 0.22 }); }
  doubleJump() {
    this.tone({ freq: 660, slide: 520, dur: 0.18, type: 'triangle', gain: 0.22 });
    this.tone({ freq: 990, slide: 300, dur: 0.14, type: 'sine', gain: 0.12, delay: 0.03 });
  }
  land() { this.noise({ dur: 0.12, gain: 0.12, hp: 300 }); }
  collect(n = 0) {
    const base = 880 * Math.pow(2, Math.min(n, 8) / 12);
    this.tone({ freq: base, dur: 0.12, type: 'sine', gain: 0.24 });
    this.tone({ freq: base * 1.5, dur: 0.16, type: 'sine', gain: 0.18, delay: 0.06 });
  }
  stomp() {
    this.noise({ dur: 0.14, gain: 0.22, hp: 200 });
    this.tone({ freq: 300, slide: -160, dur: 0.16, type: 'square', gain: 0.14 });
  }
  hurt() {
    this.tone({ freq: 320, slide: -160, dur: 0.28, type: 'sawtooth', gain: 0.2 });
    this.noise({ dur: 0.2, gain: 0.12, hp: 200 });
  }
  spin() { this.tone({ freq: 220, slide: 660, dur: 0.3, type: 'sine', gain: 0.16 }); }
  goalOpen() {
    [0, 4, 7, 12].forEach((s, i) => this.tone({
      freq: 440 * Math.pow(2, s / 12), dur: 0.5, type: 'sine', gain: 0.16, delay: i * 0.09,
    }));
  }
  win() {
    [0, 4, 7, 12, 16, 19].forEach((s, i) => this.tone({
      freq: 523 * Math.pow(2, s / 12), dur: 0.42, type: 'triangle', gain: 0.17, delay: i * 0.11,
    }));
  }
  lose() {
    [0, -3, -7, -12].forEach((s, i) => this.tone({
      freq: 440 * Math.pow(2, s / 12), dur: 0.5, type: 'sine', gain: 0.17, delay: i * 0.16,
    }));
  }
  ui() { this.tone({ freq: 880, dur: 0.07, type: 'square', gain: 0.1 }); }

  /** 极简循环 BGM：琶音 + 低音 */
  startMusic(scale = 0) {
    this.init();
    if (!this.ctx || this.musicTimer) return;
    const roots = [0, -2, 3];
    const root = roots[scale % roots.length];
    const notes = [0, 7, 12, 16, 12, 7, 3, 7];
    let step = 0;
    const tick = () => {
      const n = notes[step % notes.length] + root;
      const f = 261.63 * Math.pow(2, n / 12);
      this.tone({ freq: f, dur: 0.42, type: 'sine', gain: 0.16, dest: this.musicGain });
      if (step % 4 === 0) {
        this.tone({ freq: f / 4, dur: 0.9, type: 'triangle', gain: 0.22, dest: this.musicGain });
      }
      step++;
    };
    tick();
    this.musicTimer = setInterval(tick, 320);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
