import Link from "next/link";
import { AlertTriangle, Bot, Lock, User } from "lucide-react";
import type { StepRow } from "@/lib/workflows/engine";
import { AGENT_BY_KEY } from "@/lib/agents/definitions";
import { Action } from "@/components/client/action";
import { Status } from "@/components/ui";
import { cn, timeAgo, usd } from "@/lib/cn";

export function StepCard({ step, index, active, productionId, canRun, canApprove }: { step: StepRow; index: number; active: boolean; productionId: string; canRun: boolean; canApprove: boolean }) {
  const human = step.handler === "human_select" || step.handler === "human_review";
  const agent = step.agentKey ? AGENT_BY_KEY[step.agentKey] : null;
  const setupHref = step.blockedOn?.startsWith("capability:") ? "/settings" : step.blockedOn?.startsWith("reference:") || step.blockedOn?.startsWith("canon:") ? `/characters/${step.blockedOn.split(":")[1]}` : step.blockedOn === "budget" ? "/approvals" : null;
  return (
    <div id={`step-${step.key}`} className={cn("rounded-xl border p-3 transition", active ? "border-calm-300/40 bg-calm-400/[0.06]" : "border-white/[0.06] bg-ink-900/60", step.status === "blocked" && "border-bad/30", step.status === "failed" && "border-bad/40")}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 w-5 font-mono text-[11px] text-mist-500">{String(index + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <Link href={`/productions/${productionId}?step=${step.key}`} className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-white">{step.name}</span>
            <Status value={step.status} />
            {step.requiresApproval && !human && <span className="text-[10px] text-warn">approval gate</span>}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-mist-500">
            <span className="inline-flex items-center gap-1">{human ? <User className="size-3" /> : <Bot className="size-3" />}{human ? "Creative director" : agent?.name ?? "deterministic"}</span>
            {step.actualCostCents > 0 && <span>{usd(step.actualCostCents)}</span>}
            {step.attempts > 1 && <span>{step.attempts} attempts</span>}
            {step.providerOverride && <span className="inline-flex items-center gap-1"><Lock className="size-3" />{step.providerOverride}</span>}
            {step.finishedAt && <span>{timeAgo(step.finishedAt)}</span>}
            {step.generation > 1 && <span>run #{step.generation}</span>}
          </div>
          {step.error && (
            <div className={cn("mt-2 flex gap-2 rounded-lg px-2.5 py-1.5 text-xs", step.status === "blocked" || step.status === "failed" ? "bg-bad/10 text-bad" : "bg-white/[0.04] text-mist-400")}>
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {step.error}
                {setupHref && <Link href={setupHref} className="ml-1 font-medium underline">Fix →</Link>}
              </span>
            </div>
          )}
          {canRun && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["failed", "blocked", "cancelled"].includes(step.status) && <Action endpoint={`/api/steps/${step.id}/retry`} size="sm" variant="primary">Retry</Action>}
              {["completed", "awaiting_approval", "changes_requested", "failed"].includes(step.status) && !human && <Action endpoint={`/api/steps/${step.id}/rerun`} size="sm" prompt="Notes for the re-run (optional):">Re-run</Action>}
              {["pending", "blocked", "failed"].includes(step.status) && <Action endpoint={`/api/steps/${step.id}/skip`} size="sm" variant="ghost" prompt="Why skip this step?">Skip</Action>}
              {step.status === "awaiting_approval" && canApprove && (
                <>
                  <Action endpoint={`/api/steps/${step.id}/approve`} size="sm" variant="ok">Approve</Action>
                  <Action endpoint={`/api/steps/${step.id}/changes`} size="sm" variant="danger" prompt="What needs to change?">Request changes</Action>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
