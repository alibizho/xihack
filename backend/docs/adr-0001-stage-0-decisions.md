# ADR 0001：阶段 0 已确认边界

日期：2026-10-02

## 决定

1. 后端是 `backend/` 下的独立 Git 仓库；`xihack/` 和 `D:/proj/laoshiren` 只读。
2. 技术基线为 Python/FastAPI、PostgreSQL、SQLAlchemy/Alembic 与服务端可撤销 Cookie 会话。
3. 任务删除采用永久删除；当前阶段只冻结契约，不实现任务持久化。
4. 所有任务写入（手动和 Agent 发起的创建、编辑、完成、删除）都必须先保存待确认意图；只有确认用例可以执行写入。
5. 首期语音方案已由 [ADR 0004](./adr-0004-local-voice.md) 更新为前端本地转写、后端校准和业务核验；阶段 6 参数见 [ADR 0005](./adr-0005-speech-stage-6.md)。默认不上传音频，用户手动发送。
6. 首期不引入跨对话长期记忆、多 Agent、Redis、LangGraph、向量检索、通知或训练 API。

## 尚未冻结

本阶段历史未决项由后续 ADR 和开发计划记录已确认结果；部署参数仍待对应阶段决定。
