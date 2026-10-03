import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { ApiRequestError } from "../../shared/api.ts";
import { calibrate as calibrateSpeech, cancelProposal, confirmProposal, createConversation, csrf, getRun, getRunProposals, sendMessage, withLocalContext, type Due, type Proposal } from "./agentApi";
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

function dueLabel(due: Due | undefined) {
  if (!due) return "未指定";
  if (due.precision === "date") return `${due.date}（全天）`;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: due.timezone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(due.at));
}

function localRecognition(): RecognitionClass | undefined {
  const browser = window as Window & { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  const recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
  return recognition?.available && recognition.install ? recognition : undefined;
}

export function VoiceAssistant({ expanded, onOpen, onClose, onSessionExpired, onTasksChanged, onTaskCompleted }: { expanded: boolean; onOpen: () => void; onClose: () => void; onSessionExpired: () => void; onTasksChanged: () => void; onTaskCompleted: (taskId: string) => void }) {
  const orbButton = useRef<HTMLButtonElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const recognition = useRef<Recognition | null>(null);
  const keepListening = useRef(false);
  const active = useRef(true);
  const sessionId = useRef(0);
  const conversationId = useRef("");
  const conversationRequestId = useRef(crypto.randomUUID());
  const pendingMessage = useRef({ content: "", payload: "", id: "", shown: false });
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
    if (!expanded) return;
    active.current = true;
    const session = ++sessionId.current;
    void record(session);
    const stop = () => { if (document.hidden) { keepListening.current = false; sendOnEnd.current = false; recognition.current?.stop(); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("visibilitychange", stop);
    document.addEventListener("keydown", escape);
    return () => {
      active.current = false;
      sessionId.current++;
      calibrationId.current++;
      keepListening.current = false;
      sendOnEnd.current = false;
      const current = recognition.current;
      recognition.current = null;
      if (current) { current.onresult = null; current.onerror = null; current.onend = null; current.stop(); }
      setPreparing(false);
      setListening(false);
      setCalibrating(false);
      setBusy(false);
      document.removeEventListener("visibilitychange", stop);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  function close() { orbButton.current?.focus(); onClose(); }

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

  async function record(session = sessionId.current) {
    if (recognition.current) { keepListening.current = false; sendOnEnd.current = true; recognition.current.stop(); return; }
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
      if (!active.current || session !== sessionId.current) return;
      const next = new SpeechRecognition();
      next.lang = "zh-CN";
      next.processLocally = true;
      next.continuous = true;
      next.interimResults = true;
      recognitionBase.current = inputRef.current.trim() ? `${inputRef.current.trim()} ` : "";
      lastFinalText.current = "";
      sendOnEnd.current = false;
      keepListening.current = true;
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
      next.onerror = (event) => {
        if (event.error === "no-speech" || (event.error === "aborted" && !keepListening.current)) return;
        keepListening.current = false;
        if (active.current) setError(event.error === "not-allowed" ? "请允许麦克风权限，或改用文字输入" : "识别失败，请重试或改用文字输入");
      };
      next.onend = () => {
        recognition.current = null;
        if (!active.current) return;
        setListening(false);
        if (sendOnEnd.current) {
          sendOnEnd.current = false;
          void calibrationTask.current.then(() => send());
        } else if (keepListening.current && !document.hidden) void record(session);
      };
      recognition.current = next;
      next.start();
      setListening(true);
    } catch (reason) {
      recognition.current = null;
      keepListening.current = false;
      if (active.current && session === sessionId.current) setError((reason as Error).message || "无法开始录音，请改用文字输入");
    } finally { if (active.current && session === sessionId.current) setPreparing(false); }
  }

  async function send() {
    const session = sessionId.current;
    const content = inputRef.current.trim();
    if (!content) { setError("请先说出或输入内容"); return; }
    if (content.length > 8000) { setError("内容不能超过 8000 字"); return; }
    setBusy(true);
    setError("");
    calibrationId.current++;
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
    <button ref={orbButton} type="button" className="orb-button" onClick={expanded ? () => void record() : onOpen} disabled={expanded && (busy || preparing)} aria-expanded={expanded} aria-label={expanded ? listening ? "结束录音并发送" : "再次开始录音" : "打开语音助理并开始聆听"}>
      <span className={`voice-orb ${expanded ? "voice-orb-active" : ""} ${preparing || listening ? "voice-orb-listening" : ""}`}><Icon name="mic" size={31} /></span>
      <strong id="capture-title">{expanded ? preparing ? "正在开启麦克风…" : listening ? "正在聆听 · 点按结束" : "点按麦克风继续说" : "点按，问助理一件事"}</strong>
    </button>
    <div className="voice-capture-expanded" inert={!expanded} aria-hidden={!expanded}><div className="voice-capture-expanded-inner">
    {(messages.length > 0 || proposals.length > 0) && <div className="voice-chat-messages" aria-live="polite" aria-relevant="additions text">
      {messages.map((message, index) => <p key={index} className={`voice-chat-bubble ${message.role}`}>{message.text}</p>)}
      {proposals.map((proposal, index) => {
        const task = proposal.task || proposal.changes;
        return <article className="voice-proposal" key={proposal.proposal_id}>
          <strong>提案 {index + 1} · {proposal.operation === "create" ? "新建事务" : proposal.operation === "complete" ? "完成事务" : proposal.operation === "delete" ? "删除事务" : "修改事务"}</strong>
          <p className="voice-proposal-title">{task?.title || proposal.task_id}</p>
          {task?.description && <p className="voice-proposal-description">{task.description}</p>}
          {task && <dl className="voice-proposal-details">
            {(proposal.operation === "create" || task.due !== undefined) && <><dt>截止</dt><dd>{dueLabel(task.due)}</dd></>}
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
    <label className="field-label" htmlFor="voice-input">识别到的文字（可修改）</label>
    <textarea id="voice-input" rows={2} maxLength={8000} value={input} readOnly={listening} onChange={(event) => { calibrationId.current++; setCalibrating(false); inputRef.current = event.target.value; setInput(event.target.value); setClarification(""); }} placeholder="说出或输入你想问的事" />
    {clarification && <p className="voice-chat-note" role="status">{clarification}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" type="submit" disabled={busy || listening || preparing || calibrating || !input.trim()}>{busy ? "正在处理…" : "发送给助理"}</button>
    </form>
    <p className="composer-footnote">事务变更仍需逐项确认。也可以问「我该先做哪件事？」</p>
    </div></div>
  </div>;
}
