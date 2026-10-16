import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolCall } from "./agent/llm";
import type {
  ToolExecutor,
  ToolOutcome,
  ToolFailure,
  CreatePrInput,
  PrResult,
} from "./agent/loop";

const execFileAsync = promisify(execFile);
const MAX_FILE_CHARS = 50_000;

// The `code` the app translates for the repo setting that stops Actions from opening
// pull requests (Runs.failures.prNotPermitted); it must match the app's list.
const PR_NOT_PERMITTED = "pr_not_permitted";

class GitHubApiError extends Error {
  constructor(
    path: string,
    readonly status: number,
    readonly detail: string,
  ) {
    super(`GitHub API ${path} failed (${status}): ${detail.slice(0, 300)}`);
  }
}

// The fix is committed and pushed, but the pull request couldn't be opened.
class PrNotOpenedError extends Error {
  constructor(readonly failure: ToolFailure) {
    super(failure.reason);
  }
}

// GitHub's 403 when the repository (or its organization) has "Allow GitHub Actions
// to create and approve pull requests" switched off — which it is by default. The
// workflow's `permissions: pull-requests: write` can't override it.
function isPrCreationDisabled(err: unknown): boolean {
  return (
    err instanceof GitHubApiError &&
    err.status === 403 &&
    /not permitted to create or approve pull requests/i.test(err.detail)
  );
}

// Runs the agent's tools against the repository already checked out on the runner's
// disk — reads via the filesystem, search via `git grep`, and the PR via git + the
// runner's GITHUB_TOKEN. No code ever leaves the runner.
export class LocalToolExecutor implements ToolExecutor {
  constructor(
    private opts: {
      cwd: string;
      owner: string;
      repo: string;
      baseBranch: string;
      githubToken: string;
    },
  ) {}

  async runTool(call: ToolCall): Promise<ToolOutcome> {
    switch (call.name) {
      case "get_file_contents":
        return {
          content: await this.readFile(String(call.input.path ?? "")),
          isError: false,
        };
      case "list_directory":
        return {
          content: await this.listDir(String(call.input.path ?? "")),
          isError: false,
        };
      case "search_code":
        return {
          content: await this.search(String(call.input.query ?? "")),
          isError: false,
        };
      case "create_pull_request": {
        try {
          const pr = await this.createPr(call.input as unknown as CreatePrInput);
          return {
            content: JSON.stringify({ pr_url: pr.prUrl, pr_number: pr.prNumber }),
            isError: false,
            pr,
          };
        } catch (err) {
          // The branch is pushed but GitHub wouldn't open the PR. Another attempt
          // would only push another branch, so this ends the run.
          if (err instanceof PrNotOpenedError) {
            return { content: err.failure.reason, isError: true, fatal: err.failure };
          }
          throw err;
        }
      }
      default:
        return { content: `Unknown tool: ${call.name}`, isError: true };
    }
  }

