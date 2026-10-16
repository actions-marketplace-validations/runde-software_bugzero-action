# bugzero auto-fix

**Your AI bug-fixing agent, running in your own GitHub Actions.** When Sentry, PostHog or your own
webhook reports a new error, [bugzero](https://bugzero.dev/?utm_source=github&utm_medium=marketplace&utm_campaign=action-readme)
starts this action in your repository. The agent reads the checked-out code, works out the root cause
with the Claude or GPT model you picked — using **your own API key** — and opens a pull request with
the fix. You review and merge; nothing ships on its own.

[![Latest release](https://img.shields.io/github/v/release/runde-software/bugzero-action?label=release&color=111827)](https://github.com/runde-software/bugzero-action/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-111827)](https://github.com/runde-software/bugzero-action/blob/main/LICENSE)
[![Free plan: 5 fixes/month](https://img.shields.io/badge/bugzero-free%20%C2%B7%205%20fixes%2Fmonth-059669)](https://bugzero.dev/pricing?utm_source=github&utm_medium=marketplace&utm_campaign=action-readme)

![A finished bugzero run: the error, the agent's summary, the pull request it opened and what it cost](https://raw.githubusercontent.com/runde-software/bugzero-action/main/docs/images/run-detail.png)

<sub>A finished run in the bugzero dashboard (demo data).</sub>

## How it works

```
  Sentry · PostHog · custom webhook
              │  new error
              ▼
   bugzero  (the control room)  ── workflow_dispatch ──▶  your repo's GitHub Actions runner
     · which repo, model, instructions                       · this action: the agent reads the checkout
     · daily safety cap                                      · asks the AI model (your API key)
     · every run, in one place                               · opens a pull request
              ▲                                                         │
              └─────── status · PR link · summary · token counts ◀──────┘
```

1. A new error fires in your error tracker.
2. bugzero starts your `bugzero.yml` workflow (`workflow_dispatch`). Its GitHub App can do exactly that
   and nothing else — it has no access to your repository contents.
3. In your runner, this action fetches the error context, lets the agent explore the checked-out code
   (read files, list directories, search) and write a minimal fix.
4. The fix is pushed to a **new branch** and a **pull request** is opened — with *Root Cause*, *Fix*,
   *How to Verify* and *Issue* sections — labelled `bug`, `automated-fix` and `needs-review`.
5. The runner reports back the status, PR link, the agent's summary and token counts.

## What you need

This action is the runner half of bugzero. On its own it does nothing — you also need:

- **A bugzero account** — [free](https://bugzero.dev/register?utm_source=github&utm_medium=marketplace&utm_campaign=action-readme):
  5 fixes a month, no card. Pro is $9/month with unlimited fixes. A *fix* is a run that opened a PR.
- **The bugzero GitHub App** on the repositories you want fixed. Permissions: *Metadata: read* and
  *Actions: read & write* — no repository contents.
- **An error source**: Sentry, PostHog or a custom webhook, with each project mapped to a repository.
- **An AI key**: an Anthropic or OpenAI API key, stored as an Actions secret in the repository. You pay
  your AI provider directly; bugzero never sees the key.

## Setup

The bugzero dashboard walks you through this and links to GitHub with the workflow prefilled. By hand:

1. Add the workflow at `.github/workflows/bugzero.yml` and commit it to your default branch:

   ```yaml
   name: bugzero auto-fix
   run-name: bugzero fix ${{ inputs.run_id }}
   # bugzero starts this workflow when a new error needs a fix. The agent runs here, in
   # your runner — your code and your AI key never leave your infrastructure.
   on:
     workflow_dispatch:
       inputs:
         run_id:
           description: bugzero run id
           required: true
           type: string
         base_branch:
           description: Branch to fix
           required: true
           type: string
         token:
           description: Per-run callback token
           required: true
           type: string
         control_plane:
           description: bugzero URL to report back to
           required: false
           type: string
   # The agent pushes its fix to a branch and opens the pull request with this token.
   # GitHub also needs "Allow GitHub Actions to create and approve pull requests" turned on
   # in the repo's Settings → Actions → General — otherwise the PR is refused.
   permissions:
     contents: write
     pull-requests: write
   jobs:
     fix:
       runs-on: ubuntu-latest
       timeout-minutes: 25
       steps:
         - uses: actions/checkout@v4
           with:
             ref: ${{ inputs.base_branch }}
             fetch-depth: 0
         - uses: runde-software/bugzero-action@v1
           with:
             run-id: ${{ inputs.run_id }}
             callback-token: ${{ inputs.token }}
             control-plane: ${{ inputs.control_plane }}
           env:
             # Add your AI provider key as a repository Actions secret. bugzero never
             # sees it — it only exists here, in your runner.
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
             # Using OpenAI instead? Set OPENAI_API_KEY and remove the line above:
             # OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
   ```

   > Keep this job minimal. The pull request commit stages everything in the working tree, so don't
   > add build or install steps before the action.

2. Add your `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) as a repository **Actions secret**.

3. In the repository's **Settings → Actions → General → Workflow permissions**, turn on
   **Allow GitHub Actions to create and approve pull requests**. GitHub keeps it off by
   default and the workflow's `pull-requests: write` can't override it: without it the fix
   is pushed to a branch, but GitHub answers the pull request with a 403 ("GitHub Actions
   is not permitted to create or approve pull requests") and bugzero reports the run as
   failed, with the branch name.

   If an organization policy locks the option, ask an owner to allow it — or give the
   action a token that may open pull requests (a fine-grained personal access token or a
   GitHub App token with *Contents* and *Pull requests* write access) through the
   `github-token` input:

   ```yaml
   - uses: runde-software/bugzero-action@v1
     with:
       # …the inputs above
       github-token: ${{ secrets.BUGZERO_GITHUB_TOKEN }}
   ```

That's it — map the repo in the bugzero dashboard and new errors become pull requests.

### Inputs

| Input | Required | Description |
| --- | --- | --- |
| `run-id` | yes | The bugzero run id. Passed in by the workflow's `run_id` input. |
| `callback-token` | yes | Per-run token used to fetch the run's context and post its result. Valid for 30 minutes. |
| `control-plane` | no | bugzero base URL. Defaults to `https://bugzero.dev`. |
| `github-token` | no | Token used to push the fix branch and open the PR. Defaults to the workflow's `github.token`. |

The AI key is not an input: set `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the step's `env`.

## The control room

You steer the agent from the bugzero dashboard — not from this workflow.

![The bugzero dashboard: monthly fixes, success rate and the latest runs](https://raw.githubusercontent.com/runde-software/bugzero-action/main/docs/images/dashboard.png)

![The Agent page: model, effort, versioned instructions and the daily safety cap](https://raw.githubusercontent.com/runde-software/bugzero-action/main/docs/images/agent.png)

- **Model and effort** — Claude Opus, Sonnet, Fable, Haiku or GPT, switchable any time.
- **Versioned instructions** — your team's conventions, added to every run. Each publish is a new
  version you can compare, roll back and measure (PRs per version).
- **Safety cap** — the most runs the agent may start per day.
- **Every run** — the error, the root cause, the PR, tokens and cost, with a link to the runner logs.

![Every run in one list, with status, repository, duration and the PR it opened](https://raw.githubusercontent.com/runde-software/bugzero-action/main/docs/images/runs.png)

<sub>Screenshots show demo data.</sub>

## What the agent can do

The agent has four tools, and no others:

| Tool | What it does |
| --- | --- |
| `get_file_contents` | Reads a file in the checkout (up to 50,000 characters). |
| `list_directory` | Lists a directory in the checkout. |
| `search_code` | Searches the checkout with `git grep` (returns up to 20 file names). |
| `create_pull_request` | Writes the fix to a **new branch**, commits it as `bugzero[bot]`, pushes it and opens the PR. |

The agent can't run commands or make network requests of its own, and paths that escape the checkout (`../…`) are rejected. A run is
limited to **30 tool calls** and **20 minutes**. The agent never pushes to your base branch and never
merges: every change arrives as a pull request for you to review.

## What leaves your runner

| Data | Where it goes |
| --- | --- |
| Source code | Read from the checkout in your runner. The files the agent reads are sent to **your AI provider** (Anthropic or OpenAI) under your own API key and terms. **Never sent to bugzero.** |
| AI API key | An Actions secret, used only in your runner to call your provider. bugzero never sees it. |
| Error context (title, type, stack trace, issue link) | From your error tracker to bugzero, then fetched by the runner with the per-run token. It is also part of the prompt sent to your AI provider. |
| Run result | Runner → bugzero: status, PR link and branch, the agent's summary, failure reason, model name and token counts. |
| Actions run URL | Runner → bugzero, so the dashboard can link "Runner logs". |

More in [SECURITY.md](https://github.com/runde-software/bugzero-action/blob/main/SECURITY.md).

## Troubleshooting

| You see | What it means |
| --- | --- |
| `GitHub Actions is not permitted to create or approve pull requests` (403) | Turn on *Allow GitHub Actions to create and approve pull requests* (step 3), or pass a `github-token`. The fix is already on its branch; retry the run from the dashboard. |
| `Could not fetch run context (401)` | The per-run token expired (it lasts 30 minutes from dispatch — for example the job waited too long in a runner queue) or `control_plane` points at the wrong URL. Retry the run from the dashboard. |
| `Missing ANTHROPIC_API_KEY secret` / `OPENAI_API_KEY` | Add the key for the provider chosen on the Agent page as a repository Actions secret. |
| `The AI provider rejected the API key` | The key is invalid, revoked or out of quota. Check it with your provider. |
| `The agent used all 30 tool calls…` / `…20-minute time limit` | The agent couldn't find a confident fix. Try a stronger model or higher effort on the Agent page, or add instructions that point it at the right part of the codebase. |
| `Missing run-id or callback-token input` | The workflow wasn't started by bugzero. Use the workflow from the setup above. |

## Versions

`@v1` always points at the latest 1.x release. For stricter control pin an exact tag
(`runde-software/bugzero-action@v1.5.1`) or a commit SHA. See the [changelog](https://github.com/runde-software/bugzero-action/blob/main/CHANGELOG.md).

## Source

The full TypeScript source is in [`src/`](https://github.com/runde-software/bugzero-action/tree/main/src)
and the bundle GitHub runs is [`dist/index.js`](https://github.com/runde-software/bugzero-action/tree/main/dist).

```sh
npm install
npm run build   # bundles src/main.ts into dist/index.js with esbuild
```

Direct dependencies are pinned. Transitive ones are resolved at install time and file paths appear in
the bundle's comments, so a rebuild can differ from the published bundle byte for byte.

## License and security

[MIT](https://github.com/runde-software/bugzero-action/blob/main/LICENSE). To report a vulnerability,
see [SECURITY.md](https://github.com/runde-software/bugzero-action/blob/main/SECURITY.md).
