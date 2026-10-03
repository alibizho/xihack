import { useRef, useState } from "react";
import { ApiRequestError } from "../../shared/api.ts";
import { Icon } from "../../shared/Icon";
import { fill, t, uiLocale } from "../../shared/i18n.ts";
import {
  cancelProposalBatchItem,
  confirmProposalBatch,
  csrf,
  getProposalBatch,
  updateProposalBatchItem,
  type ProposalBatch,
  type Proposal,
  type TaskDraft,
} from "./agentApi";

function draftOf(proposal: Proposal): TaskDraft {
  const task = proposal.task || {};
  return {
    title: task.title || "",
    description: task.description || "",
    category: task.category || "",
    due: task.due || null,
    importance: task.importance ?? 5,
    urgency: task.urgency ?? 3,
  };
}

function dateTimeValue(at: string, timezone: string) {
  if (!at) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(at));
  } catch { return ""; }
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function instantForWallTime(value: string, timezone: string): string {
  const [day, clock] = value.split("T");
  if (!day || !clock) throw new Error(t("batchInvalidDate"));
  const [year, month, date] = day.split("-").map(Number);
  const [hour, minute] = clock.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, date, hour, minute);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const get = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    const represented = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
    candidate += desired - represented;
  }
  if (dateTimeValue(new Date(candidate).toISOString(), timezone) !== value) {
    throw new Error(t("batchInvalidDate"));
  }
  return new Date(candidate).toISOString();
}

