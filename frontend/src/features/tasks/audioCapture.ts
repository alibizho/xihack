export type CapturedAudio = {
  samples: Float32Array;
  sampleRate: 16_000;
  wav: Blob;
};

export type AudioCapture = {
  stop: () => Promise<CapturedAudio>;
  cancel: () => Promise<void>;
};

const OUTPUT_RATE = 16_000;

function resample(chunks: Float32Array[], inputRate: number): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  if (length < inputRate / 10) throw new Error("录音太短，请再试一次");
  const input = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const count = Math.floor(length * OUTPUT_RATE / inputRate);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index++) {
    const position = index * inputRate / OUTPUT_RATE;
    const before = Math.floor(position);
    samples[index] = input[before] + ((input[Math.min(before + 1, length - 1)] - input[before]) * (position - before));
  }
  return samples;
}

function encodeWav(samples: Float32Array): Blob {
  const count = samples.length;
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const label = (at: number, value: string) => { for (let index = 0; index < value.length; index++) view.setUint8(at + index, value.charCodeAt(index)); };
  label(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); label(8, "WAVE");
  label(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, OUTPUT_RATE, true);
  view.setUint32(28, OUTPUT_RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  label(36, "data"); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    view.setInt16(44 + index * 2, Math.round(Math.max(-1, Math.min(1, samples[index])) * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export async function startAudioCapture(): Promise<AudioCapture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("此浏览器无法访问麦克风，请检查权限或使用文字输入");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  let context: AudioContext | undefined;
  try {
    const BrowserAudioContext = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!BrowserAudioContext) throw new Error("此浏览器无法录音，请使用文字输入");
    context = new BrowserAudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    const silent = context.createGain();
    silent.gain.value = 0;
    const chunks: Float32Array[] = [];
    processor.onaudioprocess = (event) => chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    source.connect(processor); processor.connect(silent); silent.connect(context.destination);
    await context.resume();
    let finished = false;
    const cleanup = async () => {
      if (finished) return;
      finished = true;
      processor.onaudioprocess = null;
      source.disconnect(); processor.disconnect(); silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context?.close();
    };
    return {
      stop: async () => {
        await cleanup();
        const samples = resample(chunks, context!.sampleRate);
        return { samples, sampleRate: OUTPUT_RATE, wav: encodeWav(samples) };
      },
      cancel: cleanup,
    };
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    await context?.close();
    throw error;
  }
}
