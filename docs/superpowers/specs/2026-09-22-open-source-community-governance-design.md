# Open-source community governance design

Date: 2026-09-22

Status: approved design, pending implementation

## 1. Problem and goal

Velocity Rush needs to become a public repository whose community contribution process requires all new code to be authored by `Qwen3.8-flash-next`.

The project already has deterministic tests, visual audit tooling, no-leak verification, functional verification, and performance evidence. This design adds the public-facing governance layer without changing game behavior or adding runtime dependencies.

## 2. Scope

The implementation covers:

- changing the repository to public;
- adding open-source licensing and community documentation;
- adding issue and pull-request templates;
- adding a self-reported model-provenance attestation for pull requests;
- validating that attestation with a base-controlled GitHub Actions status check;
- running the existing quality gates in CI;
- protecting `main` with pull-request review and required checks.

The design covers all new contributions made from the time the governance policy is merged. Existing commits are grandfathered and are not retroactively rewritten.

## 3. Non-goals

This design does not:

- claim GitHub can cryptographically prove which AI model authored code;
- require every commit in the existing history to satisfy the model policy;
- automatically rewrite commit history;
- add runtime dependencies;
- change gameplay, rendering, tests, screenshots, or performance behavior;
- add secrets, self-hosted runners, deployment publishing, or npm publication;
- enforce the Qwen policy through commit signatures or commit metadata.

## 4. Accepted decisions

| Topic | Decision |
|---|---|
| Visibility | Public |
| License | MIT |
| Copyright holder | `hunghdvn` |
| Copyright year | 2026 |
| External code PRs | Accepted with maintainer review |
| Model policy | New code contributions must be authored by `Qwen3.8-flash-next` |
| Provenance evidence | Required PR attestation plus maintainer review |
| Existing history | Grandfathered |
| CI | GitHub Actions, public repository workflows, no secrets |
| Policy check | Base-controlled status check named `Qwen provenance` |
| Branch protection | PR plus one approving review plus required status checks |
| Human acceptance | Maintainer manually reviews provenance claims and gameplay/feel/audio acceptance items |

## 5. Trust model and limitations

A pull-request attestation is a trustworthy **statement made by the contributor**, not proof of the actual tool used to produce the code. GitHub does not have access to the contributor's local editor or model session and cannot verify model provenance from source code alone.

The enforced layers are:

1. The PR template requires an exact self-reported attestation.
2. A base-controlled workflow checks the PR body and changed files.
3. The `Qwen provenance` commit status is required on `main`.
4. A maintainer must review and approve the contribution.
5. A malicious fork can alter its own ordinary `pull_request` CI job to produce a false green status; therefore the base-controlled policy check and human review are the final gates, while ordinary CI is the regression gate.

The policy is explicit that submitting a false attestation violates the code of conduct and may cause contribution rejection, removal, or future exclusion.

## 6. Public conversion and package metadata

The repository becomes public through the GitHub repository settings API:

```bash
gh api --method PATCH repos/hunghdvn/car-racing -f private=false
```

After `package.json` is updated, it has at least:

```json
{
  "private": false,
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/hunghdvn/car-racing.git"
  },
  "homepage": "https://github.com/hunghdvn/car-racing#readme",
  "keywords": [
    "arcade-racing",
    "3d",
    "webgl",
    "threejs"
  ]
}
```

The repository is assigned these topics:

```text
arcade-game
3d
webgl
threejs
open-source
qwen
qwen3-8-flash-next
```

Private vulnerability reporting is enabled through the GitHub repository security settings.

## 7. Community documentation

### `LICENSE`

MIT license with:

```text
Copyright © 2026 hunghdvn
```

### `README.md`

The README contains:

- project summary and scope: one track, six cars, one race, browser-based 3D arcade racing;
- screenshots drawn from the committed visual battery;
- technology stack: Vite, TypeScript strict mode, Three.js `r168`, WebGl2;
- controls;
- local quickstart:
  ```bash
  npm install
  npm run dev
  npm run test
  npm run build
  npm run functional
  npm run shots
  npm run audit
  ```
- an open-source contribution section;
- a clear statement that new code must be generated with `Qwen3.8-flash-next` and self-reported through the PR attestation.

### `CONTRIBUTING.md`

The guide requires:

- an issue or discussion before a substantive change;
- one focused change per PR;
- new code, tests, workflows, package metadata, and game assets to be authored by `Qwen3.8-flash-next`;
- documentation-only PRs may omit the code attestation;
- all local gates to pass before requesting review;
- visual changes to update/validate the screenshot battery;
- performance-relevant changes to include Gate-P evidence or explain why the existing evidence remains valid;
- conventional commit subjects;
- no unrelated refactoring in a focused PR.

### `CODE_OF_CONDUCT.md`

A Contributor Covenant-style code of conduct applies. It includes:

- expectations for constructive collaboration;
- reporting channel to the maintainer;
- consequences for harassment, spam, malicious AI-generated content, and false provenance attestation;
- maintainer authority to reject, revert, or remove contributions and restrict future participation.

### `SECURITY.md`

