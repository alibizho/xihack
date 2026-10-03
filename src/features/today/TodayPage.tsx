import { useState } from "react";
import type { Task } from "../tasks/mockTasks";
import { compareBySchedule, formatDue, parseDue, priorityScore } from "../tasks/mockTasks";
import type { Capture } from "../../App";
import { Icon } from "../../shared/Icon";
import { VoiceAssistant } from "../tasks/VoiceAssistant";
import "./TodayPage.css";

type Props = {
  tasks: Task[];
  history: Capture[];
  navigate: (page: "tasks" | "training", day?: string) => void;
  openComposer: (text: string) => void;
  voiceOpen: boolean;
  openVoice: () => void;
  closeVoice: () => void;
  onSessionExpired: () => void;
  onTasksChanged: () => void;
  onTaskCompleted: (taskId: string) => void;
};

export function TodayPage({ tasks, history, navigate, openComposer, voiceOpen, openVoice, closeVoice, onSessionExpired, onTasksChanged, onTaskCompleted }: Props) {
  const [thought, setThought] = useState("");
  const open = tasks.filter((task) => !task.done);
  const next = [...open].sort(compareBySchedule)[0];
  const hour = new Date().getHours();
  const greeting = hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  const date = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());

  return <div className="today-page">
    <header className="today-intro"><span>{date}</span><h1>{greeting}，<br />今天想先做什么？</h1></header>
    <section className={`assistant-panel ${voiceOpen ? "voice-active" : ""}`} aria-labelledby="capture-title">
      <span className="demo-pill">语音助理 · 账号事务</span>
      <VoiceAssistant expanded={voiceOpen} onOpen={openVoice} onClose={closeVoice} onSessionExpired={onSessionExpired} onTasksChanged={onTasksChanged} onTaskCompleted={onTaskCompleted} />
      {!voiceOpen && <form className="quick-capture" onSubmit={(event) => { event.preventDefault(); if (thought.trim()) openComposer(thought); }}>
        <label className="sr-only" htmlFor="quick-thought">文字记录</label>
        <input id="quick-thought" value={thought} onChange={(event) => setThought(event.target.value)} placeholder="或者，直接写下来…" />
        <button type="submit" disabled={!thought.trim()} aria-label="整理文字"><Icon name="arrow" size={19} /></button>
      </form>}
    </section>
    <div className="home-shortcuts">
      <button className="next-task" onClick={() => navigate("tasks", next ? parseDue(next.due).date : undefined)}><span className="shortcut-label">下一件事</span><strong>{next?.title || "还没有待办"}</strong><span>{next ? `优先分 ${priorityScore(next).toFixed(1)} · ${formatDue(next.due)}` : "添加后会出现在这里"}</span><Icon name="arrow" size={18} /></button>
      <button className="training-shortcut" onClick={() => navigate("training")}><Icon name="focus" size={24} /><strong>专注训练</strong><span>从 1 数到 25</span><Icon name="arrow" size={18} /></button>
    </div>
    <details className="history-panel"><summary>本机旧记录 <span>{history.length ? `${history.length} 条` : "暂无"}</span></summary>{history.length ? <ol>{history.map((entry) => <li key={entry.id}><span>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(entry.time))}</span><strong>{entry.title}</strong><small>{entry.edited ? "已修改" : entry.input}</small></li>)}</ol> : <p>这里没有旧版浏览器记录。</p>}</details>
  </div>;
}
