import { Icon } from "../../shared/Icon";
import "./TrainingPage.css";

export function TrainingPage() {
  return (
    <>
      <div className="eyebrow">
        <span className="eyebrow-line" /> A MOMENT TO FOCUS
      </div>
      <div className="page-heading">
        <div>
          <h1>
            专注训练<span className="period">.</span>
          </h1>
          <p>经典 5×5 舒尔特表将在这里开始。</p>
        </div>
      </div>
      <section className="training-placeholder">
        <div className="training-preview" aria-hidden="true">
          {[12, 4, 21, 8, 17, 3, 25, 10, 6].map((number) => (
            <span key={number}>{number}</span>
          ))}
        </div>
        <div className="training-placeholder-copy">
          <span className="mode-tag">经典模式 · 5 × 5</span>
          <h2>训练模块，正在准备。</h2>
          <p>
            经典 5×5 的棋盘、计时与结果正在制作中。完成后可以在这里开始练习。
          </p>
          <div className="training-status">
            <Icon name="focus" size={19} /> 即将加入
          </div>
        </div>
      </section>
    </>
  );
}
