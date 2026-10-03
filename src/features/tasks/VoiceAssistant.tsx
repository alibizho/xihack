import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { ApiRequestError } from "../../shared/api.ts";
import { calibrate as calibrateSpeech, cancelProposal, confirmProposal, createConversation, csrf, getRun, getRunProposals, sendMessage, type Proposal } from "./agentApi";
import "./TaskComposer.css";

type Recognition = {
  lang: string;
  processLocally: boolean;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
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
type Message = { role: "user" | "assistant"; text: string };

function localRecognition(): RecognitionClass | undefined {
  const browser = window as Window & { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  const recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  return recognition?.available && recognition.install ? recognition : undefined;
}

export function VoiceAssistant({ username, onClose, onSessionExpired, onTasksChanged }: { username: string; onClose: () => void; onSessionExpired: () => void; onTasksChanged: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const active = useRef(true);
  const conversationId = useRef("");
  const conversationRequestId = useRef(crypto.randomUUID());
  const pendingMessage = useRef({ content: "", id: "", shown: false });
  const calibrationId = useRef(0);
  const calibrationTask = useRef<Promise<void>>(Promise.resolve());
  const inputRef = useRef("");
  const recognitionBase = useRef("");
  const lastFinalText = useRef("");
  const sendOnEnd = useRef(false);
  const confirmKeys = useRef(new Map<string, string>());
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [clarification, setClarification] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [listening, setListening] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    void record();
    const stop = () => { if (document.hidden) { sendOnEnd.current = false; recognition.current?.stop(); } };
    document.addEventListener("visibilitychange", stop);
    return () => {
      active.current = false;
      sendOnEnd.current = false;
      recognition.current?.stop();
      document.removeEventListener("visibilitychange", stop);
    };
  }, []);

  useEffect(() => { messageEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, input, busy]);

  async function calibrate(text: string, requestId: number) {
    try {
      const draft = await calibrateSpeech(text, await csrf());
      if (active.current && requestId === calibrationId.current) {
        if (inputRef.current === text) { inputRef.current = draft.draft_text; setInput(draft.draft_text); }
        setClarification(draft.needs_clarification ? draft.clarification || "请检查识别结果" : "");
      }
    } catch (reason) {
      if (!active.current || requestId !== calibrationId.current) return;
      if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
      else setError((reason as Error).message);
    } finally { if (active.current && requestId === calibrationId.current) setCalibrating(false); }
  }

  async function record() {
    if (recognition.current) { sendOnEnd.current = true; recognition.current.stop(); return; }
    const SpeechRecognition = localRecognition();
    if (!SpeechRecognition) { setError("此浏览器不支持本地语音识别，请改用文字输入"); return; }
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
      next.continuous = true;
      next.interimResults = true;
      recognitionBase.current = inputRef.current.trim() ? `${inputRef.current.trim()} ` : "";
      lastFinalText.current = "";
      sendOnEnd.current = false;
      next.onresult = (event) => {
        if (!active.current) return;
        let final = "";
        let interim = "";
        for (let index = 0; index < event.results.length; index++) {
          const part = event.results[index];
          if (part.isFinal) final += part[0].transcript;
          else interim += part[0].transcript;
        }
        const full = `${recognitionBase.current}${final}${interim}`.trim();
        inputRef.current = full;
        setInput(full);
        if (final && final !== lastFinalText.current) {
          lastFinalText.current = final;
          const requestId = ++calibrationId.current;
          setCalibrating(true);
          calibrationTask.current = calibrate(`${recognitionBase.current}${final}`.trim(), requestId);
        }
      };
      next.onerror = (event) => { if (active.current) setError(event.error === "not-allowed" ? "请允许麦克风权限，或改用文字输入" : "识别失败，请重试或改用文字输入"); };
      next.onend = () => {
        recognition.current = null;
        if (!active.current) return;
        setListening(false);
        if (sendOnEnd.current) {
          sendOnEnd.current = false;
          void calibrationTask.current.then(() => send());
        }
      };
      recognition.current = next;
      next.start();
      setListening(true);
    } catch (reason) {
      recognition.current = null;
      if (active.current) setError((reason as Error).message || "无法开始录音，请改用文字输入");
    } finally { if (active.current) setPreparing(false); }
  }

  async function send() {
    const content = inputRef.current.trim();
    if (!content) { setError("请先说出或输入内容"); return; }
    if (content.length > 8000) { setError("内容不能超过 8000 字"); return; }
    setBusy(true);
    setError("");
    calibrationId.current++;
    try {
      const token = await csrf();
      if (!conversationId.current) {
        const conversation = await createConversation(token, conversationRequestId.current);
        conversationId.current = conversation.conversation_id;
      }
      if (pendingMessage.current.content !== content) pendingMessage.current = { content, id: crypto.randomUUID(), shown: false };
      const { run_id } = await sendMessage(conversationId.current, content, pendingMessage.current.id, token);
      if (!pendingMessage.current.shown) {
        setMessages((current) => [...current, { role: "user", text: content }]);
        pendingMessage.current.shown = true;
      }
      setInput("");
      inputRef.current = "";
      setClarification("");
      for (let attempt = 0; attempt < 120 && active.current; attempt++) {
        const run = await getRun(run_id);
        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
          const found = await getRunProposals(run_id);
          setProposals((current) => [...current, ...found]);
        }
        if (run.status === "completed") {
          pendingMessage.current = { content: "", id: "", shown: false };
          setMessages((current) => [...current, { role: "assistant", text: run.assistant_content || "助手没有返回文字" }]);
          return;
        }
        if (run.status === "failed" || run.status === "cancelled") {
          pendingMessage.current = { content: "", id: "", shown: false };
          throw new Error(`助手处理失败${run.error_code ? ` (${run.error_code})` : ""}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (active.current) throw new Error("等待回复超时，请稍后重试");
    } catch (reason) {
      if (active.current) {
        if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
        else { inputRef.current = content; setInput(content); setError((reason as Error).message); }
      }
    } finally { if (active.current) setBusy(false); }
  }

  async function decide(proposal: Proposal, accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = await csrf();
      if (accept) {
        let key = confirmKeys.current.get(proposal.proposal_id);
        if (!key) { key = crypto.randomUUID(); confirmKeys.current.set(proposal.proposal_id, key); }
        await confirmProposal(proposal.proposal_id, key, token);
        onTasksChanged();
      } else await cancelProposal(proposal.proposal_id, token);
      setProposals((current) => current.map((item) => item.proposal_id === proposal.proposal_id ? { ...item, status: accept ? "confirmed" : "cancelled" } : item));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer voice-chat" onClose={onClose} aria-labelledby="voice-title">
    <div className="composer-head"><div><span className="section-kicker">语音助理</span><h2 id="voice-title">问助理一件事</h2></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" /></button></div>
    <div className="voice-chat-messages" aria-live="polite" aria-relevant="additions text">
      {messages.map((message, index) => <p key={index} className={`voice-chat-bubble ${message.role}`}>{message.text}</p>)}
      {proposals.map((proposal) => <div className="voice-proposal" key={proposal.proposal_id}><strong>{proposal.operation === "create" ? "新建事务" : proposal.operation === "complete" ? "完成事务" : proposal.operation === "delete" ? "删除事务" : "修改事务"}</strong><p>{proposal.task?.title || proposal.changes?.title || proposal.task_id}</p>{proposal.status === "pending" ? <div><button type="button" disabled={busy} onClick={() => void decide(proposal, false)}>取消</button><button type="button" disabled={busy} onClick={() => void decide(proposal, true)}>确认写入</button></div> : <small>{proposal.status === "confirmed" ? "已确认" : "已取消"}</small>}</div>)}
      {input && <p className="voice-chat-bubble user" aria-live="off">{input}</p>}
      <p className="voice-chat-bubble assistant">{preparing ? "正在准备本地语音识别…" : listening ? "正在听，请说话…" : calibrating ? "正在校准识别文字…" : busy ? "正在处理你的请求…" : "说出或输入你想问的事。"}</p>
      <div ref={messageEnd} />
    </div>
    <button className={`record-button ${listening ? "recording" : ""}`} onClick={() => void record()} disabled={busy || preparing} aria-label={listening ? "结束录音并发送" : "开始录音"}><Icon name="mic" size={19} />{preparing ? "准备中…" : listening ? "结束并发送" : "再次录音"}</button>
    <label className="field-label" htmlFor="voice-input">识别到的文字（可修改）</label>
    <textarea id="voice-input" rows={2} maxLength={8000} value={input} readOnly={listening} onChange={(event) => { calibrationId.current++; setCalibrating(false); inputRef.current = event.target.value; setInput(event.target.value); setClarification(""); }} placeholder="说出或输入你想问的事" />
    {clarification && <p className="voice-chat-note" role="status">{clarification}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" onClick={() => void send()} disabled={busy || listening || preparing || calibrating}>{busy ? "正在处理…" : "发送给助理"}</button>
    <p className="composer-footnote">已登录：{username}。录音文字发送给助理后，事务变更仍需逐项确认。也可以问「我该先做哪件事？」</p>
  </dialog>;
}
