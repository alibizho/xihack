import ast
from pathlib import Path


runtime_path = Path(__file__).parents[1] / "src" / "assistant_backend" / "agent" / "runtime.py"
runtime = ast.parse(runtime_path.read_text(encoding="utf-8"))
prompt_assignment = next(
    node
    for node in runtime.body
    if isinstance(node, ast.Assign)
    and any(
        isinstance(target, ast.Name) and target.id == "SYSTEM_PROMPT" for target in node.targets
    )
)
SYSTEM_PROMPT = ast.literal_eval(prompt_assignment.value)


def test_system_prompt_separates_business_rules_from_contextual_output_formatting() -> None:
    headings = (
        "助手职责与语言",
        "事务识别、日期与字段",
        "只读查询与提案工具边界",
        "确认与授权",
        "面向用户的表达",
    )
    assert all(heading in SYSTEM_PROMPT for heading in headings)
    assert "禁止在回复中使用 Markdown" not in SYSTEM_PROMPT
    assert "默认一到三句" not in SYSTEM_PROMPT
    assert "短标题、项目符号和适量强调" in SYSTEM_PROMPT
    assert "propose_create_tasks" in SYSTEM_PROMPT
    assert "不要针对每项分别调用单项创建工具" in SYSTEM_PROMPT


def test_system_prompt_preserves_confirmation_privacy_and_ambiguity_boundaries() -> None:
    assert "绝不能直接创建、修改、完成或删除任务" in SYSTEM_PROMPT
    assert "只能由用户明确确认后" in SYSTEM_PROMPT
    assert "关键行动或对象不明确" in SYSTEM_PROMPT
    assert "不要为该请求生成不完整或猜测的提案" in SYSTEM_PROMPT
    assert "reasoning_content" in SYSTEM_PROMPT
    assert "工具参数" in SYSTEM_PROMPT
    assert "user_id" in SYSTEM_PROMPT
    assert "不虚构用户习惯、任务事实或截止时间" in SYSTEM_PROMPT
    assert "草稿已准备好并提醒审核" in SYSTEM_PROMPT
