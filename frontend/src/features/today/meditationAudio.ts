const chords = [
  [261.63, 329.63, 392],
  [220, 261.63, 329.63],
  [174.61, 220, 261.63],
  [196, 246.94, 293.66],
];

export function playMeditationMusic() {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0.12;
  master.connect(context.destination);
  const voices = chords[0].map((frequency) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.value = 0;
    oscillator.connect(gain).connect(master);
    oscillator.start();
    return { oscillator, gain };
  });
  let chord = 0;
  function changeChord() {
    const now = context.currentTime;
    voices.forEach(({ oscillator, gain }, index) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, 0.3);
      oscillator.frequency.setValueAtTime(chords[chord][index], now + 1);
      gain.gain.setTargetAtTime(0.22, now + 1, 1.2);
    });
    chord = (chord + 1) % chords.length;
  }
  changeChord();
  const timer = window.setInterval(changeChord, 7000);
  return {
    ready: context.resume(),
    stop: () => { window.clearInterval(timer); void context.close(); },
  };
}
