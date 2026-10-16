import { runAgentLoop, type AgentLoopResult } from "./agent/loop";
import { LocalToolExecutor } from "./local-executor";

// The bugzero GitHub Action entrypoint. Runs inside the customer's Actions runner:
// fetches the run context from the bugzero control plane, runs the agent loop against
// the checked-out repo with the customer's own LLM key, opens the PR, and posts the
// result back. Only metadata crosses the network — never source code.

type RunContext = {
  runId: string;
  repoFullName: string;
  branch: string;
  errorTitle: string;
  errorType: string;
  issueUrl: string;
  stacktrace: string;
  provider: string;
  model: string;
  effort: string;
  customInstructions: string | null;
};

// Action `with:` inputs arrive as INPUT_<NAME> env vars (spaces→_, upper-cased).
function input(name: string): string {
  return process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "";
}

// The bugzero workflow passes the URL of the deployment that dispatched it (prod,
// staging, local tunnel); fall back to production if it's missing.
const controlPlane = (input("control-plane") || "https://bugzero.dev").replace(
  /\/+$/,
  "",
);
const runId = input("run-id");
const token = input("callback-token");
const githubToken = input("github-token");

// Keep the per-run callback token out of the job logs.
if (token) console.log(`::add-mask::${token}`);

// This workflow run's page on GitHub, so bugzero can link the live logs.
function runnerUrl(): string | null {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  return GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : null;
}

async function fetchContext(): Promise<RunContext> {
  const url = runnerUrl();
  const res = await fetch(`${controlPlane}/api/runs/${runId}/context`, {
    headers: {
      "x-bugzero-run-token": token,
      ...(url ? { "x-bugzero-runner-url": url } : {}),
    },
  });
  if (!res.ok) throw new Error(`Could not fetch run context (${res.status}).`);
  return (await res.json()) as RunContext;
}

async function postResult(
  result: Partial<AgentLoopResult> & { status: string },
): Promise<void> {
  await fetch(`${controlPlane}/api/runs/${runId}/result`, {
    method: "POST",
    headers: { "x-bugzero-run-token": token, "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
}

async function main(): Promise<void> {
  if (!runId || !token) {
    throw new Error("Missing run-id or callback-token input.");
  }
  const ctx = await fetchContext();

  const provider = ctx.provider === "openai" ? "openai" : "anthropic";
  const apiKey =
    provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Missing ${
        provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"
      } secret. Add it to the repository's Actions secrets.`,
    );
  }

  const [owner, repo] = (
    process.env.GITHUB_REPOSITORY ?? ctx.repoFullName
  ).split("/");

  const executor = new LocalToolExecutor({
    cwd: process.cwd(),
    owner,
    repo,
    baseBranch: ctx.branch,
    githubToken,
  });

  const result = await runAgentLoop(
    {
      provider,
      model: ctx.model,
      effort: ctx.effort,
      apiKey,
      runId,
      repoFullName: ctx.repoFullName,
      branch: ctx.branch,
      errorTitle: ctx.errorTitle,
      errorType: ctx.errorType,
      issueUrl: ctx.issueUrl,
      stacktrace: ctx.stacktrace,
      customInstructions: ctx.customInstructions,
    },
    executor,
  );

  await postResult(result);
  console.log(`bugzero: run ${runId} finished — ${result.status}.`);
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`bugzero: ${message}`);
  await postResult({
    status: "FAILED",
    failureReason: message,
    agentSummary: "",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
  }).catch(() => {});
  process.exit(1);
});
