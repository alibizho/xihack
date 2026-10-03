import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { Icon } from "../../shared/Icon";
import { ApiRequestError } from "../../shared/api.ts";
import { fill, getLang, t } from "../../shared/i18n.ts";
import { calibrate, cancelProposal, confirmProposal, createConversation, csrf, enhanceTranscription, getRun, getRunProposalBatches, getRunProposals, runProgressMessage, sendMessage, withLocalContext, type Proposal, type ProposalBatch, type Run } from "./agentApi";
import { startAudioCapture, type AudioCapture, type CapturedAudio } from "./audioCapture";
import { browserAsrIsReady, prepareBrowserAsr, transcribeBrowser } from "./speech/browserAsr";
import { ProposalBatchReview } from "./ProposalBatchReview";
import { ProposalCarousel } from "./ProposalCarousel";
import { RunEventCursor } from "./runEventCursor";
import "./TaskComposer.css";

type Message = { role: "user" | "assistant"; text: string };
export type GuestQuota = { left: number; spend: () => boolean };

function mergeProposals(current: Proposal[], incoming: Proposal[]) {
  const merged = new Map(current.map((proposal) => [proposal.proposal_id, proposal]));
  for (const proposal of incoming) merged.set(proposal.proposal_id, proposal);
  return [...merged.values()];
}

