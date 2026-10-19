import {
  createAdapter,
  type ModelTurn,
  type ToolCall,
  type ToolResultInput,
} from "./llm";
import { AGENT_TOOLS } from "./tools";
import { buildSystemPrompt, buildUserMessage } from "./prompts";
import { estimateCostUsd, type NormalizedUsage, type Provider } from "./cost";

// The agentic loop. It runs inside the customer's GitHub Actions runner and depends
// only on the LLM adapters, the prompt/tool definitions, and cost math. All
// repository I/O is behind `ToolExecutor` (implemented over the local checkout).

const MAX_TOOL_CALLS = 30;
// 20 min — leaves headroom under the workflow's 25-minute job timeout to open the PR
// and report the result.
const MAX_WALL_CLOCK_MS = 20 * 60_000;

const TIME_LIMIT_REASON = "The agent hit its 20-minute time limit before opening a pull request.";

// A provider error (bad key, unknown model, outage…) as a failure reason for the run.
function describeModelError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 400);
  if (status === 401 || status === 403) {
    return `The AI provider rejected the API key (${status}). Check the key in your repository's Actions secrets.`;
  }
  return `The AI provider returned an error${status ? ` (${status})` : ""}: ${message}`;
}

// The terminal statuses the loop can produce (mirrors the control plane's RunStatus
// values the result callback accepts).
export type AgentStatus = "SUCCESS" | "FAILED";

export type AgentLoopResult = {
  status: AgentStatus;
  prUrl?: string | null;
  prNumber?: number | null;
  prBranch?: string | null;
  agentSummary: string;
  failureReason?: string | null;
  // A code the run page translates (see ToolFailure.code); null when only the
  // English failureReason is known.
  failureCode?: string | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  // Token usage of each model request, so bugzero can price the run itself.
  usageByCall: NormalizedUsage[];
  provider?: string | null;
  model?: string | null;
};

// Everything the loop needs about the run — an explicit spec, no Prisma types.
export type AgentJob = {
  provider: Provider;
  model: string;
  effort: string;
  apiKey: string;
  runId: string; // keys the provider's prompt cache to this run
  repoFullName: string;
  branch: string;
  errorTitle: string;
  errorType: string;
  issueUrl: string;
  stacktrace: string;
  customInstructions?: string | null;
};

export type CreatePrInput = {
  branch_name: string;
  pr_title: string;
  pr_body: string;
  files: Array<{ path: string; content: string }>;
};
export type PrResult = { prUrl: string; prNumber: number; prBranch: string };

// Why a tool call ended the run for good — a problem retrying can't fix. The loop
// stops and reports the run as failed with this reason instead of letting the model
// try again.
export type ToolFailure = {
  // Names the failure for the run page, which shows it in the account's language
  // (the app only accepts the codes it knows).
  code: string | null;
  reason: string;
  // The fix was already pushed to this branch.
  branch?: string;
  // Text worth keeping for the reviewer, shown as the run's summary.
  summary?: string;
};

// One tool invocation's result. `pr` is set when a pull request was opened, which
// ends the loop; so does `fatal`.
export type ToolOutcome = {
  content: string;
  isError: boolean;
  pr?: PrResult;
  fatal?: ToolFailure;
};

// The single seam between the loop and repository I/O (implemented by the Action's
// filesystem/git executor).
export interface ToolExecutor {
  runTool(call: ToolCall): Promise<ToolOutcome>;
}

export async function runAgentLoop(
  job: AgentJob,
  executor: ToolExecutor,
  opts?: { maxToolCalls?: number; maxWallClockMs?: number },
): Promise<AgentLoopResult> {
  const maxToolCalls = opts?.maxToolCalls ?? MAX_TOOL_CALLS;
  const maxWallClockMs = opts?.maxWallClockMs ?? MAX_WALL_CLOCK_MS;

  const adapter = createAdapter(job.provider, {
    apiKey: job.apiKey,
    model: job.model,
    effort: job.effort,
    cacheKey: `bugzero-${job.runId}`,
    system: buildSystemPrompt({
      repoFullName: job.repoFullName,
      branch: job.branch,
      customInstructions: job.customInstructions,
    }),
    userMessage: buildUserMessage({
      errorTitle: job.errorTitle,
      errorType: job.errorType,
      issueUrl: job.issueUrl,
      stacktrace: job.stacktrace,
      repoFullName: job.repoFullName,
      branch: job.branch,
    }),
    tools: AGENT_TOOLS,
  });

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  let summaryText = "";
  let toolCalls = 0;
  let pr: PrResult | null = null;
  let fatal: ToolFailure | null = null;
  const usageByCall: NormalizedUsage[] = [];
  let stopReason: string | null = null; // why the loop ended without a PR, if known
  const deadline = Date.now() + maxWallClockMs;

  while (toolCalls < maxToolCalls) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      stopReason = TIME_LIMIT_REASON;
      break;
    }

    // Every call gets only the time left, so one slow response can't outlive the
    // job and leave the run unreported.
    let turn: ModelTurn;
    try {
      turn = await adapter.next(AbortSignal.timeout(remaining));
    } catch (err) {
      stopReason =
        Date.now() >= deadline - 1000 ? TIME_LIMIT_REASON : describeModelError(err);
      break;
    }
    inputTokens +=
      turn.usage.inputFull + turn.usage.cacheWrite + turn.usage.cacheRead;
    outputTokens += turn.usage.output;
    usageByCall.push(turn.usage);
    cost += estimateCostUsd(job.model, job.provider, turn.usage);
    if (turn.text) summaryText += turn.text;

    if (turn.failure) {
      stopReason = turn.failure;
      break;
    }
    if (turn.done || turn.toolCalls.length === 0) break;

    const results: ToolResultInput[] = [];
    for (const call of turn.toolCalls) {
      toolCalls++;
      let outcome: ToolOutcome;
      try {
        outcome = await executor.runTool(call);
      } catch (err) {
        outcome = {
          content: `Error executing ${call.name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          isError: true,
        };
      }
      if (outcome.pr) pr = outcome.pr;
      if (outcome.fatal) fatal = outcome.fatal;
      results.push({
        id: call.id,
        content: outcome.content,
        isError: outcome.isError,
      });
    }

    adapter.submitToolResults(results);
    if (pr || fatal) break; // PR opened, or it can't be — done
  }

  const summary = summaryText.trim();
  let status: AgentStatus;
  let failureReason: string | null = null;
  if (pr) {
    status = "SUCCESS";
  } else {
    status = "FAILED";
    failureReason =
      fatal?.reason ??
      stopReason ??
      (toolCalls >= maxToolCalls
        ? `The agent used all ${maxToolCalls} tool calls without opening a pull request.`
        : null) ??
      (summary.slice(0, 1000) ||
        "The agent finished without opening a pull request.");
  }

  // The proposed pull request text is the reviewer's only record of the fix when the
  // PR itself couldn't be opened.
  const kept = [summary, fatal?.summary].filter(Boolean).join("\n\n");

  return {
    status,
    prUrl: pr?.prUrl ?? null,
    prNumber: pr?.prNumber ?? null,
    prBranch: pr?.prBranch ?? fatal?.branch ?? null,
    agentSummary: kept || (pr ? "Pull request opened." : "No summary."),
    failureReason,
    failureCode: fatal?.code ?? null,
    inputTokens,
    outputTokens,
    estimatedCostUsd: cost,
    usageByCall,
    provider: job.provider,
    model: job.model,
  };
}
