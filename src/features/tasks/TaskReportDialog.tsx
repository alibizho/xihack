import { useEffect, useRef, useState } from "react";
import { ApiRequestError } from "../../shared/api.ts";
import { Icon } from "../../shared/Icon";
import { csrf, getTaskReport, submitTaskReport, type TaskReport } from "./agentApi";
import { t } from "../../shared/i18n.ts";
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
    <div className="composer-head"><div><span className="section-kicker">{t("reportKicker")}</span><h2 id="report-title">{title}</h2></div><button className="icon-button" type="button" onClick={() => dialog.current?.close()} aria-label={t("closeAria")}><Icon name="close" /></button></div>
    <p className="review-intro">{t("reportIntro")}</p>
    {report ? <>
      <p className="report-body">{report.body}</p>
      {report.status === "analyzed" ? <dl className="report-insight"><dt>{t("summaryLabel")}</dt><dd>{report.summary}</dd>{report.blocker && <><dt>{t("blockerLabel")}</dt><dd>{report.blocker}</dd></>}{report.next_step && <><dt>{t("nextStepLabel")}</dt><dd>{report.next_step}</dd></>}</dl>
        : <p role="status">{report.status === "unavailable" ? t("reportSavedUnavailable") : t("reportSavedPending")}</p>}
      {report.status === "pending" && <button className="button button-outline" disabled={busy} onClick={() => void submit()}>{busy ? t("analyzing") : t("retryAnalysis")}</button>}
    </> : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}><label className="field-label" htmlFor="report-body">{t("yourReport")}</label><textarea id="report-body" value={body} onChange={(event) => setBody(event.target.value)} minLength={1} maxLength={2000} required placeholder={t("reportPlaceholder")} /><button className="button button-primary full-width" disabled={busy || !body.trim()}>{busy ? t("savingAnalyzing") : t("saveAndAnalyze")}</button></form>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </dialog>;
}
