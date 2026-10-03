import { useEffect, useRef, useState } from "react";
import { interpretTask } from "./mockTaskApi";
import { parseDue, scheduledDue, type Task, type TaskDraft } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import type { Capture } from "../../App";
import "./TaskComposer.css";

type Props = {
  initialText?: string;
  edit?: Task;
  tasks: Task[];
  history: Capture[];
  onClose: () => void;
  onSave: (task: TaskDraft, sourceText: string) => Promise<void> | void;
};

export function TaskComposer({ initialText = "", edit, tasks, history, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [input, setInput] = useState(initialText);
  const [proposal, setProposal] = useState<TaskDraft | null>(edit ? { title: edit.title, due: edit.due, importance: edit.importance, urgency: edit.urgency, importanceReason: edit.importanceReason, urgencyReason: edit.urgencyReason, category: edit.category } : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const scheduled = parseDue(proposal?.due || "");

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function prepare() {
    setBusy(true);
    try {
      const result = await interpretTask({ text: input, now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tasks, history: history.slice(0, 5).map(({ input, title }) => ({ input, title })) });
      setProposal(result);
      setError("");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!proposal?.title.trim()) {
      setError("请填写任务名称");
      return;
    }
    setBusy(true);
    try { await onSave({ ...proposal, title: proposal.title.trim() }, input || edit?.title || proposal.title); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="composer-title">
    <div className="composer-head"><div><span className="section-kicker">{edit ? "调整事务" : "一次整理一件事"}</span><h2 id="composer-title">{edit ? "编辑这件事" : proposal ? "确认后，放入清单" : "记下一件事"}</h2></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" /></button></div>
    {!proposal ? <>
      <label className="field-label" htmlFor="task-input">你想做什么</label>
      <textarea id="task-input" rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：明天下午三点交项目周报，很重要" />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="button button-primary full-width" onClick={prepare} disabled={busy}>{busy ? "正在整理…" : "整理并预览"} <Icon name="arrow" size={18} /></button>
      <p className="composer-footnote">这一步仅生成可编辑预览；再次确认后才写入账号。</p>
    </> : <>
      <p className="review-intro">请核对内容。账号事务会先生成提案，再由你确认写入。</p>
      <label className="field-label" htmlFor="proposal-title">任务名称</label><input id="proposal-title" className="form-input" value={proposal.title} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} />
      <div className="form-grid"><div><label className="field-label" htmlFor="proposal-date">日期</label><input id="proposal-date" type="date" className="form-input" value={scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(event.target.value, scheduled.time) })} /></div><div><label className="field-label" htmlFor="proposal-time">时间</label><input id="proposal-time" type="time" step="300" className="form-input" value={scheduled.time} disabled={!scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(scheduled.date, event.target.value) })} /></div></div>
      <label className="field-label" htmlFor="proposal-category">分类</label><input id="proposal-category" className="form-input" value={proposal.category} onChange={(event) => setProposal({ ...proposal, category: event.target.value })} />
      <div className="composer-scores">{(["importance", "urgency"] as const).map((axis) => <div className="composer-score" key={axis}><div><label htmlFor={`proposal-${axis}`}>{axis === "importance" ? "重要度" : "紧急度"}</label><output>{proposal[axis].toFixed(1)} / 10</output></div><input id={`proposal-${axis}`} type="range" min="0" max="10" step="0.1" value={proposal[axis]} onChange={(event) => setProposal({ ...proposal, [axis]: Number(event.target.value), [axis === "importance" ? "importanceReason" : "urgencyReason"]: "用户调整" })} /><small>{proposal[axis === "importance" ? "importanceReason" : "urgencyReason"]}</small></div>)}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="composer-actions">{!edit && <button className="button button-outline" onClick={() => setProposal(null)} disabled={busy}>返回修改</button>}<button className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? "正在生成提案…" : edit ? "保存修改" : "确认添加"} <Icon name="check" size={17} /></button></div>
    </>}
  </dialog>;
}