export function VoiceAssistant({ expanded, initialText, guestQuota, onOpen, onClose, onSessionExpired, onTasksChanged, onTaskCompleted }: { expanded: boolean; initialText: string; guestQuota?: GuestQuota; onOpen: () => void; onClose: () => void; onSessionExpired: () => void; onTasksChanged: () => void; onTaskCompleted: (taskId: string) => void }) {
  const orbButton = useRef<HTMLButtonElement>(null);
  const messageEnd = useRef<HTMLDivElement>(null);
  const proposalBatchEnd = useRef<HTMLDivElement>(null);
  const capture = useRef<AudioCapture | null>(null);
  const lastAudio = useRef<{ wav: Blob; prefix: string } | null>(null);
  const recordingTimer = useRef<number | null>(null);
  const active = useRef(true);
  const sessionId = useRef(0);
  const conversationId = useRef("");
  const conversationRequestId = useRef(crypto.randomUUID());
  const pendingMessage = useRef({ content: "", payload: "", id: "", shown: false, language: "zh" as "zh" | "en" });
  const inputRef = useRef("");
  const openedFromButton = useRef(false);
  const confirmKeys = useRef(new Map<string, string>());
  const runStream = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const cancelRunWatch = useRef<(() => void) | null>(null);
  const activeRunId = useRef("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [proposalFocusId, setProposalFocusId] = useState<string>();
  const [proposalBatches, setProposalBatches] = useState<ProposalBatch[]>([]);
  const [progress, setProgress] = useState("");
  const [liveAnswer, setLiveAnswer] = useState("");
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
    if (activeRunId.current) {
      const runId = activeRunId.current;
      setBusy(true);
      setProgress(t("runReconnecting"));
      void (async () => {
        try {
          let run = await getRun(runId);
          if (!["completed", "failed", "cancelled"].includes(run.status)) run = await watchRun(runId, session);
          else await loadRunResults(runId, session);
          if (!active.current || session !== sessionId.current) return;
          activeRunId.current = "";
          setProgress("");
          if (run.status === "completed") {
            pendingMessage.current = { content: "", payload: "", id: "", shown: false, language: getLang() };
            setMessages((current) => [...current, { role: "assistant", text: run.assistant_content || t("errNoReply") }]);
          } else setError(`${t("errRunFailed")}${run.error_code ? ` (${run.error_code})` : ""}`);
        } catch (reason) {
          if (active.current && session === sessionId.current && (reason as Error).message !== "run_watch_cancelled") setError((reason as Error).message || t("errRunFailed"));
        } finally { if (active.current && session === sessionId.current) setBusy(false); }
      })();
    } else if (initialText) {
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
      runStream.current?.close();
      runStream.current = null;
      if (reconnectTimer.current !== null) window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
      cancelRunWatch.current?.();
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
  useEffect(() => {
    if (!proposalBatches.length) return;
    proposalBatchEnd.current?.scrollIntoView({
      block: "nearest",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [proposalBatches.length]);

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

  function loadRunResults(runId: string, session: number) {
    return Promise.all([getRunProposalBatches(runId), getRunProposals(runId)]).then(([batches, proposalsFound]) => {
      if (!active.current || session !== sessionId.current) return;
      const batchProposalIds = new Set(batches.flatMap((batch) => batch.proposals.map((proposal) => proposal.proposal_id)));
      setProposalBatches((current) => [...current.filter((batch) => !batches.some((item) => item.batch_id === batch.batch_id)), ...batches]);
      const legacy = proposalsFound.filter((proposal) => !batchProposalIds.has(proposal.proposal_id));
      setProposals((current) => mergeProposals(current, legacy));
      const newestPending = [...legacy].reverse().find((proposal) => proposal.status === "pending");
      if (newestPending) setProposalFocusId(newestPending.proposal_id);
    });
  }

  function watchRun(runId: string, session: number): Promise<Run> {
    return new Promise((resolve, reject) => {
      const cursor = new RunEventCursor();
      let settled = false;
      let finishing = false;
      let stream: EventSource | null = null;
      let ownedReconnectTimer: number | null = null;
      let cancelWatch: (() => void) | null = null;
      const isCurrentSession = () => active.current && session === sessionId.current;
      const close = () => {
        const ownedStream = stream;
        stream = null;
        ownedStream?.close();
        if (runStream.current === ownedStream) runStream.current = null;
        if (ownedReconnectTimer !== null) {
          window.clearTimeout(ownedReconnectTimer);
          if (reconnectTimer.current === ownedReconnectTimer) reconnectTimer.current = null;
          ownedReconnectTimer = null;
        }
      };
      const finish = async () => {
        if (finishing || settled) return;
        if (!isCurrentSession()) {
          settled = true;
          close();
          reject(new Error("run_watch_cancelled"));
          return;
        }
        finishing = true;
        close();
        try {
          const run = await getRun(runId);
          if (isCurrentSession()) await loadRunResults(runId, session);
          settled = true;
          if (cancelRunWatch.current === cancelWatch) cancelRunWatch.current = null;
          resolve(run);
        } catch (reason) {
          settled = true;
          if (cancelRunWatch.current === cancelWatch) cancelRunWatch.current = null;
          reject(reason);
        }
      };
      const isTerminal = (run: Run) => ["completed", "failed", "cancelled"].includes(run.status);
      const terminalFromServer = async () => {
        try {
          const run = await getRun(runId);
          if (!isCurrentSession()) return;
          if (isTerminal(run)) await finish();
          else reconnect();
        } catch {
          if (isCurrentSession()) reconnect();
        }
      };
      const connect = () => {
        if (settled || !isCurrentSession()) {
          settled = true;
          close();
          reject(new Error("run_watch_cancelled"));
          return;
        }
        const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events?after=${cursor.current}`, { withCredentials: true });
        stream = source;
        runStream.current = source;
        source.addEventListener("run.progress", (event) => {
          if (!isCurrentSession() || !cursor.accept((event as MessageEvent).lastEventId)) return;
          try {
            const data = JSON.parse((event as MessageEvent).data) as { phase?: string; item_count?: number };
            setProgress(runProgressMessage(data.phase || "", data.item_count));
          } catch { /* Ignore malformed progress payloads. */ }
        });
        source.addEventListener("message.delta", (event) => {
          if (!isCurrentSession() || !cursor.accept((event as MessageEvent).lastEventId)) return;
          try {
            const text = JSON.parse((event as MessageEvent).data).text;
            if (typeof text === "string") setLiveAnswer((current) => current + text);
          } catch { /* Ignore malformed content events. */ }
        });
        source.addEventListener("run.snapshot", (event) => {
          if (!isCurrentSession() || !cursor.accept((event as MessageEvent).lastEventId)) return;
          try {
            const data = JSON.parse((event as MessageEvent).data) as { status?: string; last_event_sequence?: number; phase?: string };
            cursor.advanceTo(data.last_event_sequence || 0);
            if (data.phase === "drafts_ready") setProgress(t("runDraftsReady"));
            if (["completed", "failed", "cancelled"].includes(data.status || "")) void finish();
          } catch { /* Ignore malformed snapshots. */ }
        });
        for (const eventName of ["run.completed", "run.failed", "run.cancelled"]) {
          source.addEventListener(eventName, (event) => {
            if (!isCurrentSession() || !cursor.accept((event as MessageEvent).lastEventId)) return;
            void finish();
          });
        }
        source.addEventListener("run.status", (event) => {
          if (!isCurrentSession() || !cursor.accept((event as MessageEvent).lastEventId)) return;
          try {
            const data = JSON.parse((event as MessageEvent).data) as { status?: string };
            if (["completed", "failed", "cancelled"].includes(data.status || "")) void finish();
          } catch { /* Ignore status updates without a known schema. */ }
        });
        for (const eventName of ["run.started", "run.tool_duplicate"]) {
          source.addEventListener(eventName, (event) => {
            if (isCurrentSession()) cursor.accept((event as MessageEvent).lastEventId);
          });
        }
        source.onerror = () => {
          source.close();
          if (stream === source) stream = null;
          if (runStream.current === source) runStream.current = null;
          if (settled || !isCurrentSession()) return;
          setProgress(t("runReconnecting"));
          void terminalFromServer();
        };
      };
      const reconnect = () => {
        if (settled || !isCurrentSession() || ownedReconnectTimer !== null) return;
        ownedReconnectTimer = window.setTimeout(() => {
          if (reconnectTimer.current === ownedReconnectTimer) reconnectTimer.current = null;
          ownedReconnectTimer = null;
          connect();
        }, 1500);
        reconnectTimer.current = ownedReconnectTimer;
      };
      cancelWatch = () => {
        if (settled) return;
        settled = true;
        close();
        reject(new Error("run_watch_cancelled"));
      };
      cancelRunWatch.current = cancelWatch;
      connect();
    });
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
      const language = getLang();
      if (pendingMessage.current.content !== content || pendingMessage.current.language !== language) {
        pendingMessage.current = { content, payload: withLocalContext(content, language), id: crypto.randomUUID(), shown: false, language };
      }
      const { run_id } = await sendMessage(conversationId.current, pendingMessage.current.payload, pendingMessage.current.id, token);
      if (session !== sessionId.current) return;
      activeRunId.current = run_id;
      setProgress(t("runQueued"));
      if (guestQuota) guestQuota.spend();
      if (!pendingMessage.current.shown) {
        setMessages((current) => [...current, { role: "user", text: content }]);
        pendingMessage.current.shown = true;
      }
      setInput("");
      inputRef.current = "";
      lastAudio.current = null;
      setClarification("");
      const run = await watchRun(run_id, session);
      if (session !== sessionId.current) return;
      activeRunId.current = "";
      setProgress("");
      setLiveAnswer("");
      if (run.status === "completed") {
        pendingMessage.current = { content: "", payload: "", id: "", shown: false, language: getLang() };
        setMessages((current) => [...current, { role: "assistant", text: run.assistant_content || t("errNoReply") }]);
        return;
      }
      pendingMessage.current = { content: "", payload: "", id: "", shown: false, language: getLang() };
      throw new Error(`${t("errRunFailed")}${run.error_code ? ` (${run.error_code})` : ""}`);
    } catch (reason) {
      if (active.current && session === sessionId.current) {
        if (activeRunId.current && !cancelRunWatch.current) activeRunId.current = "";
        if (reason instanceof ApiRequestError && (reason.code === "AUTH_REQUIRED" || reason.code === "CSRF_INVALID")) onSessionExpired();
        else if ((reason as Error).message !== "run_watch_cancelled") { inputRef.current = content; setInput(content); setError((reason as Error).message); }
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
    {(messages.length > 0 || progress || liveAnswer) && <div className="voice-chat-messages" aria-live="polite" aria-relevant="additions text">
      {messages.map((message, index) => message.role === "assistant"
        ? <div key={index} className="voice-chat-bubble assistant"><Markdown>{message.text}</Markdown></div>
        : <p key={index} className="voice-chat-bubble user">{message.text}</p>)}
      {liveAnswer && <div className="voice-chat-bubble assistant"><Markdown>{liveAnswer}</Markdown></div>}
      {progress && <p className="voice-run-progress" role="status">{progress}</p>}
      <div ref={messageEnd} />
    </div>}
    {proposalBatches.length > 0 && <div className="voice-proposal-batch-area" aria-label={t("batchHeading")}>
      <ProposalBatchReview batches={proposalBatches} onChange={(batch) => setProposalBatches((current) => current.map((item) => item.batch_id === batch.batch_id ? batch : item))} onTasksChanged={onTasksChanged} disabled={busy} />
      <div ref={proposalBatchEnd} />
    </div>}
    <ProposalCarousel proposals={proposals} busy={busy} focusProposalId={proposalFocusId} onDecide={(proposal, accept) => void decide(proposal, accept)} />
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
