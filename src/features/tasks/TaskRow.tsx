import type { Task } from "./mockTasks";
import { Icon } from "../../shared/Icon";

export function TaskRow({
  task,
  toggle,
  number,
}: {
  task: Task;
  toggle: (id: string) => void;
  number?: number;
}) {
  return (
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button
        className="task-check"
        onClick={() => toggle(task.id)}
        aria-label={`${task.done ? "恢复" : "完成"}${task.title}`}
        aria-pressed={task.done}
      >
        {task.done && <Icon name="check" size={15} />}
      </button>
      <div className="task-body">
        <strong>{task.title}</strong>
        <div className="task-meta">
          {task.category}
          <span className="meta-dot" /> {task.due}
        </div>
      </div>
      <div className="task-tags">
        {task.important && <span className="tag important">重要</span>}
        {task.urgent && <span className="tag urgent">紧急</span>}
      </div>
      {number && (
        <span className="row-number">{String(number).padStart(2, "0")}</span>
      )}
    </div>
  );
}
