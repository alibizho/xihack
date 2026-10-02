import { useEffect, useRef, useState } from "react";
import { cancelProposal, confirmProposal, type TaskProposal } from "../../shared/backendApi";
import { displayDue } from "./backendTasks";
import "./TaskComposer.css";

type Props = { proposal: TaskProposal; taskTitle?: string; onDone: () => Promise<void>; onClose: () => void };

export function ConfirmTaskProposal({ proposal, taskTitle, onDone, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function confirm() {
    setBusy(true); setError("");
    try { await confirmProposal(proposal); onClose(); await onDone(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function cancel() {
    setBusy(true);
    try { await cancelProposal(proposal); onClose(); }
    catch (reason) { setError((reason as Error).message); setBusy(false); }
  }
  const summary = proposal.operation === "complete" ? "标记这件事务为已完成" : proposal.operation === "create" ? "添加这件事务" : proposal.operation === "delete" ? "删除这件事务" : "保存这次修改";
  return <dialog ref={dialog} className="composer proposal-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) void cancel(); }} aria-labelledby="proposal-title">
    <span className="section-kicker">最后一步</span><h2 id="proposal-title">确认{summary}</h2>
    <p className="review-intro">{proposal.task?.title || proposal.changes?.title || taskTitle || "请核对这次账号事务操作"}</p>
    {(proposal.task || proposal.changes) && <dl className="proposal-details">
      {proposal.task?.due !== undefined && <><dt>时间</dt><dd>{displayDue(proposal.task.due)}</dd></>}
      {proposal.changes?.due !== undefined && <><dt>时间</dt><dd>{displayDue(proposal.changes.due || null)}</dd></>}
      {(proposal.task?.important !== undefined || proposal.changes?.important !== undefined) && <><dt>重要</dt><dd>{proposal.task?.important ?? proposal.changes?.important ? "是" : "否"}</dd></>}
      {(proposal.task?.urgent !== undefined || proposal.changes?.urgent !== undefined) && <><dt>紧急</dt><dd>{proposal.task?.urgent ?? proposal.changes?.urgent ? "是" : "否"}</dd></>}
    </dl>}
    <p className="composer-footnote">确认后才会写入你的账号。提案过期时可以重新发起。</p>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="composer-actions"><button className="button button-outline" onClick={() => void cancel()} disabled={busy}>取消</button><button className="button button-primary" onClick={() => void confirm()} disabled={busy}>{busy ? "处理中…" : "确认写入"}</button></div>
  </dialog>;
}
