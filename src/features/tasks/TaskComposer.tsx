import { useEffect, useRef, useState } from "react";
import { parseDue, scheduledDue, type Task, type TaskDraft } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import "./TaskComposer.css";

type Props = {
  edit?: Task;
  onClose: () => void;
  onSave: (task: TaskDraft) => Promise<void> | void;
};

// ponytail: manual entry fills the card directly; AI interpretation only happens in the voice assistant. Add an assisted path here when inbox/brain-dump lands.
const blankDraft = (): TaskDraft => ({
  title: "", due: "待安排", category: "",
  importance: 5.0, urgency: 3.0,
  importanceReason: "手动添加，拖动滑杆调整", urgencyReason: "手动添加，拖动滑杆调整",
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
      setError("请填写任务名称");
      return;
    }
    setBusy(true);
    try { await onSave({ ...proposal, title: proposal.title.trim() }); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="composer-title">
    <div className="composer-head"><div><span className="section-kicker">{edit ? "调整事务" : "手动添加"}</span><h2 id="composer-title">{edit ? "编辑这件事" : "新建事务"}</h2></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" /></button></div>
    <p className="review-intro">填写后生成提案，确认一次即写入{edit ? "" : "账号"}。</p>
    <label className="field-label" htmlFor="proposal-title">任务名称</label><input id="proposal-title" className="form-input" value={proposal.title} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} placeholder="例如：明天下午三点交项目周报" autoFocus />
    <div className="form-grid"><div><label className="field-label" htmlFor="proposal-date">日期</label><input id="proposal-date" type="date" className="form-input" value={scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(event.target.value, scheduled.time) })} /></div><div><label className="field-label" htmlFor="proposal-time">时间</label><input id="proposal-time" type="time" step="300" className="form-input" value={scheduled.time} disabled={!scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(scheduled.date, event.target.value) })} /></div></div>
    <label className="field-label" htmlFor="proposal-category">分类</label><input id="proposal-category" className="form-input" value={proposal.category} onChange={(event) => setProposal({ ...proposal, category: event.target.value })} placeholder="学习 / 生活" />
    <div className="composer-scores">{(["importance", "urgency"] as const).map((axis) => <div className="composer-score" key={axis}><div><label htmlFor={`proposal-${axis}`}>{axis === "importance" ? "重要度" : "紧急度"}</label><output>{proposal[axis].toFixed(1)} / 10</output></div><input id={`proposal-${axis}`} type="range" min="0" max="10" step="0.1" value={proposal[axis]} onChange={(event) => setProposal({ ...proposal, [axis]: Number(event.target.value), [axis === "importance" ? "importanceReason" : "urgencyReason"]: "用户调整" })} /><small>{proposal[axis === "importance" ? "importanceReason" : "urgencyReason"]}</small></div>)}</div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="composer-actions"><button className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? "正在生成提案…" : edit ? "保存修改" : "确认添加"} <Icon name="check" size={17} /></button></div>
  </dialog>;
}
