'use strict';

function createTowerAudio(button) {
  const key = 'tower-stack-muted';
  const beat = 60 / 112;
  const bars = [
    { bass: 48, chord: [60, 64, 67], melody: [72, null, 76, 79, null, 76, 74, null] },
    { bass: 45, chord: [57, 60, 64], melody: [72, null, 69, null, 72, 76, 74, null] },
    { bass: 41, chord: [57, 60, 65], melody: [72, null, 77, 76, null, 72, 69, null] },
    { bass: 43, chord: [55, 59, 62], melody: [71, null, 74, null, 79, 74, 71, null] },
  ];

  let muted = false;
  try { muted = localStorage.getItem(key) === 'true'; } catch { /* Storage is optional. */ }
  let context;
  let master;
  let music;
  let effects;
  let nextStep = 0;
  let step = 0;
  let scheduler;
  let sessionStarted = false;
  let resumeRequest;

  const frequency = note => 440 * 2 ** ((note - 69) / 12);

  function tone(bus, type, hz, endHz, start, length, strength) {
    const osc = context.createOscillator();
    const envelope = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(hz, start);
    if (endHz !== hz) osc.frequency.exponentialRampToValueAtTime(endHz, start + length);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(strength, start + Math.min(length * 0.22, 0.018));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(envelope).connect(bus);
    osc.start(start);
    osc.stop(start + length + 0.01);
  }

  function updateButton() {
    button.setAttribute('aria-pressed', String(muted));
    button.title = muted ? 'Unmute sound' : 'Mute sound';
  }

  function setOutput() {
    if (!context) return;
    master.gain.setTargetAtTime(muted || document.hidden ? 0 : 0.7, context.currentTime, 0.025);
  }

  function queueMusic() {
    if (context.state !== 'running' || muted || document.hidden) return;
    const now = context.currentTime;
    if (nextStep < now) nextStep = now + 0.035;
    while (nextStep < now + 0.18) {
      const bar = bars[Math.floor(step / 8)];
      const eighth = step % 8;
      const pitch = bar.melody[eighth];
      if (pitch !== null) tone(music, 'triangle', frequency(pitch), frequency(pitch), nextStep, beat * 0.7, 0.055);
      if (eighth === 0 || eighth === 4) {
        const hz = frequency(bar.bass + (eighth === 4 ? 12 : 0));
        tone(music, 'sine', hz, hz, nextStep, beat * 1.45, 0.145);
      }
      if (eighth === 2 || eighth === 6) {
        for (const note of bar.chord) {
          const hz = frequency(note);
          tone(music, 'sine', hz, hz, nextStep, beat * 0.65, 0.034);
        }
      }
      step = (step + 1) % (bars.length * 8);
      nextStep += beat / 2;
    }
  }

  function unlock() {
    if (muted || typeof AudioContext === 'undefined') return Promise.resolve(false);
    if (!context) {
      try {
        context = new AudioContext();
        master = context.createGain();
        music = context.createGain();
        effects = context.createGain();
        master.gain.value = document.hidden ? 0 : 0.7;
        music.gain.value = 0.42;
        effects.gain.value = 0.75;
        music.connect(master);
        effects.connect(master);
        master.connect(context.destination);
      } catch {
        context = undefined;
        return Promise.resolve(false);
      }
    }
    if (context.state === 'running') return Promise.resolve(true);
    resumeRequest ??= context.resume().then(() => context.state === 'running', () => false)
      .finally(() => { resumeRequest = undefined; });
    return resumeRequest;
  }

  function start() {
    sessionStarted = true;
    void unlock().then(running => {
      if (!running || muted) return;
      scheduler ??= setInterval(queueMusic, 55);
      queueMusic();
    });
  }

  button.addEventListener('click', () => {
    muted = !muted;
    try { localStorage.setItem(key, String(muted)); } catch { /* Storage is optional. */ }
    updateButton();
    setOutput();
    if (muted) {
      clearInterval(scheduler);
      scheduler = undefined;
    } else if (sessionStarted) {
      start();
    }
  });
  document.addEventListener('visibilitychange', () => {
    setOutput();
    if (context && sessionStarted) queueMusic();
  });
  updateButton();

  return {
    prime: () => { void unlock(); },
    start,
    play(cue) {
      if (!context || context.state !== 'running' || muted || document.hidden) return;
      const t = context.currentTime + 0.005;
      if (cue === 'drop') {
        tone(effects, 'triangle', 335, 105, t, 0.18, 0.105);
      } else if (cue === 'land' || cue === 'perfect') {
        tone(effects, 'sine', 142, 56, t, 0.13, 0.23);
        tone(effects, 'triangle', 450, 220, t + 0.01, 0.07, 0.10);
        if (cue === 'perfect') {
          tone(effects, 'sine', 784, 784, t + 0.035, 0.19, 0.15);
          tone(effects, 'triangle', 1047, 1047, t + 0.095, 0.26, 0.115);
        }
      } else if (cue === 'miss') {
        tone(effects, 'triangle', 285, 82, t, 0.27, 0.19);
        tone(effects, 'sine', 114, 45, t + 0.12, 0.24, 0.21);
      } else if (cue === 'tick') {
        tone(effects, 'sine', 690, 600, t, 0.085, 0.13);
      } else if (cue === 'finish') {
        [60, 64, 67, 72].forEach((note, i) => {
          const hz = frequency(note);
          tone(effects, 'triangle', hz, hz, t + i * 0.10, 0.34, 0.12);
        });
      }
    },
  };
}
