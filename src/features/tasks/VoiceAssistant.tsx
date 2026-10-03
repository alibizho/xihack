import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { ApiRequestError } from "../../shared/api.ts";
import { calibrate as calibrateSpeech, cancelProposal, confirmProposal, createConversation, csrf, getRun, getRunProposals, sendMessage, withLocalContext, type Due, type Proposal } from "./agentApi";
import { fill, speechLang, t, uiLocale } from "../../shared/i18n.ts";
import "./TaskComposer.css";

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionClass = {
  new (): Recognition;
};
type Message = { role: "user" | "assistant"; text: string };

function dueParts(due: Due | undefined) {
  if (!due) return { date: t("dateUnset"), time: t("dateUnset") };
  if (due.precision === "date") return { date: due.date, time: t("allDay") };
  const when = new Date(due.at);
  return {
    date: new Intl.DateTimeFormat(uiLocale(), { timeZone: due.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when),
    time: new Intl.DateTimeFormat(uiLocale(), { timeZone: due.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when),
  };
}

function speechRecognition(): RecognitionClass | undefined {
  const browser = window as Window & { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return browser.SpeechRecognition || browser.webkitSpeechRecognition;
}

export type GuestQuota = { left: number; spend: () => boolean };

export function VoiceAssistant({ expanded, initialText, guestQuota, onOpen, onClose, onSessionExpired, onTasksChanged, onTaskCompleted }: { expanded: boolean; initialText: string; guestQuota?: GuestQuota; onOpen: () => void; onClose: () => void; onSessionExpired: () => void; onTasksChanged: () => void; onTaskCompleted: (taskId: string) => void }) {
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
  const openedFromButton = useRef(false);
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
    const fromButton = openedFromButton.current;
    openedFromButton.current = false;
    const session = fromButton ? sessionId.current : ++sessionId.current;
    if (initialText) {
      inputRef.current = initialText;
      setInput(initialText);
      void send();
    } else if (!fromButton) record(session);
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
      if (current) { current.onresult = null; current.onerror = null; current.onstart = null; current.onend = null; current.stop(); }
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
        setClarification(draft.needs_clarification ? draft.clarification || t("checkTranscript") : "");
      }
    } catch (reason) {
      if (!active.current || requestId !== calibrationId.current) return;
      if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
      else setError((reason as Error).message);
    } finally { if (active.current && requestId === calibrationId.current) setCalibrating(false); }
  }

  function openAndRecord() {
    active.current = true;
    openedFromButton.current = true;
    const session = ++sessionId.current;
    onOpen();
    record(session);
  }

  function toggleRecord() {
    if (!keepListening.current) { record(sessionId.current); return; }
    keepListening.current = false;
    sendOnEnd.current = true;
    setPreparing(true);
    if (recognition.current) recognition.current.stop();
    else { sendOnEnd.current = false; setPreparing(false); void calibrationTask.current.then(() => send()); }
  }

  function record(session = sessionId.current) {
    if (recognition.current) return;
    const SpeechRecognition = speechRecognition();
    if (!SpeechRecognition) { setError(t("errNoSpeechApi")); return; }
    setPreparing(true);
    setError("");
    let started = false;
    try {
      if (!active.current || session !== sessionId.current) return;
      const next = new SpeechRecognition();
      next.lang = speechLang(); // ponytail: follows the UI language; add a separate selector if mixed-language input matters
      next.continuous = true;
      next.interimResults = true;
      recognitionBase.current = inputRef.current.trim() ? `${inputRef.current.trim()} ` : "";
      lastFinalText.current = "";
      sendOnEnd.current = false;
      keepListening.current = true;
      next.onstart = () => { if (active.current && session === sessionId.current) { setPreparing(false); setListening(true); } };
      next.onresult = (event) => {
        if (!active.current || session !== sessionId.current) return;
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
        if (!active.current || session !== sessionId.current) return;
        setPreparing(false);
        if (event.error === "aborted" && !keepListening.current) return;
        keepListening.current = false;
        sendOnEnd.current = false;
        setError(event.error === "not-allowed" ? t("errMicDenied") : event.error === "no-speech" ? t("errNoSpeech") : event.error === "network" ? t("errSpeechNetwork") : t("errRecogFailed"));
      };
      next.onend = () => {
        if (!active.current || session !== sessionId.current) return;
        recognition.current = null;
        setPreparing(false);
        setListening(false);
        if (sendOnEnd.current) {
          sendOnEnd.current = false;
          void calibrationTask.current.then(() => send());
        } else if (keepListening.current && !document.hidden) window.setTimeout(() => { if (active.current && session === sessionId.current && keepListening.current && !recognition.current) record(session); }, 150);
      };
      recognition.current = next;
      next.start();
      started = true;
    } catch (reason) {
      recognition.current = null;
      keepListening.current = false;
      if (active.current && session === sessionId.current) setError((reason as Error).message || t("errRecordFailed"));
    } finally { if (!started && active.current && session === sessionId.current) setPreparing(false); }
  }

  async function send() {
    const session = sessionId.current;
    const content = inputRef.current.trim();
    if (!content) { setError(t("errEmptyInput")); return; }
    if (content.length > 8000) { setError(t("errTooLong")); return; }
    if (guestQuota && guestQuota.left <= 0) { setError(t("errGuestQuota")); return; }
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
      if (guestQuota) guestQuota.spend();
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
          setMessages((current) => [...current, { role: "assistant", text: run.assistant_content || t("errNoReply") }]);
          return;
        }
        if (run.status === "failed" || run.status === "cancelled") {
          pendingMessage.current = { content: "", payload: "", id: "", shown: false };
          throw new Error(`${t("errRunFailed")}${run.error_code ? ` (${run.error_code})` : ""}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (active.current && session === sessionId.current) throw new Error(t("errTimeout"));
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
    {expanded && <button className="voice-close" type="button" onClick={close} aria-label={t("collapseAria")}><Icon name="close" size={18} /></button>}
    <button ref={orbButton} type="button" className="orb-button" onClick={expanded ? toggleRecord : openAndRecord} disabled={expanded && (busy || preparing)} aria-expanded={expanded} aria-label={expanded ? listening || keepListening.current ? t("stopSendAria") : t("recordAgainAria") : t("micAsk")}>
      <span className={`voice-orb ${expanded ? "voice-orb-active" : ""} ${preparing || listening ? "voice-orb-listening" : ""}`}><Icon name="mic" size={31} /></span>
      <strong id="capture-title">{expanded ? preparing ? t("micOpening") : listening || keepListening.current ? t("micListening") : t("micTapMore") : t("micAsk")}</strong>
    </button>
    <div className="voice-capture-expanded" inert={!expanded} aria-hidden={!expanded}><div className="voice-capture-expanded-inner">
    {(messages.length > 0 || proposals.length > 0) && <div className="voice-chat-messages" aria-live="polite" aria-relevant="additions text">
      {messages.map((message, index) => <p key={index} className={`voice-chat-bubble ${message.role}`}>{message.text}</p>)}
      {proposals.map((proposal, index) => {
        const task = proposal.task || proposal.changes;
        const due = dueParts(task?.due);
        return <article className="voice-proposal" key={proposal.proposal_id}>
          <strong>{t("proposalLabel")} {index + 1} · {proposal.operation === "create" ? t("opCreate") : proposal.operation === "complete" ? t("opComplete") : proposal.operation === "delete" ? t("opDelete") : t("opUpdate")}</strong>
          <p className="voice-proposal-title">{task?.title || proposal.task_id}</p>
          {task?.description && <p className="voice-proposal-description">{task.description}</p>}
          {task && <dl className="voice-proposal-details">
            {(proposal.operation === "create" || task.due !== undefined) && <><dt>{t("dateLabel")}</dt><dd>{due.date}</dd><dt>{t("timeLabel")}</dt><dd>{due.time}</dd></>}
            {(proposal.operation === "create" || task.category !== undefined) && <><dt>{t("categoryLabel")}</dt><dd>{task.category || t("uncategorized")}</dd></>}
            {typeof task.importance === "number" && <><dt>{t("importanceLabel")}</dt><dd>{task.importance.toFixed(1)} / 10</dd></>}
            {typeof task.urgency === "number" && <><dt>{t("urgencyLabel")}</dt><dd>{task.urgency.toFixed(1)} / 10</dd></>}
          </dl>}
          {proposal.status === "pending" ? <div className="voice-proposal-actions"><button type="button" disabled={busy} onClick={() => void decide(proposal, false)}>{t("cancel")}</button><button type="button" disabled={busy} onClick={() => void decide(proposal, true)}>{t("confirmWrite")}</button></div> : <small>{proposal.status === "confirmed" ? t("confirmedLabel") : t("cancelledLabel")}</small>}
        </article>;
      })}
      <div ref={messageEnd} />
    </div>}
    <form className="voice-capture-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
    <label className="field-label" htmlFor="voice-input">{t("chatLabel")}</label>
    <textarea id="voice-input" rows={2} maxLength={8000} value={input} readOnly={listening} onChange={(event) => { calibrationId.current++; setCalibrating(false); inputRef.current = event.target.value; setInput(event.target.value); setClarification(""); }} placeholder={t("chatPlaceholder")} />
    {clarification && <p className="voice-chat-note" role="status">{clarification}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" type="submit" disabled={busy || listening || preparing || calibrating || !input.trim()}>{busy ? t("processing") : t("sendAria")}</button>
    </form>
    {guestQuota
      ? <p className="composer-footnote">{fill("guestVoiceNote", { n: guestQuota.left })}</p>
      : <p className="composer-footnote">{t("confirmNote")}</p>}
    </div></div>
  </div>;
}
