import { useEffect, useRef, useState } from "react";
import { interpretTask } from "./mockTaskApi";
import { parseDue, scheduledDue, type Task, type TaskDraft } from "./mockTasks";
import { createChineseSpeechRecognition, speechRecognitionErrorMessage, type ChineseSpeechRecognition } from "./speechRecognition";
import { Icon } from "../../shared/Icon";
import type { Capture } from "../../App";
import { calibrateSpeechDraft } from "../../shared/backendApi";
import { displayDue } from "./backendTasks";
import "./TaskComposer.css";

type Props = {
  accountMode?: boolean;
  voice: boolean;
  initialText?: string;
  edit?: Task;
  tasks: Task[];
  history: Capture[];
  onClose: () => void;
  onSave: (task: TaskDraft, sourceText: string) => Promise<void> | void;
};

export function TaskComposer({ accountMode = false, voice, initialText = "", edit, tasks, history, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const recognition = useRef<ChineseSpeechRecognition | null>(null);
  const recognitionBase = useRef("");
  const finalTranscript = useRef("");
  const [input, setInput] = useState(initialText);
  const [proposal, setProposal] = useState<TaskDraft | null>(edit ? { title: edit.title, due: edit.due, importance: edit.importance, urgency: edit.urgency, importanceReason: edit.importanceReason, urgencyReason: edit.urgencyReason, category: edit.category } : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"interpreting" | "saving" | null>(null);
  const [recording, setRecording] = useState(false);
  const scheduled = parseDue(proposal?.due || "");

  useEffect(() => {
    dialog.current?.showModal();
    const stopWhenHidden = () => {
      if (document.hidden) recognition.current?.stop();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      if (recognition.current) {
        recognition.current.onresult = null;
        recognition.current.onerror = null;
        recognition.current.onend = null;
      }
      recognition.current?.abort();
      recognition.current = null;
    };
  }, []);

  async function prepare() {
    setBusy("interpreting");
    try {
      const calibrated = accountMode ? await calibrateSpeechDraft(input) : null;
      if (calibrated && !["create", "unclear"].includes(calibrated.intent)) {
        setError("这句话像是在查询或修改已有事务，请到「助手」页面继续。");
        return;
      }
      const reviewedText = calibrated?.draft_text || input;
      const result = await interpretTask({ text: reviewedText, now: new Date().toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, tasks, history: history.slice(0, 5).map(({ input, title }) => ({ input, title })) });
      setProposal({ ...result, due: calibrated?.due ? displayDue(calibrated.due) : result.due });
      if (calibrated) setInput(reviewedText);
      setError(calibrated?.needs_clarification ? calibrated.clarification || "请检查时间与任务内容。" : "");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  }
  function record() {
    if (recognition.current) {
      recognition.current.stop();
      return;
    }
    const next = createChineseSpeechRecognition();
    if (!next) {
      setError("此浏览器暂不支持语音识别，请更新浏览器或改用文字输入。");
      return;
    }
    try {
      recognitionBase.current = input.trim() ? `${input.trim()} ` : "";
      finalTranscript.current = "";
      next.onresult = (event) => {
        let final = "";
        let interim = "";
        for (let index = 0; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (result.isFinal) final += result[0].transcript;
          else interim += result[0].transcript;
        }
        finalTranscript.current = final;
        setInput(`${recognitionBase.current}${final}${interim}`);
        setError("");
      };
      next.onerror = (event) => {
        setError(speechRecognitionErrorMessage(event.error));
        setRecording(false);
      };
      next.onend = () => {
        setInput(`${recognitionBase.current}${finalTranscript.current}`.trim());
        recognition.current = null;
        setRecording(false);
      };
      next.start();
      recognition.current = next;
      setError("");
      setRecording(true);
    } catch (reason) {
      recognition.current = null;
      setRecording(false);
      setError(speechRecognitionErrorMessage((reason as { name?: string }).name || ""));
    }
  }
  async function save() {
    if (!proposal?.title.trim()) {
      setError("请填写任务名称");
      return;
    }
    setBusy("saving");
    try { await onSave({ ...proposal, title: proposal.title.trim() }, input || edit?.title || proposal.title); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(null); }
  }

  return <dialog ref={dialog} className="composer" onClose={onClose} onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }} aria-labelledby="composer-title">
    <div className="composer-head"><div><span className="section-kicker">{edit ? "调整事务" : "一次整理一件事"}</span><h2 id="composer-title">{edit ? "编辑这件事" : proposal ? "确认后，放入清单" : "记下一件事"}</h2></div><button className="icon-button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" /></button></div>
    {!proposal ? <>
      {voice && <div className="voice-panel"><div className="voice-panel-top"><Icon name="mic" size={22} /><div><strong>语音记事</strong><p>{recording ? "正在识别，请直接说话；结束后文字会留在输入框中。" : "使用浏览器语音识别，识别结果可继续编辑。"}</p></div></div><button className={`record-button ${recording ? "recording" : ""}`} onClick={record} disabled={!!busy} aria-pressed={recording}><Icon name="mic" size={19} />{recording ? "结束录音" : "开始录音"}</button></div>}
      <label className="field-label" htmlFor="task-input">你想做什么</label>
      <textarea id="task-input" rows={3} value={input} onChange={(event) => setInput(event.target.value)} placeholder="例如：明天下午三点交项目周报，很重要" readOnly={recording} />
      {error && <p className="field-error" role="alert">{error}</p>}
      <button className="button button-primary full-width" onClick={prepare} disabled={!!busy || recording}>{busy === "interpreting" ? "正在整理…" : "整理并预览"} <Icon name="arrow" size={18} /></button>
      <p className="composer-footnote">{accountMode ? "服务端校准文字与时间；任务字段仍可编辑，重要与紧急请自行确认。" : "演示解析不会发送到服务器；确认后写入浏览器清单。"}</p>
    </> : <>
      <p className="review-intro">{accountMode ? "请核对内容。账号事务会先生成提案，再由你确认写入。" : edit ? "修改后确认保存。" : "这是模拟解析结果，可以先改好再添加。"}</p>
      <label className="field-label" htmlFor="proposal-title">任务名称</label><input id="proposal-title" className="form-input" value={proposal.title} onChange={(event) => setProposal({ ...proposal, title: event.target.value })} />
      <div className="form-grid"><div><label className="field-label" htmlFor="proposal-date">日期</label><input id="proposal-date" type="date" className="form-input" value={scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(event.target.value, scheduled.time) })} /></div><div><label className="field-label" htmlFor="proposal-time">时间</label><input id="proposal-time" type="time" step="300" className="form-input" value={scheduled.time} disabled={!scheduled.date} onChange={(event) => setProposal({ ...proposal, due: scheduledDue(scheduled.date, event.target.value) })} /></div></div>
      <label className="field-label" htmlFor="proposal-category">分类</label><input id="proposal-category" className="form-input" value={proposal.category} onChange={(event) => setProposal({ ...proposal, category: event.target.value })} />
      <div className="composer-scores">{(["importance", "urgency"] as const).map((axis) => accountMode ? <fieldset className="composer-binary" key={axis}><legend>{axis === "importance" ? "这件事重要吗？" : "这件事紧急吗？"}</legend><div><button type="button" className={proposal[axis] >= 6 ? "selected" : ""} aria-pressed={proposal[axis] >= 6} onClick={() => setProposal({ ...proposal, [axis]: 10 })}>是</button><button type="button" className={proposal[axis] < 6 ? "selected" : ""} aria-pressed={proposal[axis] < 6} onClick={() => setProposal({ ...proposal, [axis]: 0 })}>否</button></div></fieldset> : <div className="composer-score" key={axis}><div><label htmlFor={`proposal-${axis}`}>{axis === "importance" ? "重要度" : "紧急度"}</label><output>{proposal[axis].toFixed(1)} / 10</output></div><input id={`proposal-${axis}`} type="range" min="0" max="10" step="0.1" value={proposal[axis]} onChange={(event) => setProposal({ ...proposal, [axis]: Number(event.target.value), [axis === "importance" ? "importanceReason" : "urgencyReason"]: "用户调整" })} /><small>{proposal[axis === "importance" ? "importanceReason" : "urgencyReason"]}</small></div>)}</div>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="composer-actions">{!edit && <button className="button button-outline" onClick={() => setProposal(null)} disabled={!!busy}>返回修改</button>}<button className="button button-primary" onClick={() => void save()} disabled={!!busy}>{busy === "saving" ? "正在生成提案…" : edit ? "保存修改" : "确认添加"} <Icon name="check" size={17} /></button></div>
    </>}
  </dialog>;
}
