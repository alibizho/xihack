import { useEffect, useRef, useState } from "react";
import { parseDue, scheduledDue, type Task, type TaskDraft } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import { t } from "../../shared/i18n.ts";
import "./TaskComposer.css";

type Props = {
  edit?: Task;
  onClose: () => void;
  onSave: (task: TaskDraft) => Promise<void> | void;
};

// ponytail: manual entry fills the card directly; AI interpretation only happens in the voice assistant. Add an assisted path here when inbox/brain-dump lands.
const blankDraft = (): TaskDraft => ({
  title: "", due: t("dueUnscheduled"), category: "",
  importance: 5.0, urgency: 3.0,
  importanceReason: t("sliderHint"), urgencyReason: t("sliderHint"),
});

export function TaskComposer({ edit, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [proposal, setProposal] = useState<TaskDraft>(() => {
    if (!edit) return blankDraft();
    const { id: _id, done: _done, ...rest } = edit;
    return rest;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scheduled = parseDue(proposal.due);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function save() {
    if (!proposal.title.trim()) {
      setError(t("titleRequired"));
      return;
    }
    setBusy(true);
    try { await onSave({ ...proposal, title: proposal.title.trim() }); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="composer-title">
    <div className="composer-head"><div><span className="section-kicker">{edit ? t("adjustTask") : t("manualAdd")}</span><h2 id="composer-title">{edit ? t("editTaskTitle") : t("newTaskTitle")}</h2></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label={t("closeAria")}><Icon name="close" /></button></div>
    <p className="review-intro">{edit ? t("composerIntroEdit") : t("composerIntroCreate")}</p>
    <label className="field-label" htmlFor="proposal-title">{t("taskTitleLabel")}</label><input id="proposal-title" className="form-input" value={proposal.title} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} placeholder={t("titlePlaceholder")} autoFocus />
    <div className="form-grid"><div><label className="field-label" htmlFor="proposal-date">{t("dateLabel")}</label><input id="proposal-date" type="date" className="form-input" value={scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(event.target.value, scheduled.time) })} /></div><div><label className="field-label" htmlFor="proposal-time">{t("timeLabel")}</label><input id="proposal-time" type="time" step="300" className="form-input" value={scheduled.time} disabled={!scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(scheduled.date, event.target.value) })} /></div></div>
    <label className="field-label" htmlFor="proposal-category">{t("categoryLabel")}</label><input id="proposal-category" className="form-input" value={proposal.category} onChange={(event) => setProposal({ ...proposal, category: event.target.value })} placeholder={t("categoryPlaceholder")} />
    <div className="composer-scores">{(["importance", "urgency"] as const).map((axis) => <div className="composer-score" key={axis}><div><label htmlFor={`proposal-${axis}`}>{axis === "importance" ? t("importanceLabel") : t("urgencyLabel")}</label><output>{proposal[axis].toFixed(1)} / 10</output></div><input id={`proposal-${axis}`} type="range" min="0" max="10" step="0.1" value={proposal[axis]} onChange={(event) => setProposal({ ...proposal, [axis]: Number(event.target.value), [axis === "importance" ? "importanceReason" : "urgencyReason"]: t("userAdjusted") })} /><small>{proposal[axis === "importance" ? "importanceReason" : "urgencyReason"]}</small></div>)}</div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="composer-actions"><button className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? t("generating") : edit ? t("saveChanges") : t("confirmAdd")} <Icon name="check" size={17} /></button></div>
  </dialog>;
}
