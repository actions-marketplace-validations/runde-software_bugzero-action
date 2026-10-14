# bugzero agent action

The [bugzero](https://bugzero.dev) bug-fixing agent, running **inside your own GitHub
Actions runner**. When a monitored error fires in Sentry or PostHog, bugzero starts your
`bugzero.yml` workflow (`workflow_dispatch`). This action reads the already checked-out
code from disk, works out the root cause with the Claude or GPT model you picked in the
bugzero dashboard (using your own key, stored as an Actions secret), opens a pull request
with the fix, and reports the result back to bugzero.

You steer the agent from the bugzero dashboard — model, effort, versioned team
instructions and a daily safety cap — without touching this workflow.

**Your source code and your AI key never leave your infrastructure.** bugzero's GitHub
App has no access to repository contents — it can only start this workflow — and bugzero
only ever receives run metadata (status, PR link, the agent's summary, token counts).

## Setup

1. Add the workflow at `.github/workflows/bugzero.yml` and commit it to your default
   branch (the bugzero dashboard links you to GitHub with this file prefilled):

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

2. Add your `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) as a repository **Actions secret**.

That's it — map the repo in the bugzero dashboard and new errors become pull requests.
