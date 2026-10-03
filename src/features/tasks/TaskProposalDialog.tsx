import { useEffect, useRef, useState } from "react";
import { cancelProposal, confirmProposal, csrf, type Proposal } from "./agentApi";
import { t } from "../../shared/i18n.ts";
import "./TaskComposer.css";

export function TaskProposalDialog({ proposal, taskTitle, onClose, onConfirmed, onCompleted }: { proposal: Proposal; taskTitle?: string; onClose: () => void; onConfirmed: () => void; onCompleted: (taskId: string, title: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const details = proposal.task || proposal.changes;
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function decide(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = await csrf();
      if (accept) {
        await confirmProposal(proposal.proposal_id, key.current, token);
        onConfirmed();
        if (proposal.operation === "complete" && proposal.task_id) onCompleted(proposal.task_id, taskTitle || t("completedTaskFallback"));
      } else await cancelProposal(proposal.proposal_id, token);
      onClose();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer" onCancel={(event) => { event.preventDefault(); if (!busy) void decide(false); }} aria-labelledby="task-proposal-title">
    <span className="section-kicker">{t("finalStep")}</span>
    <h2 id="task-proposal-title">{proposal.operation === "create" ? t("confirmTitleCreate") : proposal.operation === "complete" ? t("confirmTitleComplete") : t("confirmTitleUpdate")}</h2>
    <p className="review-intro">{proposal.task?.title || proposal.changes?.title || taskTitle || t("reviewFallback")}</p>
    {details && (typeof details.importance === "number" || typeof details.urgency === "number") && <p className="review-intro">{typeof details.importance === "number" && `${t("importanceLabel")} ${details.importance.toFixed(1)} / 10`}{typeof details.importance === "number" && typeof details.urgency === "number" && " · "}{typeof details.urgency === "number" && `${t("urgencyLabel")} ${details.urgency.toFixed(1)} / 10`}</p>}
    <p className="composer-footnote">{t("onlyAfterConfirm")}</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="composer-actions"><button className="button button-outline" disabled={busy} onClick={() => void decide(false)}>{t("cancel")}</button><button className="button button-primary" disabled={busy} onClick={() => void decide(true)}>{busy ? t("working") : t("confirmWrite")}</button></div>
  </dialog>;
}
