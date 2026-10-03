import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { ApiRequestError } from "../../shared/api.ts";
import { fill, t, uiLocale } from "../../shared/i18n.ts";
import { calibrate, cancelProposal, confirmProposal, createConversation, csrf, enhanceTranscription, getRun, getRunProposals, sendMessage, withLocalContext, type Due, type Proposal } from "./agentApi";
import { startAudioCapture, type AudioCapture, type CapturedAudio } from "./audioCapture";
import { browserAsrIsReady, prepareBrowserAsr, transcribeBrowser } from "./speech/browserAsr";
import "./TaskComposer.css";

type Message = { role: "user" | "assistant"; text: string };
export type GuestQuota = { left: number; spend: () => boolean };

function dueParts(due: Due | undefined) {
  if (!due) return { date: t("dateUnset"), time: t("dateUnset") };
  if (due.precision === "date") return { date: due.date, time: t("allDay") };
  const when = new Date(due.at);
  return {
    date: new Intl.DateTimeFormat(uiLocale(), { timeZone: due.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(when),
    time: new Intl.DateTimeFormat(uiLocale(), { timeZone: due.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when),
  };
}

export function VoiceAssistant({ expanded, initialText, guestQuota, onOpen, onClose, onSessionExpired, onTasksChanged, onTaskCompleted }: { expanded: boolean; initialText: string; guestQuota?: GuestQuota; onOpen: () => void; onClose: () => void; onSessionExpired: () => void; onTasksChanged: () => void; onTaskCompleted: (taskId: string) => void }) {
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

  useEffect(() => {
    void prepareBrowserAsr().catch(() => undefined);
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
      void send();
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
      if (active.current && session === sessionId.current) setError((reason as Error).message || t("errRecordFailed"));
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
        draft = await enhanceTranscription(audio.wav, await csrf());
      } else {
        draft = await calibrate(transcript, await csrf());
      }
      if (!active.current || session !== sessionId.current) return;
      const text = `${prefix} ${draft.draft_text}`.trim();
      inputRef.current = text;
      setInput(text);
      setClarification(draft.needs_clarification ? draft.clarification || t("checkTranscript") : "");
    } catch (reason) {
      if (!active.current || session !== sessionId.current) return;
      if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
      else setError((reason as Error).message || t("errRecogFailed"));
    } finally { if (active.current && session === sessionId.current) setPreparing(false); }
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
    setError("");
    try {
      const draft = await enhanceTranscription(saved.wav, await csrf());
      if (!active.current || session !== sessionId.current) return;
      const text = `${saved.prefix} ${draft.draft_text}`.trim();
      inputRef.current = text;
      setInput(text);
      setClarification(draft.needs_clarification ? draft.clarification || t("checkTranscript") : "");
    } catch (reason) {
      if (!active.current || session !== sessionId.current) return;
      if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
      else setError((reason as Error).message || t("errRecogFailed"));
    } finally { if (active.current && session === sessionId.current) setPreparing(false); }
  }

  async function send() {
    const session = sessionId.current;
    const content = inputRef.current.trim();
    if (!content) { setError(t("errEmptyInput")); return; }
    if (content.length > 8000) { setError(t("errTooLong")); return; }
    if (guestQuota && guestQuota.left <= 0) { setError(t("errGuestQuota")); return; }
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
      if (guestQuota) guestQuota.spend();
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
    <button ref={orbButton} type="button" className="orb-button" onClick={expanded ? toggleRecord : openAndRecord} disabled={expanded && (busy || preparing)} aria-expanded={expanded} aria-label={expanded ? listening ? t("stopSendAria") : t("recordAgainAria") : t("micAsk")}>
      <span className={`voice-orb ${expanded ? "voice-orb-active" : ""} ${preparing || listening ? "voice-orb-listening" : ""}`}><Icon name="mic" size={31} /></span>
      <strong id="capture-title">{expanded ? listening ? t("micListening") : preparing ? t("recognizingSpeech") : t("micTapMore") : t("micAsk")}</strong>
    </button>
    <div className="voice-capture-expanded" inert={!expanded} aria-hidden={!expanded}><div className="voice-capture-expanded-inner">
    {!preparing && lastAudio.current && input && <button className="voice-chat-note voice-enhance" type="button" onClick={() => void retryEnhancedTranscription()}>{t("enhancedRecognition")}</button>}
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
    <textarea id="voice-input" rows={2} maxLength={8000} value={input} readOnly={listening} onChange={(event) => { inputRef.current = event.target.value; setInput(event.target.value); setClarification(""); }} placeholder={t("chatPlaceholder")} />
    {clarification && <p className="voice-chat-note" role="status">{clarification}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    <button className="button button-primary full-width" type="submit" disabled={busy || listening || preparing || !input.trim()}>{busy ? t("processing") : t("sendAria")}</button>
    </form>
    <p className="composer-footnote">{guestQuota ? fill("guestVoiceNote", { n: guestQuota.left }) : t("confirmNote")}</p>
    </div></div>
  </div>;
}