Security reports go through GitHub private security advisories. The file:

- tells reporters not to open public issues for vulnerabilities;
- requests browser, operating system, GPU/renderer stack, reproduction steps, and logs;
- states that the maintainer will acknowledge and triage reports.

### Issue templates

```text
.github/ISSUE_TEMPLATE/config.yml
.github/ISSUE_TEMPLATE/bug-report.yml
.github/ISSUE_TEMPLATE/feature-request.yml
```

`config.yml` disables blank issues.

The bug form captures:

- expected behavior;
- actual behavior;
- reproducible steps;
- frequency;
- browser, operating system, GPU/renderer stack;
- command output or console logs;
- relevant screenshot/performance evidence.

The feature form captures:

- problem and user need;
- proposed behavior;
- explicit out-of-scope changes;
- whether the submitter accepts the Qwen-only code authorship policy;
- evidence or prototype.

### Pull-request template

`.github/PULL_REQUEST_TEMPLATE.md` contains the following exact required lines:

```markdown
- [ ] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.
- Model ID: Qwen3.8-flash-next
- [ ] This pull request changes documentation/content only.
```

The contributor must change a `[ ]` to `[x]` for a checkbox. The model field is always present with the exact value, and the policy script validates the actual checked state rather than trusting that the user edited the template correctly.

## 8. Provenance policy behavior

### Source of truth

The policy logic is implemented in:

```text
scripts/pr-policy.mjs
```

The GitHub Actions entry point is:

```text
scripts/check-pr-policy.mjs
```

The entry point imports `scripts/pr-policy.mjs` directly; it is responsible only for:

- reading the GitHub event context;
- fetching changed files through the REST API;
- calling `evaluatePullRequestPolicy`;
- posting the commit status;
- exiting with the result.

The pure policy module is tested directly and does not know about Actions or HTTP. The existing test registration file `tests/all.ts` must import the new `tests/cases/community.test.ts` case file so it participates in `npm run test`.

### Changed-file classification

A pull-request file is documentation-only only when its lowercase path ends with `.md`.

Every other path is treated as code or project behavior. This includes:

- `.ts`, `.js`, `.mjs`, `.cjs`;
- `.json`;
- `.yml`, `.yaml`;
- `.css`, `.html`;
- `.png`, `.jpg`, `.jpeg`, `.webp`, `.glb`, `.gltf`;
- workflows and repository configuration files.

If a PR exposes more than 300 changed files, the policy fails with "pull request is too large for reliable provenance classification; split the change." This is deliberate because GitHub's PR file listing is bounded and the policy must not make a decision from incomplete data.

### Required attestations

Let:

```text
CODE_ATTESTATION = "- [x] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next."
MODEL_FIELD       = "- Model ID: Qwen3.8-flash-next"
DOCS_ONLY         = "- [x] This pull request changes documentation/content only."
```

Each line is evaluated after normalizing CRLF to LF and trimming trailing whitespace from every line.

### Rules

1. If the PR has zero files, fail.
2. If all files are `.md`:
   - pass when `DOCS_ONLY` is present;
   - otherwise pass when both `CODE_ATTESTATION` and `MODEL_FIELD` are present;
   - otherwise fail with the missing attestation explanation.
3. If any file is not `.md`:
   - pass only when both `CODE_ATTESTATION` and `MODEL_FIELD` are present;
   - fail when `CODE_ATTESTATION` is absent;
   - fail when `MODEL_FIELD` is absent or has any different value;
   - fail when `DOCS_ONLY` is also present, because the declaration contradicts the changed-file evidence.
4. A successful documentation-only PR still receives the normal CI checks.

The status description distinguishes:

```text
Code contribution provenance accepted
Documentation-only contribution accepted
Missing Qwen attestation
Missing or incorrect model ID
Documentation-only declaration conflicts with code changes
Pull request has no changed files
Pull request is too large for reliable provenance classification
```

### Unit tests

`tests/cases/community.test.ts` imports the pure evaluator from `../scripts/pr-policy.mjs` and covers:

- documentation-only pass without code attestation;
- documentation-only pass when the full code attestation is supplied;
- code pass with the exact attestation and model field;
- missing code attestation fail;
- wrong/missing model field fail;
- docs-only contradiction fail;
- mixed Markdown plus source file classified as code;
- workflow, image, and JSON changes classified as code;
- zero-file PR fail;
- more-than-300-file PR fail;
- CRLF body normalization;
- trailing whitespace tolerance.

## 9. CI architecture

### Workflow inventory

```text
.github/WORKFLOWS/CI.YML
.github/WORKFLOWS/QWEN-POLICY.YML
```

### `ci.yml`

Triggers:

```yaml
on:
  pull_request:
    branches:
      - main
  push:
    branches:
      - main
```

Concurrency:

```yaml
concurrency:
  group: ci-${{ github.event.pull_request.number ?? github.ref }}
  cancel-in-progress: true
```

Permissions:

```yaml
permissions:
  contents: read
```

A standard `pull_request` job is safe for untrusted fork code because it has no repository secrets and a read-only token. It is not treated as the security boundary.

Jobs:

