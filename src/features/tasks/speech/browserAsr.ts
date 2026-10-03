export type BrowserAsrState = "uninitialized" | "loading" | "ready" | "unsupported" | "failed";
export type BrowserAsrStatus = { state: BrowserAsrState; progress?: number };

type Pending = { resolve: (value: string | null) => void; reject: (error: Error) => void; timer: number };

const listeners = new Set<(status: BrowserAsrStatus) => void>();
const pending = new Map<number, Pending>();
let state: BrowserAsrState = "uninitialized";
let progress: number | undefined;
let worker: Worker | null = null;
let nextId = 1;

function update(next: BrowserAsrState, value?: number) {
  state = next;
  progress = value;
  const status = { state, progress };
  listeners.forEach((listener) => listener(status));
}

function rejectPending(error: Error) {
  for (const item of pending.values()) {
    window.clearTimeout(item.timer);
    item.reject(error);
  }
  pending.clear();
}

function ensureWorker() {
  if (worker) return worker;
  if (typeof Worker === "undefined" || !("gpu" in navigator) || !window.isSecureContext) {
    update("unsupported");
    return null;
  }
  try {
    worker = new Worker(new URL("./browserAsr.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") {
        const loaded = typeof data.progress?.loaded === "number" ? data.progress.loaded : undefined;
        const total = typeof data.progress?.total === "number" && data.progress.total > 0 ? data.progress.total : undefined;
        update("loading", loaded !== undefined && total ? Math.round(loaded / total * 100) : undefined);
        return;
      }
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      window.clearTimeout(item.timer);
      if (data.type === "error") item.reject(new Error(data.message || "浏览器语音识别失败"));
      else if (data.type === "result") item.resolve(data.text);
      else item.resolve(null);
      if (data.type === "ready") update("ready");
    };
    worker.onerror = () => {
      update("failed");
      rejectPending(new Error("浏览器本地语音识别初始化失败"));
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    update("unsupported");
    return null;
  }
}

function request(type: "prepare" | "transcribe", samples?: Float32Array, timeout = 180_000): Promise<string | null> {
  const target = ensureWorker();
  if (!target) return Promise.reject(new Error("当前浏览器不支持本地语音识别"));
  const id = nextId++;
  update("loading", progress);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error("浏览器本地语音识别超时"));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    if (type === "prepare") target.postMessage({ id, type });
    else target.postMessage({ id, type, samples }, samples ? [samples.buffer] : []);
  });
}

export function subscribeBrowserAsr(listener: (status: BrowserAsrStatus) => void) {
  listeners.add(listener);
  listener({ state, progress });
  return () => listeners.delete(listener);
}

export function prepareBrowserAsr() {
  if (state === "ready") return Promise.resolve();
  return request("prepare").then(() => undefined).catch((error: Error) => {
    if (state !== "unsupported") update("failed");
    throw error;
  });
}

export async function transcribeBrowser(samples: Float32Array) {
  const text = await request("transcribe", samples.slice(), 45_000);
  return typeof text === "string" ? text.trim() : "";
}

export function browserAsrIsReady() {
  return state === "ready";
}
