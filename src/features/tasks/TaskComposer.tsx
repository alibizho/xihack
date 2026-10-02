import { useState } from "react";
import { mockProposal, voiceExamples, type Task } from "./mockTasks";
import { Icon } from "../../shared/Icon";
import "./TaskComposer.css";

type Props = {
  voice: boolean;
  onClose: () => void;
  onSave: (task: Omit<Task, "id" | "done">) => void;
};

export function TaskComposer({ voice, onClose, onSave }: Props) {
  const [input, setInput] = useState("");
  const [proposal, setProposal] = useState<Omit<Task, "id" | "done"> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [voiceDemo, setVoiceDemo] = useState(voice);
  function prepare() {
    try {
      setProposal(mockProposal(input));
      setError("");
      setVoiceDemo(false);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }
  function save() {
    if (!proposal?.title.trim()) {
      setError("请填写任务名称");
      return;
    }
    onSave({ ...proposal, title: proposal.title.trim() });
  }
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="composer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="composer-title"
      >
        <div className="composer-head">
          <div>
            <div className="eyebrow compact">CAPTURE A THOUGHT</div>
            <h2 id="composer-title">{proposal ? "确认事务" : "记下一件事"}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </div>
        {!proposal ? (
          <>
            <div className="voice-demo">
              <span className="voice-demo-icon">
                <Icon name="mic" size={25} />
              </span>
              <div>
                <strong>
                  {voiceDemo ? "语音体验 · 演示模式" : "语音优先，文字也可以"}
                </strong>
                <p>
                  {voiceDemo
                    ? "点击示例话语填入模拟转写；当前不会调用麦克风。"
                    : "输入自然语言，预览模拟解析结果。"}
                </p>
              </div>
            </div>
            {voiceDemo && (
              <div className="example-list">
                {voiceExamples.map((example) => (
                  <button
                    key={example}
                    onClick={() => {
                      setInput(example);
                      setVoiceDemo(false);
                    }}
                  >
                    “{example}” <Icon name="arrow" size={15} />
                  </button>
                ))}
              </div>
            )}
            <label className="field-label" htmlFor="task-input">
              任务描述
            </label>
            <textarea
              id="task-input"
              rows={3}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：明天下午三点交项目周报，很重要"
            />
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary full-width"
              onClick={prepare}
            >
              生成事务预览 <Icon name="arrow" size={18} />
            </button>
          </>
        ) : (
          <>
            <div className="mock-badge">
              <Icon name="focus" size={16} /> 模拟智能解析 · 保存前可修改
            </div>
            <label className="field-label" htmlFor="proposal-title">
              任务名称
            </label>
            <input
              id="proposal-title"
              className="form-input"
              value={proposal.title}
              onChange={(event) =>
                setProposal({ ...proposal, title: event.target.value })
              }
            />
            <label className="field-label" htmlFor="proposal-due">
              时间
            </label>
            <input
              id="proposal-due"
              className="form-input"
              value={proposal.due}
              onChange={(event) =>
                setProposal({ ...proposal, due: event.target.value })
              }
            />
            <div className="axis-fields">
              <label>
                <input
                  type="checkbox"
                  checked={proposal.important}
                  onChange={(event) =>
                    setProposal({
                      ...proposal,
                      important: event.target.checked,
                    })
                  }
                />{" "}
                重要
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={proposal.urgent}
                  onChange={(event) =>
                    setProposal({ ...proposal, urgent: event.target.checked })
                  }
                />{" "}
                紧急
              </label>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <div className="composer-actions">
              <button
                className="button button-outline"
                onClick={() => setProposal(null)}
              >
                返回修改
              </button>
              <button className="button button-primary" onClick={save}>
                确认添加 <Icon name="check" size={17} />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