| Job | Commands |
|---|---|
| `Quality` | `npm run typecheck`, `npm run test`, `npm run build`, `npm run noleak` |
| `Functional` | `node scripts/functional.mjs` |
| `Visual` | `npm run shots`, `npm run audit` |

Each job:

1. checks out the appropriate source with `actions/checkout@v4`;
2. sets up Node `22` with `actions/setup-node@v5` and npm caching;
3. runs `npm ci`;
4. installs Chromium:
   ```bash
   npx playwright install --with-deps chromium
   ```
5. runs its assigned commands.

The `Visual` job uploads `shots/` as a failure artifact so a reviewer can inspect regressions without needing a local browser.

The functional job runs the no-GPU mode deliberately: the three wall-clock timing gates are designed to report `SKIP` on SwiftShader. GPU-backed Gate-P evidence remains a separate maintainer-run verification because public hosted runners do not provide a deterministic M2/Metal environment.

### `qwen-policy.yml`

Trigger:

```yaml
on:
  pull_request_target:
    types:
      - opened
      - edited
      - ready-for-review
      - reopened
      - synchronize
```

This event runs the workflow file from the default/base branch, not from the untrusted pull request. The job does not check out or execute pull-request code.

Permissions:

```yaml
permissions:
  contents: read
  pull-requests: write
  statuses: write
```

The workflow:

1. checks out the default branch;
2. installs dependencies only if they are required to run the Node script;
3. invokes `scripts/check-pr-policy.mjs`;
4. posts a commit status on the PR head SHA with context:
   ```text
   Qwen provenance
   ```
5. exits non-zero when validation fails.

The GitHub Actions event policy for the public repository must allow `pull_request_target` after the relevant GitHub platform policy becomes enforceable. If that event is unavailable or disabled, the policy check cannot complete and maintainers must treat it as a failed gate rather than silently bypass it.

## 10. Branch protection

`main` is protected with:

- force pushes disallowed;
- deletions disallowed;
- pull request required before merge;
- one approving review required;
- stale reviews dismissed when a new commit is pushed;
- branch up to date before merge;
- required checks:
  ```text
  Quality
  Functional
  Visual
  Qwen provenance
  ```

The checks are configured through the GitHub repository settings/branch-protection API after the workflows exist and are observed green on at least one pull request or push to `main`.

Admin enforcement is enabled so the same quality/provenance rules apply to maintainer changes.

## 11. Validation

### Automated validation before merge

```bash
npm run test
npm run typecheck
npm run build
npm run noleak
node scripts/functional.mjs
npm run shots
npm run audit
```

Expected outcomes:

- 86 or more tests pass (the existing 83 plus community policy cases);
- TypeScript is clean;
- the production build succeeds;
- the shipped build has no debug globals or placeholder leaks;
- the CPU functional suite passes with the three GPU-only timing gates skipped;
- all deterministic visual frames pass the visual audit.

### GitHub validation

After merge:

```bash
gh repo view --json visibility,repositoryTopics,hasIssuesEnabled
gh pr checks <number>
gh run list --limit 20
gh pr view <number> --json reviewDecision,statusCheckRollup
```

Expected:

- repository visibility is `public`;
- topics are present;
- the Qwen policy status check passes for a compliant PR and fails for a non-compliant PR;
- CI jobs pass;
- branch protection is active.

A controlled PR test is performed before declaring the rollout complete:

1. create a temporary docs-only PR without a code attestation but with the docs-only declaration;
2. verify `Qwen provenance` passes;
3. create a temporary code PR with no attestation;
4. verify `Qwen provenance` fails;
5. close the temporary PRs.

## 12. Rollout sequence

1. Create a governance branch from `main`.
2. Add the MIT license and public package metadata.
3. Add the README, contributing guide, code of conduct, security policy, and templates.
4. Add `src/governance/PRPolicy.ts`, the policy script, and unit tests.
5. Add `ci.yml` and `qwen-policy.yml`.
6. Run all local automated gates.
7. Commit using conventional commits without a Jira ID.
8. Push and open a governance PR.
9. Verify that its required CI and provenance checks pass.
10. Merge it with the repository's default merge-commit strategy.
11. Convert the repository to public.
12. Enable private vulnerability reporting.
13. Add repository topics.
14. Configure `main` branch protection and required checks.
15. Perform the controlled PR policy tests.
16. Report the public repository URL and verified settings.

## 13. Acceptance criteria

The work is complete only when all of the following are observed:

- [ ] the repository is public;
- [ ] MIT LICENSE is present;
- [ ] README, CONTRIBUTING, CODE_OF_CONDUCT, and SECURITY are committed;
- [ ] issue and PR templates are active;
- [ ] a docs-only PR without a code attestation can pass;
- [ ] a code PR without the exact Qwen attestation cannot pass;
- [ ] a code PR with a wrong model ID cannot pass;
- [ ] CI runs typecheck, tests, build, no-leak, functional, shots, and audit;
- [ ] the existing full test suite and visual audit pass;
- [ ] `main` requires review and all required checks;
- [ ] no game behavior or runtime dependencies changed.
