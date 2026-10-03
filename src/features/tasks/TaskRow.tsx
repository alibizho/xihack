import { formatDue, priorityScore, type Task } from "./mockTasks";
import { Icon } from "../../shared/Icon";

export function TaskRow({
  task,
  toggle,
  edit,
  serverMode = false,
}: {
  task: Task;
  toggle: (id: string) => void;
  edit?: () => void;
  serverMode?: boolean;
}) {
  return (
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button
        className="task-check"
        onClick={() => toggle(task.id)}
        disabled={serverMode && task.done}
        aria-label={`${task.done ? serverMode ? "已完成" : "恢复待办" : "标记完成"}：${task.title}`}
        aria-pressed={task.done}
      >
        {task.done && <Icon name="check" size={15} />}
      </button>
      <div className="task-body">
        <strong>{task.title}</strong>
        <div className="task-meta">
          {task.category}
          <span className="meta-dot" /> {formatDue(task.due)}
        </div>
      </div>
      <span className="task-priority">{priorityScore(task).toFixed(1)}</span>
      {edit && <button className="task-edit" onClick={edit} aria-label={`编辑${task.title}`}><Icon name="arrow" size={18} /></button>}
    </div>
  );
}
