import { useEffect, useRef, useState, type FormEvent } from "react";
import { createConversation, getAgentRun, getConversation, getProposal, listConversations, submitAgentMessage, type Conversation, type ConversationDetail, type TaskProposal } from "../../shared/backendApi";
import "./AssistantPage.css";

type Props = { signedIn: boolean; openAccount: () => void; onProposal: (proposal: TaskProposal) => void };

export function AssistantPage({ signedIn, openAccount, onProposal }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<TaskProposal[]>([]);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!signedIn) { setConversations([]); setSelected(null); return; }
    listConversations().then((items) => { if (active.current) setConversations(items); }).catch((reason) => setError((reason as Error).message));
  }, [signedIn]);

  async function open(id: string) {
    setError("");
    try {
      const detail = await getConversation(id);
      setSelected(detail);
      const ids = [...new Set(detail.messages.filter((message) => message.role === "assistant").flatMap((message) => message.content.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi) || []))].slice(-8);
      const found = await Promise.allSettled(ids.map(getProposal));
      if (active.current) setProposals(found.flatMap((result) => result.status === "fulfilled" && result.value.status === "pending" ? [result.value] : []));
    }
    catch (reason) { setError((reason as Error).message); }
  }
  async function addConversation() {
    setBusy(true); setError("");
    try { const item = await createConversation(); setConversations((current) => [item, ...current]); await open(item.conversation_id); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!selected || !text) return;
    setBusy(true); setError("");
    try {
      const { run_id } = await submitAgentMessage(selected.conversation_id, text);
      setInput("");
      await open(selected.conversation_id);
      for (let attempt = 0; attempt < 95 && active.current; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const run = await getAgentRun(run_id);
        if (["completed", "failed", "cancelled"].includes(run.status)) {
          await open(selected.conversation_id);
          if (run.status !== "completed") setError("助手这次没有完成回答，请稍后换种说法重试。");
          break;
        }
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { if (active.current) setBusy(false); }
  }

  return <div className="assistant-page">
    <header className="assistant-intro"><span className="section-kicker">事务 / 助手</span><h1>和易忆聊聊事务</h1><p>查询已有事务，或请助手准备待确认的更改。事务工具正在联调；失败时可在事务页手动操作。</p></header>
    {!signedIn ? <section className="assistant-empty"><p>登录后可创建对话、查询事务或让助手准备待确认的更改。</p><button className="button button-primary" onClick={openAccount}>去登录</button></section> : <div className="assistant-layout">
      <aside className="assistant-sidebar"><div><strong>对话</strong><button className="button button-outline" onClick={() => void addConversation()} disabled={busy}>新对话</button></div>{conversations.map((item) => <button key={item.conversation_id} className={item.conversation_id === selected?.conversation_id ? "selected" : ""} onClick={() => void open(item.conversation_id)}>{item.title}</button>)}</aside>
      <section className="assistant-chat" aria-label="对话内容">{selected ? <><h2>{selected.title}</h2><div className="assistant-messages" aria-live="polite">{selected.messages.length ? selected.messages.map((message) => <div key={message.message_id} className={`assistant-message ${message.role}`}><span>{message.role === "user" ? "你" : "易忆"}</span><p>{message.content}</p></div>) : <p className="assistant-placeholder">试着问：「我今天还有哪些事务？」</p>}{proposals.map((proposal) => <div className="assistant-proposal" key={proposal.proposal_id}><strong>待确认的事务提案</strong><span>{proposal.task?.title || proposal.changes?.title || proposal.operation}</span><button className="button button-outline" onClick={() => onProposal(proposal)}>查看并确认</button></div>)}{busy && <p className="assistant-placeholder">助手正在整理回答…</p>}</div><form onSubmit={(event) => void send(event)}><label htmlFor="assistant-input">你的问题</label><textarea id="assistant-input" value={input} onChange={(event) => setInput(event.target.value)} maxLength={8000} rows={3} disabled={busy} placeholder="查询事务，或请助手准备一项更改" /><button className="button button-primary" disabled={busy || !input.trim()}>发送</button></form></> : <p className="assistant-placeholder">选择一个对话，或开始新对话。</p>}</section>
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
}
