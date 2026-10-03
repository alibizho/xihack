import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import { t, uiLocale } from "../../shared/i18n.ts";
import type { Proposal } from "./agentApi";
import type { Due } from "./agentApi";
import "./ProposalCarousel.css";

function dueParts(due: Due | undefined) {
  if (!due) return { date: t("dateUnset"), time: t("dateUnset") };
  if (due.precision === "date") {
    const date = new Date(`${due.date}T00:00:00Z`);
    return { date: new Intl.DateTimeFormat(uiLocale(), { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" }).format(date), time: t("allDay") };
  }
  const when = new Date(due.at);
  return {
    date: new Intl.DateTimeFormat(uiLocale(), { timeZone: due.timezone, year: "numeric", month: "short", day: "numeric" }).format(when),
    time: new Intl.DateTimeFormat(uiLocale(), { timeZone: due.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(when),
  };
}

function displayCategory(value: string | null | undefined) {
  const category = value?.trim();
  if (!category) return t("uncategorized");
  const known: Record<string, [string, string]> = {
    "学习": ["学习", "Study"], study: ["学习", "Study"], education: ["学习", "Study"],
    "生活": ["生活", "Life"], life: ["生活", "Life"], personal: ["生活", "Life"],
    "工作": ["工作", "Work"], work: ["工作", "Work"],
    "健康": ["健康", "Health"], health: ["健康", "Health"],
    "其他": ["其他", "Other"], other: ["其他", "Other"],
  };
  const translation = known[category.toLowerCase()];
  return translation ? translation[uiLocale() === "en-US" ? 1 : 0] : category;
}

function operationLabel(proposal: Proposal) {
  return proposal.operation === "create" ? t("opCreate") : proposal.operation === "complete" ? t("opComplete") : proposal.operation === "delete" ? t("opDelete") : t("opUpdate");
}

export function ProposalCarousel({ proposals, busy, focusProposalId, onDecide }: {
  proposals: Proposal[];
  busy: boolean;
  focusProposalId?: string;
  onDecide: (proposal: Proposal, accept: boolean) => void;
}) {
  const pending = useMemo(() => proposals.filter((proposal) => proposal.status === "pending" && Date.parse(proposal.expires_at) > Date.now()), [proposals]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const appliedFocusId = useRef<string>();
  const selectedIndex = pending.findIndex((proposal) => proposal.proposal_id === activeId);
  const activeIndex = selectedIndex >= 0 ? selectedIndex : pending.length ? 0 : -1;
  const active = pending[activeIndex];
  const position = active ? proposals.findIndex((proposal) => proposal.proposal_id === active.proposal_id) : -1;

  useEffect(() => {
    if (focusProposalId && focusProposalId !== appliedFocusId.current && pending.some((proposal) => proposal.proposal_id === focusProposalId)) {
      appliedFocusId.current = focusProposalId;
      setActiveId(focusProposalId);
    }
  }, [focusProposalId, pending]);

  useEffect(() => {
    if (pending.some((proposal) => proposal.proposal_id === activeId)) return;
    const oldPosition = proposals.findIndex((proposal) => proposal.proposal_id === activeId);
    const next = pending.find((proposal) => proposals.findIndex((item) => item.proposal_id === proposal.proposal_id) >= oldPosition) || pending[0];
    setActiveId(next?.proposal_id ?? null);
  }, [activeId, pending, proposals]);

  if (!proposals.length) return null;
  if (!pending.length) return <section className="voice-proposal-area" aria-label={t("proposalAreaLabel")}><p className="voice-proposal-empty" role="status">{t("proposalAreaComplete")}</p></section>;

  const task = active?.task || active?.changes;
  const due = dueParts(task?.due);
  return <section className="voice-proposal-area" aria-label={t("proposalAreaLabel")}>
    <div className="voice-proposal-stage">
      {pending.length > 1 && <button className="proposal-nav" type="button" disabled={activeIndex <= 0} onClick={() => setActiveId(pending[activeIndex - 1]?.proposal_id)} aria-label={t("proposalPrevious")}><Icon name="chevronLeft" size={22} /></button>}
      {active && <article className="voice-proposal" key={active.proposal_id} aria-label={`${t("proposalLabel")} ${position + 1}`}>
        <div className="voice-proposal-kind">{operationLabel(active)}</div>
        <h3 className="voice-proposal-title">{task?.title || active.task_id}</h3>
        {task?.description && <p className="voice-proposal-description">{task.description}</p>}
        {task && <dl className="voice-proposal-details">
          {(active.operation === "create" || task.due !== undefined) && <><dt>{t("dateLabel")}</dt><dd>{due.date}{due.time !== t("allDay") && ` · ${due.time}`}</dd></>}
          {(active.operation === "create" || task.category !== undefined) && <><dt>{t("categoryLabel")}</dt><dd>{displayCategory(task.category)}</dd></>}
          {typeof task.importance === "number" && <><dt>{t("importanceLabel")}</dt><dd>{task.importance.toFixed(1)} / 10</dd></>}
          {typeof task.urgency === "number" && <><dt>{t("urgencyLabel")}</dt><dd>{task.urgency.toFixed(1)} / 10</dd></>}
        </dl>}
        <div className="voice-proposal-actions"><button type="button" disabled={busy} onClick={() => onDecide(active, false)}>{t("cancel")}</button><button type="button" disabled={busy} onClick={() => onDecide(active, true)}>{t("confirmWrite")}</button></div>
      </article>}
      {pending.length > 1 && <button className="proposal-nav" type="button" disabled={activeIndex < 0 || activeIndex >= pending.length - 1} onClick={() => setActiveId(pending[activeIndex + 1]?.proposal_id)} aria-label={t("proposalNext")}><Icon name="chevronRight" size={22} /></button>}
    </div>
    {proposals.length > 1 && <p className="proposal-progress" aria-live="polite">{position + 1} / {proposals.length}</p>}
  </section>;
}