function dueLabel(proposal: Proposal) {
  const due = proposal.task?.due;
  if (!due) return t("dateUnset");
  if (due.precision === "date") return due.date;
  const date = new Intl.DateTimeFormat(uiLocale(), {
    timeZone: due.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(due.at));
  return `${date} (${due.timezone})`;
}

export function ProposalBatchReview({
  batches, onChange, onTasksChanged, disabled,
}: {
  batches: ProposalBatch[];
  onChange: (batch: ProposalBatch) => void;
  onTasksChanged: () => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState<Record<string, TaskDraft>>({});
  const [activeIndexByBatch, setActiveIndexByBatch] = useState<Record<string, number>>({});
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const keys = useRef(new Map<string, string>());

  async function save(batch: ProposalBatch, proposal: Proposal) {
    const task = editing[proposal.proposal_id];
    if (!task) return;
    try {
      setBusyId(batch.batch_id);
      setError("");
      const token = await csrf();
      const updated = await updateProposalBatchItem(batch.batch_id, proposal.proposal_id, task, token);
      onChange(updated);
      setEditing((current) => { const next = { ...current }; delete next[proposal.proposal_id]; return next; });
    } catch (reason) {
      setError((reason as Error).message || t("batchUpdateFailed"));
    } finally { setBusyId(""); }
  }

  async function remove(batch: ProposalBatch, proposal: Proposal) {
    try {
      setBusyId(batch.batch_id);
      setError("");
      onChange(await cancelProposalBatchItem(batch.batch_id, proposal.proposal_id, await csrf()));
    } catch (reason) {
      setError((reason as Error).message || t("batchUpdateFailed"));
    } finally { setBusyId(""); }
  }

  async function confirm(batch: ProposalBatch) {
    const count = batch.proposals.filter((proposal) => proposal.status === "pending").length;
    if (!count) return;
    try {
      setBusyId(batch.batch_id);
      setError("");
      let key = keys.current.get(batch.batch_id);
      if (!key) { key = crypto.randomUUID(); keys.current.set(batch.batch_id, key); }
      await confirmProposalBatch(batch.batch_id, key, await csrf());
      onChange(await getProposalBatch(batch.batch_id));
      onTasksChanged();
    } catch (reason) {
      const code = reason instanceof ApiRequestError ? reason.code : "";
      setError(code === "PROPOSAL_EXPIRED" ? t("batchExpired") : (reason as Error).message || t("batchConfirmFailed"));
    } finally { setBusyId(""); }
  }

  return <>
    {batches.map((batch, batchIndex) => {
      const pendingCount = batch.proposals.filter((proposal) => proposal.status === "pending").length;
      const batchDisabled = disabled || busyId === batch.batch_id || batch.status !== "pending";
      const activeIndex = Math.min(activeIndexByBatch[batch.batch_id] || 0, Math.max(0, batch.proposals.length - 1));
      return <section className="voice-proposal-batch" key={batch.batch_id} aria-label={t("batchHeading")}>
        <header className="voice-proposal-batch-head">
          <strong>{t("batchHeading")} {batchIndex + 1}</strong>
          <span>{batch.status === "pending" ? fill("batchPendingCount", { n: pendingCount }) : t(batch.status === "confirmed" ? "batchConfirmed" : batch.status === "expired" ? "batchExpired" : "batchCancelled")}</span>
        </header>
        <div className="voice-batch-carousel">
        {batch.proposals.length > 1 && <button className="proposal-nav" type="button" disabled={activeIndex <= 0} onClick={() => setActiveIndexByBatch((current) => ({ ...current, [batch.batch_id]: activeIndex - 1 }))} aria-label={t("proposalPrevious")}><Icon name="chevronLeft" size={22} /></button>}
        {batch.proposals.map((proposal, itemIndex) => {
          if (itemIndex !== activeIndex) return null;
          const task = proposal.task;
          const draft = editing[proposal.proposal_id];
          return <article className="voice-proposal" key={proposal.proposal_id}>
            <strong>{fill("batchItemLabel", { n: itemIndex + 1 })}</strong>
            {draft ? <div className="voice-batch-edit">
              <label>{t("taskTitleLabel")}<input value={draft.title} maxLength={200} onChange={(event) => setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, title: event.target.value } }))} /></label>
              <label>{t("categoryLabel")}<input value={draft.category || ""} maxLength={64} onChange={(event) => setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, category: event.target.value } }))} /></label>
              <label>{t("batchDescription")}<textarea rows={2} maxLength={2000} value={draft.description || ""} onChange={(event) => setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, description: event.target.value } }))} /></label>
              <label>{t("batchDuePrecision")}<select value={draft.due?.precision || "none"} onChange={(event) => {
                const timezone = draft.due?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                const value = event.target.value === "date" ? { precision: "date" as const, date: "", timezone }
                  : event.target.value === "minute" ? { precision: "minute" as const, at: "", timezone } : null;
                setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, due: value } }));
              }}><option value="none">{t("dateUnset")}</option><option value="date">{t("dateOnly")}</option><option value="minute">{t("dateAndTime")}</option></select></label>
              {draft.due?.precision === "date" && <label>{t("dateLabel")}<input type="date" value={draft.due.date} onChange={(event) => setEditing((current) => ({
                ...current,
                [proposal.proposal_id]: { ...draft, due: { ...draft.due!, date: event.target.value } },
              }))} /></label>}
              {draft.due?.precision === "minute" && <>
                <label>{t("dateAndTime")}<input type="datetime-local" value={dateTimeValue(draft.due.at, draft.due.timezone)} onChange={(event) => {
                  if (!event.target.value) { setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, due: { ...draft.due!, at: "" } } })); return; }
                  try { setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, due: { ...draft.due!, at: instantForWallTime(event.target.value, draft.due!.timezone) } } })); setError(""); }
                  catch (reason) { setError((reason as Error).message); }
                }} /></label>
                <label>{t("batchTimezone")}<input value={draft.due.timezone} maxLength={64} onChange={(event) => setEditing((current) => ({
                  ...current,
                  [proposal.proposal_id]: { ...draft, due: { ...draft.due!, timezone: event.target.value } },
                }))} /></label>
              </>}
              <div className="voice-batch-edit-scores">
                <label>{t("importanceLabel")}<input type="number" min="0" max="10" step="0.1" value={draft.importance} onChange={(event) => setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, importance: Number(event.target.value) } }))} /></label>
                <label>{t("urgencyLabel")}<input type="number" min="0" max="10" step="0.1" value={draft.urgency} onChange={(event) => setEditing((current) => ({ ...current, [proposal.proposal_id]: { ...draft, urgency: Number(event.target.value) } }))} /></label>
              </div>
              <div className="voice-proposal-actions"><button type="button" disabled={batchDisabled} onClick={() => { setEditing((current) => { const next = { ...current }; delete next[proposal.proposal_id]; return next; }); }}>{t("cancel")}</button><button type="button" disabled={batchDisabled} onClick={() => void save(batch, proposal)}>{t("batchSaveCorrection")}</button></div>
            </div> : <>
              <p className="voice-proposal-title">{task?.title}</p>
              {task?.description && <p className="voice-proposal-description">{task.description}</p>}
              <dl className="voice-proposal-details">
                <dt>{t("dateAndTime")}</dt><dd>{dueLabel(proposal)}</dd>
                <dt>{t("categoryLabel")}</dt><dd>{task?.category || t("uncategorized")}</dd>
                <dt>{t("importanceLabel")}</dt><dd>{task?.importance?.toFixed(1)} / 10</dd>
                <dt>{t("urgencyLabel")}</dt><dd>{task?.urgency?.toFixed(1)} / 10</dd>
              </dl>
              {proposal.status === "pending" && <div className="voice-proposal-actions">
                <button type="button" disabled={batchDisabled} onClick={() => setEditing((current) => ({ ...current, [proposal.proposal_id]: draftOf(proposal) }))}>{t("batchCorrect")}</button>
                <button type="button" disabled={batchDisabled || pendingCount <= 1} onClick={() => void remove(batch, proposal)}>{t("batchRemove")}</button>
              </div>}
              {proposal.status !== "pending" && <small>{t(proposal.status === "confirmed" ? "confirmedLabel" : "cancelledLabel")}</small>}
            </>}
          </article>;
        })}
        {batch.proposals.length > 1 && <button className="proposal-nav" type="button" disabled={activeIndex >= batch.proposals.length - 1} onClick={() => setActiveIndexByBatch((current) => ({ ...current, [batch.batch_id]: activeIndex + 1 }))} aria-label={t("proposalNext")}><Icon name="chevronRight" size={22} /></button>}
        </div>
        {batch.proposals.length > 1 && <p className="proposal-progress" aria-live="polite">{activeIndex + 1} / {batch.proposals.length}</p>}
        {batch.status === "pending" && <button className="voice-batch-confirm" type="button" disabled={batchDisabled || pendingCount === 0 || Object.keys(editing).some((id) => batch.proposals.some((item) => item.proposal_id === id))} onClick={() => void confirm(batch)}>
          {fill("batchConfirmWrite", { n: pendingCount })}
        </button>}
      </section>;
    })}
    {error && <p className="field-error" role="alert">{error}</p>}
  </>;
}
