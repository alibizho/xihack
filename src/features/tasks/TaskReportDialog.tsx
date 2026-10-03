import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../shared/api.ts";
import { Icon } from "../../shared/Icon";
import { csrf, getTaskReport, submitTaskReport, type TaskReport } from "./agentApi";
import "./TaskComposer.css";

export function TaskReportDialog({ taskId, title, onClose }: { taskId: string; title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [report, setReport] = useState<TaskReport | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
    getTaskReport(taskId).then((saved) => { setReport(saved); setBody(saved.body); }).catch((reason) => {
      if (!(reason instanceof ApiRequestError && reason.code === "NOT_FOUND")) setError((reason as Error).message);
    });
  }, [taskId]);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true); setError("");
    try { setReport(await submitTaskReport(taskId, body.trim(), await csrf())); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="composer report-dialog" onClose={onClose} aria-labelledby="report-title">
    <div className="composer-head"><div><span className="section-kicker">完成后复盘</span><h2 id="report-title">{title}</h2></div><button className="icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" /></button></div>
    <p className="review-intro">说说这件事做得怎样、哪里卡住了。助理会保存要点，供以后安排事务时参考。</p>
    {report ? <>
      <p className="report-body">{report.body}</p>
      {report.status === "analyzed" ? <dl className="report-insight"><dt>完成情况</dt><dd>{report.summary}</dd>{report.blocker && <><dt>遇到的阻碍</dt><dd>{report.blocker}</dd></>}{report.next_step && <><dt>下次可试</dt><dd>{report.next_step}</dd></>}</dl>
        : <p role="status">报告已保存，分析{report.status === "unavailable" ? "暂时不可用" : "尚未完成"}。</p>}
      {report.status === "pending" && <button className="button button-outline" disabled={busy} onClick={() => void submit()}>{busy ? "正在分析…" : "重试分析"}</button>}
    </> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}><label className="field-label" htmlFor="report-body">你的完成报告</label><textarea id="report-body" value={body} onChange={(event) => setBody(event.target.value)} minLength={1} maxLength={2000} required placeholder="例如：完成了初稿，但估时偏短；查资料花了更多时间。" /><button className="button button-primary full-width" disabled={busy || !body.trim()}>{busy ? "正在保存与分析…" : "保存并分析"}</button></form>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </dialog>;
}
