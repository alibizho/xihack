import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { ApiRequestError } from "../../shared/api.ts";
import { calibrate, cancelProposal, confirmProposal, createConversation, csrf, enhanceTranscription, getRun, getRunProposals, sendMessage, withLocalContext, type Due, type Proposal } from "./agentApi";
import { startAudioCapture, type AudioCapture, type CapturedAudio } from "./audioCapture";
import { browserAsrIsReady, prepareBrowserAsr, subscribeBrowserAsr, transcribeBrowser, type BrowserAsrStatus } from "./speech/browserAsr";
import "./TaskComposer.css";

type Message = { role: "user" | "assistant"; text: string };

function dueParts(due: Due | undefined) {
  if (!due) return { date: "未指定", time: "未指定" };
  if (due.precision === "date") return { date: due.date, time: "全天" };
  const when = new Date(due.at);
  return {
    date: new Intl.DateTimeFormat("zh-CN", { timeZone: due.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when),
    time: new Intl.DateTimeFormat("zh-CN", { timeZone: due.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when),
  };
}

export function VoiceAssistant({ expanded, initialText, onOpen, onClose, onSessionExpired, onTasksChanged, onTaskCompleted }: { expanded: boolean; initialText: string; onOpen: () => void; onClose: () => void; onSessionExpired: () => void; onTasksChanged: () => void; onTaskCompleted: (taskId: string) => void }) {
  const orbButton = useRef<HTMLButtonElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const capture = useRef<AudioCapture | null>(null);
  const lastAudio = useRef<{ wav: Blob; prefix: string } | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const active = useRef(true);
  const sessionId = useRef(0);
  const conversationId = useRef("");
  const conversationRequestId = useRef(crypto.randomUUID());
  const pendingMessage = useRef({ content: "", payload: "", id: "", shown: false });
  const inputRef = useRef("");
  const openedFromButton = useRef(false);
  const confirmKeys = useRef(new Map<string, string>());
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [clarification, setClarification] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [listening, setListening] = useState(false);
  const [asrStatus, setAsrStatus] = useState<BrowserAsrStatus>({ state: "uninitialized" });
  const [usingFallback, setUsingFallback] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeBrowserAsr(setAsrStatus);
    void prepareBrowserAsr().catch(() => undefined);
    return () => { unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!expanded) return;
    active.current = true;
    const fromButton = openedFromButton.current;
    openedFromButton.current = false;
    const session = fromButton ? sessionId.current : ++sessionId.current;
    if (initialText) {
      inputRef.current = initialText;
      setInput(initialText);
    } else if (!fromButton) void record(session);
    const stop = () => { if (document.hidden) { clearRecordingTimer(); const current = capture.current; capture.current = null; if (current) void current.cancel(); setListening(false); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("keydown", escape);
    return () => {
      active.current = false;
      sessionId.current++;
      clearRecordingTimer();
      const current = capture.current;
      capture.current = null;
      if (current) void current.cancel();
      setPreparing(false);
      setListening(false);
      setBusy(false);
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  function close() { orbButton.current?.focus(); onClose(); }

  useEffect(() => { messageEnd.current?.scrollIntoView({ block: "nearest" }); }, [messages, input, busy]);

  function openAndRecord() {
    active.current = true;
    openedFromButton.current = true;
    const session = ++sessionId.current;
    onOpen();
    void record(session);
  }

  function toggleRecord() {
    if (capture.current) void finishRecording(sessionId.current);
    else void record(sessionId.current);
  }

  function clearRecordingTimer() {
    if (recordingTimer.current !== null) window.clearTimeout(recordingTimer.current);
    recordingTimer.current = null;
  }

  async function record(session = sessionId.current) {
    if (capture.current) return;
    setPreparing(true);
    setError("");
    try {
      const started = await startAudioCapture();
      if (!active.current || session !== sessionId.current) { await started.cancel(); return; }
      capture.current = started;
      setListening(true);
      recordingTimer.current = window.setTimeout(() => void finishRecording(session), 18_000);
    } catch (reason) {
      if (active.current && session === sessionId.current) setError((reason as Error).message || "无法开始录音，请改用文字输入");
    } finally { if (active.current && session === sessionId.current) setPreparing(false); }
  }

  async function finishRecording(session: number) {
    const current = capture.current;
    if (!current) return;
    capture.current = null;
    clearRecordingTimer();
    setListening(false);
    setPreparing(true);
    try {
      const audio = await current.stop();
      const prefix = inputRef.current.trim();
      lastAudio.current = { wav: audio.wav, prefix };
      let transcript = "";
      let useServer = !browserAsrIsReady();
      if (!useServer) {
        try {
          transcript = await transcribeBrowser(audio.samples);
          useServer = isUncertainTranscript(transcript, audio);
        } catch { useServer = true; }
      }
      let draft;
      if (useServer) {
        setUsingFallback(true);
        draft = await enhanceTranscription(audio.wav, await csrf());
      } else {
        draft = await calibrate(transcript, await csrf());
      }
      if (!active.current || session !== sessionId.current) return;
      const text = `${prefix} ${draft.draft_text}`.trim();
      inputRef.current = text;
      setInput(text);
      setClarification(draft.needs_clarification ? draft.clarification || "请检查识别结果" : "");
    } catch (reason) {
      if (!active.current || session !== sessionId.current) return;
      if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
      else setError((reason as Error).message || "转写失败，请重试或使用文字输入");
    } finally { if (active.current && session === sessionId.current) { setPreparing(false); setUsingFallback(false); } }
  }

  function isUncertainTranscript(text: string, audio: CapturedAudio) {
    const normalized = text.replace(/[\s\p{P}\p{S}]/gu, "");
    const seconds = audio.samples.length / audio.sampleRate;
    return !normalized || (seconds > 2 && normalized.length < 2) || /(.)\1{5,}/u.test(normalized);
  }

  async function retryEnhancedTranscription() {
    const saved = lastAudio.current;
    const session = sessionId.current;
    if (!saved || preparing || busy) return;
    setPreparing(true);
    setUsingFallback(true);
    setError("");
    try {
      const draft = await enhanceTranscription(saved.wav, await csrf());
      if (!active.current || session !== sessionId.current) return;
      const text = `${saved.prefix} ${draft.draft_text}`.trim();
      inputRef.current = text;
      setInput(text);
      setClarification(draft.needs_clarification ? draft.clarification || "请检查识别结果" : "");
    } catch (reason) {
      if (!active.current || session !== sessionId.current) return;
      if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
      else setError((reason as Error).message || "增强识别失败，请重试");
    } finally { if (active.current && session === sessionId.current) { setPreparing(false); setUsingFallback(false); } }
  }

  async function send() {
    const session = sessionId.current;
    const content = inputRef.current.trim();
    if (!content) { setError("请先说出或输入内容"); return; }
    if (content.length > 8000) { setError("内容不能超过 8000 字"); return; }
    setBusy(true);
    setError("");
    try {
      const token = await csrf();
      if (session !== sessionId.current) return;
      if (!conversationId.current) {
        const conversation = await createConversation(token, conversationRequestId.current);
        conversationId.current = conversation.conversation_id;
      }
      if (session !== sessionId.current) return;
      if (pendingMessage.current.content !== content) pendingMessage.current = { content, payload: withLocalContext(content), id: crypto.randomUUID(), shown: false };
      const { run_id } = await sendMessage(conversationId.current, pendingMessage.current.payload, pendingMessage.current.id, token);
      if (session !== sessionId.current) return;
      if (!pendingMessage.current.shown) {
        setMessages((current) => [...current, { role: "user", text: content }]);
        pendingMessage.current.shown = true;
      }
      setInput("");
      inputRef.current = "";
      lastAudio.current = null;
      setClarification("");
      for (let attempt = 0; attempt < 120 && active.current && session === sessionId.current; attempt++) {
        const run = await getRun(run_id);
        if (session !== sessionId.current) return;
        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
          const found = await getRunProposals(run_id);
          setProposals((current) => [...current, ...found]);
        }
        if (run.status === "completed") {
          pendingMessage.current = { content: "", payload: "", id: "", shown: false };
          setMessages((current) => [...current, { role: "assistant", text: run.assistant_content || "助手没有返回文字" }]);
          return;
        }
        if (run.status === "failed" || run.status === "cancelled") {
          pendingMessage.current = { content: "", payload: "", id: "", shown: false };
          throw new Error(`助手处理失败${run.error_code ? ` (${run.error_code})` : ""}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (active.current && session === sessionId.current) throw new Error("等待回复超时，请稍后重试");
    } catch (reason) {
      if (active.current && session === sessionId.current) {
        if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
        else { inputRef.current = content; setInput(content); setError((reason as Error).message); }
      }
    } finally { if (active.current && session === sessionId.current) setBusy(false); }
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
        if (proposal.operation === "complete" && proposal.task_id) onTaskCompleted(proposal.task_id);
      } else await cancelProposal(proposal.proposal_id, token);
      setProposals((current) => current.map((item) => item.proposal_id === proposal.proposal_id ? { ...item, status: accept ? "confirmed" : "cancelled" } : item));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <div className={`voice-capture ${expanded ? "is-open" : ""}`}>
    {expanded && <button className="voice-close" type="button" onClick={close} aria-label="收起语音助理"><Icon name="close" size={18} /></button>}
    <button ref={orbButton} type="button" className="orb-button" onClick={expanded ? toggleRecord : openAndRecord} disabled={expanded && (busy || preparing)} aria-expanded={expanded} aria-label={expanded ? listening ? "结束录音并转写" : "开始录音" : "打开语音助理并开始录音"}>
      <span className={`voice-orb ${expanded ? "voice-orb-active" : ""} ${preparing || listening ? "voice-orb-listening" : ""}`}><Icon name="mic" size={31} /></span>
      <strong id="capture-title">{expanded ? listening ? "正在录音 · 点按结束" : preparing ? usingFallback ? "正在使用增强识别…" : "正在本地识别…" : "点按麦克风继续说" : "点按，问助理一件事"}</strong>
    </button>
    <div className="voice-capture-expanded" inert={!expanded} aria-hidden={!expanded}><div className="voice-capture-expanded-inner">
    {asrStatus.state === "loading" && !preparing && <p className="voice-chat-note" role="status">{asrStatus.progress ? `正在准备本地语音识别… ${asrStatus.progress}%` : "正在准备本地语音识别…"}</p>}
    {asrStatus.state === "unsupported" && !preparing && <p className="voice-chat-note" role="status">此浏览器将使用服务器增强识别。</p>}
    {!preparing && lastAudio.current && input && <button className="voice-chat-note voice-enhance" type="button" onClick={() => void retryEnhancedTranscription()}>识别不准确？使用增强识别</button>}
    {(messages.length > 0 || proposals.length > 0) && <div className="voice-chat-messages" aria-live="polite" aria-relevant="additions text">
      {messages.map((message, index) => <p key={index} className={`voice-chat-bubble ${message.role}`}>{message.text}</p>)}
      {proposals.map((proposal, index) => {
        const task = proposal.task || proposal.changes;
        const due = dueParts(task?.due);
        return <article className="voice-proposal" key={proposal.proposal_id}>
          <strong>提案 {index + 1} · {proposal.operation === "create" ? "新建事务" : proposal.operation === "complete" ? "完成事务" : proposal.operation === "delete" ? "删除事务" : "修改事务"}</strong>
          <p className="voice-proposal-title">{task?.title || proposal.task_id}</p>
          {task?.description && <p className="voice-proposal-description">{task.description}</p>}
          {task && <dl className="voice-proposal-details">
            {(proposal.operation === "create" || task.due !== undefined) && <><dt>日期</dt><dd>{due.date}</dd><dt>时间</dt><dd>{due.time}</dd></>}
            {(proposal.operation === "create" || task.category !== undefined) && <><dt>分类</dt><dd>{task.category || "未分类"}</dd></>}
            {typeof task.importance === "number" && <><dt>重要度</dt><dd>{task.importance.toFixed(1)} / 10</dd></>}
            {typeof task.urgency === "number" && <><dt>紧急度</dt><dd>{task.urgency.toFixed(1)} / 10</dd></>}
          </dl>}
          {proposal.status === "pending" ? <div className="voice-proposal-actions"><button type="button" disabled={busy} onClick={() => void decide(proposal, false)}>取消</button><button type="button" disabled={busy} onClick={() => void decide(proposal, true)}>确认写入</button></div> : <small>{proposal.status === "confirmed" ? "已确认" : "已取消"}</small>}
        </article>;
      })}
      <div ref={messageEnd} />
    </div>}
    <form className="voice-capture-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <label className="field-label" htmlFor="voice-input">对话内容（可修改）</label>
    <textarea id="voice-input" rows={2} maxLength={8000} value={input} readOnly={listening} onChange={(event) => { inputRef.current = event.target.value; setInput(event.target.value); setClarification(""); }} placeholder="说出或输入你想问的事" />
    {clarification && <p className="voice-chat-note" role="status">{clarification}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" type="submit" disabled={busy || listening || preparing || !input.trim()}>{busy ? "正在处理…" : "发送给助理"}</button>
    </form>
    <p className="composer-footnote">事务变更仍需逐项确认。也可以问「我该先做哪件事？」</p>
    </div></div>
  </div>;
}
