import { formatDue, priorityScore, type Task } from "./mockTasks";
import { fill } from "../../shared/i18n.ts";
import { Icon } from "../../shared/Icon";

export function TaskRow({
  task,
  toggle,
  edit,
  serverMode = false,
  openReport,
}: {
  task: Task;
  toggle: (id: string) => void;
  edit?: () => void;
  serverMode?: boolean;
  openReport?: () => void;
}) {
  return (
    <div className={`task-row ${task.done ? "is-done" : ""}`}>
      <button
        className="task-check"
        onClick={() => toggle(task.id)}
        disabled={serverMode && task.done}
        aria-label={task.done ? (serverMode ? fill("doneAria", { title: task.title }) : fill("restoreAria", { title: task.title })) : fill("markDoneAria", { title: task.title })}
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
      {openReport && <button className="task-edit" onClick={openReport} aria-label={fill("viewReportAria", { title: task.title })}><Icon name="arrow" size={18} /></button>}
      {edit && <button className="task-edit" onClick={edit} aria-label={fill("editAria", { title: task.title })}><Icon name="arrow" size={18} /></button>}
    </div>
  );
}
