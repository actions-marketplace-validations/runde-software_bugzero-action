# Security policy

This is the security policy for the **bugzero auto-fix** GitHub Action (`runde-software/bugzero-action`).
It runs inside your repository's GitHub Actions runner, so we want you to be able to see exactly what it
does, what it can touch and what leaves the runner.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

- Use GitHub's private reporting: **Security → Report a vulnerability** on this repository, or
- email [contact@bugzero.dev](mailto:contact@bugzero.dev) with the subject `[security]`.

Include what you found, how to reproduce it and which version (`v1.x.y`) you tested. We'll acknowledge
your report, keep you informed while we work on a fix and credit you in the release notes if you'd like.

## Supported versions

Security fixes go into the latest `1.x` release, and the `v1` tag is moved to it. If you pin an exact
tag or a commit SHA, update the pin when a security release is published (see the
[changelog](CHANGELOG.md)).

## How the action is built to limit risk

The action is the "hands" of bugzero's agent. Its design keeps the blast radius small:

- **It runs in your runner, under your account.** bugzero's GitHub App has only *Metadata: read* and
  *Actions: read & write*. It can start the `bugzero.yml` workflow; it cannot read repository contents.
- **The agent has four tools** and nothing else (see [`src/agent/tools.ts`](src/agent/tools.ts)):
  `get_file_contents`, `list_directory`, `search_code` and `create_pull_request`. It cannot run shell
  commands or make network requests of its own. File paths that escape the checkout are rejected.
- **It only writes through a pull request.** `create_pull_request` writes the fix to a new branch,
  commits it as `bugzero[bot]`, pushes that branch and opens a PR. It never pushes to your base branch
  and never merges. A human reviews every change.
- **It is bounded.** At most 30 tool calls, 20 minutes of wall-clock time (the workflow template adds a
  25-minute job timeout) and 50,000 characters per file read.
- **Your AI key stays in your runner.** It is read from `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the
  step's environment and is never sent to bugzero.

### What leaves the runner

| Data | Destination |
| --- | --- |
| Files the agent reads, the error title / type / stack trace / issue link | Your AI provider (Anthropic or OpenAI), under your API key and your agreement with them. |
| Status, PR URL / number / branch, the agent's summary, failure reason, model name, per-request token counts | bugzero (`POST /api/runs/<id>/result`). The summary is the agent's own text and can mention file names or short code fragments. |
| The Actions run URL | bugzero, so the dashboard can link "Runner logs". |
| Fix branch, commit and PR | Your repository, through the GitHub API with the workflow's token (or the `github-token` you pass). |

**Source code is not sent to bugzero.** It is sent to the AI provider you chose, because that provider's
model is what reads it. Review your provider's data-handling terms the way you would for any tool that
sends code to an LLM. bugzero is not a sub-processor of that traffic; the relationship is between you and
the provider.

### The per-run token

bugzero starts the workflow with a **per-run callback token** passed as a `workflow_dispatch` input:

- It is an HMAC-SHA256 signature over the run id and an expiry, **valid for 30 minutes**.
- It is scoped to **one run**: it lets the runner fetch that run's error context and post that run's
  result, and nothing else. It contains no secret that would work for another run or another team.
- The action masks it in the job logs (`::add-mask::`).
- Workflow inputs are shown on the workflow run page, so anyone who can read the repository's Actions
  runs can see the token until it expires.

## Hardening recommendations

None of these are required, but they are cheap and worth considering.

1. **Review the PRs like any outside contribution.** Error messages, stack traces and code comments are
   untrusted input to a language model. Use branch protection and required reviews, and consider
   `CODEOWNERS` for sensitive paths.
2. **Keep the bugzero job minimal.** The PR commit stages everything in the working tree
   (`git add -A`). Don't run build, install or code-generation steps before the action, and don't write
   secrets to disk in that job.
3. **Don't grant the `workflows` permission** to the token you pass as `github-token`. GitHub refuses
   pushes that modify workflow files unless the token has it, which keeps the agent away from
   `.github/workflows`.
4. **Scope the AI key.** Store it as a repository (or environment) secret, use a dedicated key for
   bugzero and set a spend limit at your AI provider. bugzero's daily safety cap limits how many runs
   start; the provider-side limit caps what a key can spend.
5. **Pin the version** if you need reproducibility: an exact tag (`@v1.5.1`) or a commit SHA instead of
   the moving `@v1`.
6. **Use a minimal token.** If you pass `github-token`, use a fine-grained personal access token or a
   GitHub App token limited to the repositories involved, with *Contents* and *Pull requests* write
   access only.

## Verifying what runs

- The full TypeScript source is in [`src/`](src), and the bundle that GitHub executes is
  [`dist/index.js`](dist/index.js), built with esbuild (`npm install && npm run build`). The bundle is
  not minified.
- Every release is a tag (`v1.x.y`). `v1` is a moving tag that points at the newest 1.x release.
- Releases are published from the bugzero repository by a script that builds the bundle, copies this
  source and tags the result.

For the bugzero service itself (accounts, billing, the dashboard), see the
[Privacy Policy](https://bugzero.dev/privacy) and [Terms](https://bugzero.dev/terms).
