import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { ApiRequestError, api, post } from "../../shared/api.ts";
import "./TaskComposer.css";

type Recognition = {
  lang: string;
  processLocally: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionClass = {
  new (): Recognition;
  available?: (options: { langs: string[]; processLocally: true }) => Promise<string>;
  install?: (options: { langs: string[]; processLocally: true }) => Promise<boolean>;
};
type Run = {
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  assistant_content: string | null;
  error_code: string | null;
};

function localRecognition(): RecognitionClass | undefined {
  const browser = window as Window & { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  const recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  return recognition?.available && recognition.install ? recognition : undefined;
}

export function VoiceAssistant({ username, onClose, onSessionExpired }: { username: string; onClose: () => void; onSessionExpired: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const active = useRef(true);
  const conversationId = useRef("");
  const conversationRequestId = useRef(crypto.randomUUID());
  const pendingMessage = useRef({ content: "", id: "" });
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    const stop = () => { if (document.hidden) recognition.current?.stop(); };
    document.addEventListener("visibilitychange", stop);
    return () => {
      active.current = false;
      recognition.current?.stop();
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);

  async function record() {
    if (recognition.current) { recognition.current.stop(); return; }
    const SpeechRecognition = localRecognition();
    if (!SpeechRecognition) { setError("此浏览器不支持本地语音识别，请改用文字输入"); return; }
    setBusy(true);
    setPreparing(true);
    setError("");
    try {
      const options = { langs: ["zh-CN"], processLocally: true as const };
      const state = await SpeechRecognition.available!(options);
      if (state === "downloadable" || state === "downloading") {
        if (!await SpeechRecognition.install!(options)) throw new Error("中文语音模型安装失败，请改用文字输入");
      } else if (state !== "available") throw new Error("本地中文语音识别不可用，请改用文字输入");
      if (!active.current) return;
      const next = new SpeechRecognition();
      next.lang = "zh-CN";
      next.processLocally = true;
      next.onresult = (event) => { if (active.current) setInput(event.results[0][0].transcript); };
      next.onerror = (event) => { if (active.current) setError(event.error === "not-allowed" ? "请允许麦克风权限，或改用文字输入" : "识别失败，请重试或改用文字输入"); };
      next.onend = () => { recognition.current = null; if (active.current) setListening(false); };
      recognition.current = next;
      next.start();
      setListening(true);
    } catch (reason) {
      recognition.current = null;
      setError((reason as Error).message || "无法开始录音，请改用文字输入");
    } finally { setBusy(false); setPreparing(false); }
  }

  async function send() {
    const content = input.trim();
    if (!content) { setError("请先说出或输入内容"); return; }
    if (content.length > 8000) { setError("内容不能超过 8000 字"); return; }
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const { csrf_token } = await api<{ csrf_token: string }>("/auth/csrf");
      if (!conversationId.current) {
        const conversation = await post<{ conversation_id: string }>("/conversations", { client_request_id: conversationRequestId.current, title: "语音对话" }, csrf_token);
        conversationId.current = conversation.conversation_id;
      }
      if (pendingMessage.current.content !== content) pendingMessage.current = { content, id: crypto.randomUUID() };
      const { run_id } = await post<{ run_id: string }>(`/conversations/${conversationId.current}/messages`, { client_message_id: pendingMessage.current.id, content }, csrf_token);
      for (let attempt = 0; attempt < 120 && active.current; attempt++) {
        const run = await api<Run>(`/runs/${run_id}`);
        if (run.status === "completed") { pendingMessage.current = { content: "", id: "" }; setInput(""); setAnswer(run.assistant_content || "助手没有返回文字"); return; }
        if (run.status === "failed" || run.status === "cancelled") { pendingMessage.current = { content: "", id: "" }; throw new Error(`助手处理失败${run.error_code ? ` (${run.error_code})` : ""}`); }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (active.current) throw new Error("等待回复超时，请稍后重试");
    } catch (reason) {
      if (active.current) {
        if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
        else setError((reason as Error).message);
      }
    } finally { if (active.current) setBusy(false); }
  }

  return <dialog ref={dialog} className="composer" onClose={onClose} aria-labelledby="voice-title">
    <div className="composer-head"><div><span className="section-kicker">语音助理</span><h2 id="voice-title">说出你想问的事</h2></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" /></button></div>
    <div className="voice-panel"><div className="voice-panel-top"><Icon name="mic" size={22} /><div><strong>本地语音识别</strong><p>识别结果可以修改。只有点击发送后，文字才会传给服务器。</p></div></div>
      <button className={`record-button ${listening ? "recording" : ""}`} onClick={record} disabled={busy}><Icon name="mic" size={19} />{preparing ? "准备本地模型…" : listening ? "结束录音" : "开始录音"}</button></div>
    <label className="field-label" htmlFor="voice-input">发送给助理的文字</label>
    <textarea id="voice-input" rows={3} maxLength={8000} value={input} onChange={(event) => setInput(event.target.value)} placeholder="说出或输入你想问的事" />
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" onClick={send} disabled={busy || listening}>{busy ? "等待回复…" : "发送给助理"}</button>
    {answer && <p className="voice-answer" role="status">{answer}</p>}
    <p className="composer-footnote">已登录：{username}。助理只能查询服务器里的事务；页面上的演示事务尚未同步。</p>
  </dialog>;
}
