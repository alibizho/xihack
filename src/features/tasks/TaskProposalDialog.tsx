import { useEffect, useRef, useState } from "react";
import { cancelProposal, confirmProposal, csrf, type Proposal } from "./agentApi";
import "./TaskComposer.css";

export function TaskProposalDialog({ proposal, taskTitle, onClose, onConfirmed, onCompleted }: { proposal: Proposal; taskTitle?: string; onClose: () => void; onConfirmed: () => void; onCompleted: (taskId: string, title: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const key = useRef(crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function decide(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const token = await csrf();
      if (accept) {
        await confirmProposal(proposal.proposal_id, key.current, token);
        onConfirmed();
        if (proposal.operation === "complete" && proposal.task_id) onCompleted(proposal.task_id, taskTitle || "已完成事务");
      } else await cancelProposal(proposal.proposal_id, token);
      onClose();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer" onCancel={(event) => { event.preventDefault(); if (!busy) void decide(false); }} aria-labelledby="task-proposal-title">
    <span className="section-kicker">最后一步</span>
    <h2 id="task-proposal-title">确认{proposal.operation === "create" ? "添加" : proposal.operation === "complete" ? "完成" : "修改"}事务</h2>
    <p className="review-intro">{proposal.task?.title || proposal.changes?.title || taskTitle || "请核对这次操作"}</p>
    <p className="composer-footnote">只有确认后才会写入账号。</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="composer-actions"><button className="button button-outline" disabled={busy} onClick={() => void decide(false)}>取消</button><button className="button button-primary" disabled={busy} onClick={() => void decide(true)}>{busy ? "处理中…" : "确认写入"}</button></div>
  </dialog>;
}