  // Resolve a repo-relative path under cwd, rejecting anything that escapes it.
  private resolve(rel: string): string {
    const root = path.resolve(this.opts.cwd);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      throw new Error(`Path "${rel}" is outside the repository.`);
    }
    return abs;
  }

  private async readFile(rel: string): Promise<string> {
    try {
      const abs = this.resolve(rel);
      if ((await fs.stat(abs)).isDirectory()) {
        return `"${rel}" is a directory. Use list_directory to see its contents.`;
      }
      const text = await fs.readFile(abs, "utf8");
      return text.length > MAX_FILE_CHARS
        ? `${text.slice(0, MAX_FILE_CHARS)}\n\n…[truncated — file is ${text.length} chars]`
        : text;
    } catch (err) {
      if (isCode(err, "ENOENT")) {
        return `File not found: "${rel}". Use list_directory to find the correct path.`;
      }
      throw err;
    }
  }

  private async listDir(rel: string): Promise<string> {
    try {
      const abs = this.resolve(rel);
      const entries = await fs.readdir(abs, { withFileTypes: true });
      const visible = entries
        .filter((e) => e.name !== ".git")
        .sort((a, b) => a.name.localeCompare(b.name));
      if (visible.length === 0) return `"${rel || "."}" is empty.`;
      return visible
        .map((e) => `${e.isDirectory() ? "[dir] " : "[file] "}${e.name}`)
        .join("\n");
    } catch (err) {
      if (isCode(err, "ENOENT")) {
        return `Directory not found: "${rel}". Try "" for the repo root.`;
      }
      if (isCode(err, "ENOTDIR")) {
        return `"${rel}" is a file, not a directory. Use get_file_contents to read it.`;
      }
      throw err;
    }
  }

  private async search(query: string): Promise<string> {
    if (!query.trim()) return "Provide a non-empty search query.";
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["grep", "-l", "-I", "-F", "-e", query],
        { cwd: this.opts.cwd, maxBuffer: 4 * 1024 * 1024 },
      );
      const files = stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);
      return files.length ? files.join("\n") : `No results for "${query}".`;
    } catch (err) {
      // git grep exits 1 when there are no matches — that's not an error.
      if (isExit(err, 1)) return `No results for "${query}".`;
      return "Code search unavailable. Use list_directory and get_file_contents to explore instead.";
    }
  }

  private async git(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.opts.cwd,
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  }

  private async remoteBranchExists(name: string): Promise<boolean> {
    try {
      await this.git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${name}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async createPr(input: CreatePrInput): Promise<PrResult> {
    for (const f of input.files) {
      const abs = this.resolve(f.path);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, f.content, "utf8");
    }

    await this.git(["config", "user.name", "bugzero[bot]"]);
    await this.git(["config", "user.email", "bot@bugzero.dev"]);

    // A retry after a failed run finds the earlier attempt's branch on the remote;
    // pushing the same name would be rejected, so pick a fresh one.
    let branch = input.branch_name;
    if (await this.remoteBranchExists(branch)) {
      branch = `${input.branch_name}-${Date.now().toString(36)}`;
    }
    try {
      await this.git(["checkout", "-b", branch]);
    } catch {
      branch = `${input.branch_name}-${Date.now().toString(36)}`;
      await this.git(["checkout", "-b", branch]);
    }
    await this.git(["add", "-A"]);
    await this.git(["commit", "-m", `${input.pr_title}\n\nAutomated fix by bugzero`]);
    await this.git(["push", "-u", "origin", branch]);

    let pr: { html_url: string; number: number };
    try {
      pr = await this.githubApi<{ html_url: string; number: number }>(
        `/repos/${this.opts.owner}/${this.opts.repo}/pulls`,
        {
          title: input.pr_title,
          body: input.pr_body,
          head: branch,
          base: this.opts.baseBranch,
        },
      );
    } catch (err) {
      const summary = `${input.pr_title}\n\n${input.pr_body}`;
      if (isPrCreationDisabled(err)) {
        throw new PrNotOpenedError({
          code: PR_NOT_PERMITTED,
          reason:
            `The fix was committed and pushed to branch "${branch}", but GitHub refused to open ` +
            `the pull request: this repository doesn't allow GitHub Actions to create pull requests. ` +
            `Turn on "Allow GitHub Actions to create and approve pull requests" in the repository's ` +
            `Settings → Actions → General (an organization owner may have to allow it for the ` +
            `organization first), then retry the run — or open the pull request from the branch yourself.`,
          branch,
          summary,
        });
      }
      const why = err instanceof Error ? err.message : String(err);
      throw new PrNotOpenedError({
        code: null,
        reason: `The fix was committed and pushed to branch "${branch}", but opening the pull request failed: ${why}`,
        branch,
        summary,
      });
    }

    // Labels are best-effort.
    await this.githubApi(
      `/repos/${this.opts.owner}/${this.opts.repo}/issues/${pr.number}/labels`,
      { labels: ["bug", "automated-fix", "needs-review"] },
    ).catch(() => {});

    return { prUrl: pr.html_url, prNumber: pr.number, prBranch: branch };
  }

  private async githubApi<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`https://api.github.com${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.opts.githubToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "bugzero-action",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new GitHubApiError(path, res.status, detail);
    }
    return (await res.json()) as T;
  }
}

function isCode(e: unknown, code: string): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === code
  );
}
function isExit(e: unknown, code: number): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === code
  );
}
