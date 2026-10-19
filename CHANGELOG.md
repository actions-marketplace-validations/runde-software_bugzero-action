# Changelog

All notable changes to the bugzero auto-fix action. Versions follow semver; the `v1` tag always points
at the newest 1.x release.

Each release has a `## [x.y.z] - date` heading. `action/publish.sh` fails if the version being
published has no matching section.

## [1.5.1] - 2026-10-16

### Changed
- Documentation only: the README now covers requirements, data flow, troubleshooting and the dashboard,
  and `SECURITY.md` is added.
- The full TypeScript source is published in `src/`, together with the build files (`package.json`,
  `build.mjs`), so the bundle in `dist/` can be audited and rebuilt.

No change in behavior.

## [1.5.0] - 2026-10-15

### Changed
- When GitHub refuses to open the pull request because *Allow GitHub Actions to create and approve pull
  requests* is off, the fix stays pushed on its branch and the run fails with a clear, actionable reason
  and the proposed PR text, instead of a generic error.

## [1.4.0] - 2026-10-15

### Changed
- Reports token usage per model request, so bugzero prices runs with its own up-to-date model catalog.
  New models and price changes no longer need an action release.

## [1.3.0] - 2026-10-15

### Changed
- OpenAI models run through the Responses API (newer GPT models can't call tools through Chat
  Completions).
- Reports the Actions run URL, so the dashboard can link "Runner logs".
- Updated the action description.

## [1.2.0] - 2026-10-15

### Fixed
- Internal fixes (bundle only).

## [1.1.0] - 2026-10-14

### Changed
- The run id and callback token arrive as workflow inputs instead of the dispatch payload. The token is
  masked in the job logs.
- README setup rewritten around the `bugzero.yml` workflow.

## [1.0.1] - 2026-10-14

### Changed
- Runs on Node 24 (was Node 20).
- The default control plane is `https://bugzero.dev`.

## [1.0.0] - 2026-10-14

- First release.
