# Contributing to Velocity Rush

By contributing, you agree to the [code of conduct](CODE_OF_CONDUCT.md).

## Qwen-only code authorship

Every new contribution that changes source, tests, scripts, workflows, package
metadata, screenshots, or other binary/behavior assets must be authored using
`Qwen3.8-flash-next`. Existing commit history is grandfathered under this policy.

A code pull request must contain the exact checked attestation from the pull-request
template:

```markdown
- [x] I confirm that all code changes in this pull request were authored by Qwen3.8-flash-next.
- Model ID: Qwen3.8-flash-next
```

The base-controlled `Qwen provenance` check validates this declaration against the
pull-request body and changed files. Because a source-host cannot prove which model
was used, the declaration remains subject to maintainer review. Submitting a false
declaration violates the code of conduct.

## Documentation-only contributions

Documentation-only pull requests are limited to `.md` files. Check:

```markdown
- [x] This pull request changes documentation/content only.
```

A checked docs-only declaration with any non-Markdown file is rejected as
contradictory.

## Before you start

1. Search existing issues and pull requests.
2. Open an issue before a substantive behavioral change and wait for maintainer
   direction. Use the structured YAML issue forms in
   `.github/ISSUE_TEMPLATE/*.yml`; GitHub renders them in the new-issue picker,
   but its public template-listing APIs enumerate only Markdown templates, so an
   empty GraphQL `issueTemplates` result is a platform limitation, not evidence
   that the forms are inactive.
3. Keep one focused change per pull request. Do not bundle refactoring with a
   feature or bug fix.
4. State the files, behavior, and validation evidence you intend to deliver.

## Local development

```bash
npm ci
npm run dev
```

Run all gates locally:

```bash
npm run test
npm run typecheck
npm run build
npm run noleak
npm run functional
npm run shots
npm run audit
```

- `npm run functional` checks gameplay without GPU-specific timing gates.
- `npm run shots` regenerates the visual battery.
- `npm run audit` validates that battery.
- Visual changes require reviewed screenshots and their rationale.
- Performance-relevant changes require fresh `node scripts/perf.mjs` evidence or
  an explanation why the existing committed evidence remains valid.
- Maintainer audio-listening, physical gamepad, and 5-Second gameplay review
  remain required for user-visible gameplay/audio changes.

## Pull-request process

1. Branch from the current `main`.
2. Use Conventional Commit subjects; omit periods and keep subjects imperative.
3. Push and open a pull request from the repository template.
4. Fill the authorship or docs-only declaration.
5. Request maintainer review.
6. Do not force-push after review has started; push follow-up commits and let
   stale approvals be dismissed.
7. `main` requires one approving maintainer review and green `Quality`,
   `Functional`, `Visual`, and `Qwen provenance` checks.

The policy is enforced for new contributions, not retroactively rewritten
commit history.
