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
  const remaining = tasks.filter((task) => !task.done);
  const featured = remaining
    .filter((task) => task.urgent || task.important)
    .slice(0, 3);
  return (
    <>
      <div className="eyebrow">
        <span className="eyebrow-line" /> YOUR DAY, IN FOCUS
      </div>
      <div className="page-heading">
        <div>
          <h1>
            今天，先做重要的事<span className="period">.</span>
          </h1>
          <p>用一句话记下待办，给今天一点清晰的节奏。</p>
        </div>
        <div className="date-stamp">
          <strong>{new Date().getDate().toString().padStart(2, "0")}</strong>
          <span>
            {new Intl.DateTimeFormat("zh-CN", { month: "long" }).format(
              new Date(),
            )}
          </span>
        </div>
      </div>
      <section className="hero-card">
        <div className="hero-copy">
          <div className="pill-light">
            <span className="pulse-dot" /> 灵感来了，随时说
          </div>
          <h2>
            想到什么，
            <br />
            说出来就好。
          </h2>
          <p>一句话记录任务，轻松分清重要与紧急。</p>
          <div className="hero-actions">
            <button
              className="button button-white"
              onClick={() => openComposer(true)}
            >
              <Icon name="mic" /> 体验语音录入 <Icon name="arrow" size={18} />
            </button>
            <button
              className="text-button light"
              onClick={() => openComposer()}
            >
              或手动输入 <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="orbit one" />
          <div className="orbit two" />
          <div className="orbit three" />
          <div className="center-orb">
            <Icon name="mic" size={38} />
          </div>
          <span className="sound-line sound-1" />
          <span className="sound-line sound-2" />
          <span className="sound-line sound-3" />
          <span className="sound-line sound-4" />
        </div>
      </section>
      <div className="section-heading">
        <div>
          <div className="eyebrow compact">TODAY'S PRIORITIES</div>
          <h2>
            今日聚焦 <span className="count-badge">{featured.length}</span>
          </h2>
        </div>
        <button className="link-button" onClick={() => navigate("tasks")}>
          查看全部事务 <Icon name="arrow" size={17} />
        </button>
      </div>
      <div className="today-grid">
        <div className="priority-list">
          {featured.length ? (
            featured.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                toggle={toggle}
                number={index + 1}
              />
            ))
          ) : (
            <div className="empty-state">今天的重点都完成了。</div>
          )}
        </div>
        <button
          className="training-teaser"
          onClick={() => navigate("training")}
        >
          <span className="teaser-icon">
            <Icon name="focus" size={24} />
          </span>
          <span className="teaser-kicker">给大脑一点热身</span>
          <strong>经典 5×5，准备加入。</strong>
          <span className="teaser-foot">
            查看训练入口 <Icon name="arrow" size={18} />
          </span>
          <span className="teaser-decoration" aria-hidden="true">
            25
          </span>
        </button>
      </div>
      <div className="summary-strip">
        <div>
          <span>待办事务</span>
          <strong>{remaining.length.toString().padStart(2, "0")}</strong>
        </div>
        <div>
          <span>已完成</span>
          <strong>
            {tasks
              .filter((task) => task.done)
              .length.toString()
              .padStart(2, "0")}
          </strong>
        </div>
        <div>
          <span>优先处理</span>
          <strong>
            {remaining
              .filter((task) => task.important && task.urgent)
              .length.toString()
              .padStart(2, "0")}
          </strong>
        </div>
        <p>
          小步开始，
          <br />
          每一步都算数。
        </p>
      </div>
    </>
  );
}
