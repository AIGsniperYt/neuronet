// Optional completion chime. Off by default; the Timer tool only calls this
// after the user enables sound (which also unlocks the audio context inside a
// gesture) or on a genuine finish.
let context = null;

function audioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return null;
  if (!context || context.state === "closed") context = new AudioCtor();
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

export function primeTimerSound() {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
    setTimeout(() => {
      try { osc.disconnect(); gain.disconnect(); } catch { /* ignore */ }
    }, 80);
  } catch {
    // Audio is a nicety; never let it break the timer.
  }
}

export function playTimerChime() {
  try {
    const ctx = audioContext();
    if (!ctx) return;
    const start = ctx.currentTime + 0.02;
    [659.25, 880, 1318.51].forEach((frequency, index) => {
      const at = start + index * 0.18;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(frequency, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.46);
    });
  } catch {
    // Ignore blocked or unavailable audio.
  }
}
