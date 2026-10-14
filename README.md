# bugzero agent action

Runs the [bugzero](https://bugzero.dev) fix agent **inside your own GitHub Actions
runner**. When a monitored error fires, bugzero dispatches a `bugzero-fix` event; this
action clones nothing new (the repo is already checked out), reads the code from disk,
asks your own LLM (via a key you store as an Actions secret) for a minimal fix, opens a
pull request, and reports the result back to bugzero.

**Your source code and your AI key never leave your infrastructure.** bugzero only ever
receives run metadata (status, PR link, token counts).

## Setup

1. Add the workflow at `.github/workflows/bugzero.yml` (bugzero can open this PR for you):

   ```yaml
   name: bugzero auto-fix
   on:
     repository_dispatch:
       types: [bugzero-fix]
   permissions:
     contents: write
     pull-requests: write
   jobs:
     fix:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
           with:
             ref: ${{ github.event.client_payload.base_branch }}
             fetch-depth: 0
         - uses: runde-software/bugzero-action@v1
           with:
             run-id: ${{ github.event.client_payload.run_id }}
             callback-token: ${{ github.event.client_payload.token }}
           env:
             ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
   ```

2. Add your `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) as a repository **Actions secret**.

That's it — map the repo in the bugzero dashboard and new errors become pull requests.
