import ast
from pathlib import Path


runtime_path = Path(__file__).parents[1] / "src" / "assistant_backend" / "agent" / "runtime.py"
runtime = ast.parse(runtime_path.read_text(encoding="utf-8"))
prompt_assignment = next(
    node
    for node in runtime.body
    if isinstance(node, ast.Assign)
    and any(isinstance(target, ast.Name) and target.id == "SYSTEM_PROMPT" for target in node.targets)
)
SYSTEM_PROMPT = ast.literal_eval(prompt_assignment.value)


def test_system_prompt_applies_plain_language_style_to_every_user_facing_reply() -> None:
    assert "全局硬约束" in SYSTEM_PROMPT
    assert "用户使用简体中文时用简体中文，使用英文时用自然英文" in SYSTEM_PROMPT
    assert "不把消息中应用附加的本地时间或时区上下文当作用户语言" in SYSTEM_PROMPT
    assert "禁止在回复中使用 Markdown" in SYSTEM_PROMPT
    assert "不重复卡片里的任务详情" in SYSTEM_PROMPT
    assert "提案必须等待用户通过确认接口明确确认" in SYSTEM_PROMPT
