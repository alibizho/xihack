import { env, pipeline } from "@huggingface/transformers";

const MODEL = "onnx-community/whisper-tiny";
const REVISION = "ff4177021cc41f7db950912b73ea4fdf7d01d8e7";
let transcriber: Awaited<ReturnType<typeof pipeline<"automatic-speech-recognition">>> | null = null;
let loading: Promise<void> | null = null;

type Request = { id: number; type: "prepare" } | { id: number; type: "transcribe"; samples: Float32Array };

async function prepare(id: number) {
  if (transcriber) { self.postMessage({ id, type: "ready" }); return; }
  if (!loading) {
    loading = (async () => {
      env.useBrowserCache = true;
      transcriber = await pipeline("automatic-speech-recognition", MODEL, {
        device: "webgpu",
        dtype: "q8",
        revision: REVISION,
        progress_callback: (progress) => self.postMessage({ id, type: "progress", progress }),
      });
    })().finally(() => { loading = null; });
  }
  await loading;
  self.postMessage({ id, type: "ready" });
}

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if (data.type === "prepare") return await prepare(data.id);
    await prepare(data.id);
    const result = await transcriber!(data.samples);
    self.postMessage({ id: data.id, type: "result", text: result.text });
  } catch (error) {
    self.postMessage({ id: data.id, type: "error", message: error instanceof Error ? error.message : "浏览器语音识别失败" });
  }
};
