import type { Task } from "../tasks/mockTasks";
import { Icon } from "../../shared/Icon";
import { TaskRow } from "../tasks/TaskRow";
import "./TodayPage.css";

type Props = {
  tasks: Task[];
  toggle: (id: string) => void;
  navigate: (page: "tasks" | "training") => void;
  openComposer: (voice?: boolean) => void;
};

export function TodayPage({ tasks, toggle, navigate, openComposer }: Props) {
  const featured = tasks
    .filter((task) => !task.done && (task.urgent || task.important))
    .slice(0, 3);

  return (
    <div className="today-page">
      <header className="today-heading">
        <h1>今天</h1>
        <span>
          {new Intl.DateTimeFormat("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          }).format(new Date())}
        </span>
      </header>

      <section className="voice-section" aria-label="添加事务">
        <button
          className="voice-circle"
          onClick={() => openComposer(true)}
          aria-label="打开语音录入演示"
        >
          <Icon name="mic" size={43} />
          <span>点击说话</span>
        </button>
        <p>语音录入演示 · 点击后选择示例话语</p>
        <button className="manual-entry" onClick={() => openComposer()}>
          手动输入 <Icon name="arrow" size={16} />
        </button>
      </section>

      <section className="today-tasks" aria-labelledby="today-tasks-title">
        <div className="today-tasks-heading">
          <h2 id="today-tasks-title">今日重点</h2>
          <button onClick={() => navigate("tasks")}>查看全部</button>
        </div>
        <div className="priority-list">
          {featured.length ? (
            featured.map((task) => (
              <TaskRow key={task.id} task={task} toggle={toggle} />
            ))
          ) : (
            <div className="empty-state">暂无重点任务</div>
          )}
        </div>
      </section>
    </div>
  );
}
