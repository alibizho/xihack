import type { IncomingMessage, ServerResponse } from "node:http";
import { trainingReviewRequest } from "./trainingReviewAgent.ts";

type Env = { MIMO_API_KEY?: string; MIMO_BASE_URL?: string };
type RoundInput = { difficulty: "beginner" | "normal" | "advanced"; seconds: number; mistakes: number; taps: number[] };
type Feedback = { observation: string; suggestion: string };

const MAX_BODY_BYTES = 4096;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 8;
const calls = new Map<string, { count: number; resetAt: number }>();

function reply(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function clientAddress(request: IncomingMessage): string {
  const localProxy = process.env.TRUST_PROXY === "true" || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress || "");
  const forwarded = localProxy ? request.headers["x-real-ip"] : undefined;
  return (typeof forwarded === "string" && forwarded) || request.socket.remoteAddress || "unknown";
}

function rateLimited(address: string): boolean {
  const now = Date.now();
  for (const [key, value] of calls) if (value.resetAt <= now) calls.delete(key);
  const current = calls.get(address);
  if (!current) { calls.set(address, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  current.count += 1;
  return current.count > MAX_REQUESTS_PER_WINDOW;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error("too_large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function validRound(value: unknown): value is RoundInput {
  if (!value || typeof value !== "object") return false;
  const round = value as Partial<RoundInput>;
  if (!["beginner", "normal", "advanced"].includes(round.difficulty || "")) return false;
  if (typeof round.seconds !== "number" || !Number.isFinite(round.seconds) || round.seconds <= 0 || round.seconds > 1200) return false;
  if (!Number.isInteger(round.mistakes) || (round.mistakes as number) < 0 || (round.mistakes as number) > 500) return false;
  if (!Array.isArray(round.taps) || round.taps.length !== 25) return false;
  let previous = 0;
  for (const time of round.taps) {
    if (typeof time !== "number" || !Number.isFinite(time) || time <= previous || time > round.seconds + 0.01) return false;
    previous = time;
  }
  return Math.abs(previous - round.seconds) < 0.01;
}

function validFeedback(value: unknown): value is Feedback {
  if (!value || typeof value !== "object") return false;
  const feedback = value as Partial<Feedback>;
  const clean = (text: unknown, max: number) => typeof text === "string" && text.trim().length >= 4 && text.length <= max && !/[<>]/.test(text);
  if (!clean(feedback.observation, 160) || !clean(feedback.suggestion, 160)) return false;
  return !/(多动症|ADHD|注意力缺陷|智商|诊断|疾病)/i.test(`${feedback.observation} ${feedback.suggestion}`);
}

export async function handleTrainingFeedback(request: IncomingMessage, response: ServerResponse, env: Env = process.env) {
  if (request.method !== "POST") { reply(response, 405, { error: "仅支持 POST 请求" }); return; }
  if (!request.headers["content-type"]?.startsWith("application/json")) { reply(response, 415, { error: "请发送 JSON 数据" }); return; }
  if (rateLimited(clientAddress(request))) { reply(response, 429, { error: "请求过于频繁，请稍后再试" }); return; }

  let input: unknown;
  try { input = await readBody(request); }
  catch { reply(response, 400, { error: "训练数据格式有误" }); return; }
  if (!validRound(input)) { reply(response, 400, { error: "训练数据不完整" }); return; }

  const key = env.MIMO_API_KEY?.trim();
  if (!key) { reply(response, 503, { error: "AI 服务尚未配置密钥，本局成绩已保存" }); return; }

  const baseUrl = env.MIMO_BASE_URL?.trim() || "https://api.xiaomimimo.com/v1";
  let endpoint: URL;
  try {
    endpoint = new URL(`${baseUrl.replace(/\/$/, "")}/chat/completions`);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "127.0.0.1" && endpoint.hostname !== "localhost") throw new Error("bad url");
  } catch { reply(response, 503, { error: "AI 服务地址配置有误" }); return; }

  try {
    const body = JSON.stringify(trainingReviewRequest(input));
    const signal = AbortSignal.timeout(60_000);
    let upstream: Response | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      upstream = await fetch(endpoint, {
        method: "POST",
        headers: { "api-key": key, "Content-Type": "application/json" },
        body,
        signal,
      });
      if ((upstream.status !== 429 && upstream.status !== 503) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!upstream) throw new Error("no_response");
    if (!upstream.ok) {
      console.error("MiMo training feedback failed:", upstream.status);
      reply(response, upstream.status === 429 || upstream.status === 503 ? 503 : 502, {
        error: upstream.status === 429 || upstream.status === 503 ? "AI 当前较忙，本局成绩已保存，请稍后重试" : "AI 暂时无法生成复盘，本局成绩已保存",
      });
      return;
    }
    const result = await upstream.json() as { choices?: { message?: { content?: string } }[] };
    const content = result.choices?.[0]?.message?.content;
    const parsed = typeof content === "string" ? JSON.parse(content) as unknown : null;
    if (!validFeedback(parsed)) throw new Error("invalid_feedback");
    reply(response, 200, { observation: parsed.observation.trim(), suggestion: parsed.suggestion.trim() });
  } catch (error) {
    console.error("MiMo training feedback error:", error instanceof Error ? error.message : "unknown");
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    reply(response, timeout ? 504 : 502, {
      error: timeout ? "AI 响应超时，本局成绩已保存，请稍后重试" : "AI 暂时无法生成复盘，本局成绩已保存",
    });
  }
}
