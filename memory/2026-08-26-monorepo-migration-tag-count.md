# Monorepo migration verification rejected a post-migration release tag

Date: 2026-08-26

## Symptom

`release:check` failed in `scripts/verify-monorepo-migration.mjs` with:

`FAIL aims: expected 6 tags, got 7`

The seventh tag was the valid `aims/v0.1.3` release created after the monorepo migration.

## Root Cause

`docs/monorepo-migration/inventory.json` is an immutable audit snapshot of the 2026-08-21 migration baseline. Its `tagCount` records the tags present at each component's migrated `newHead`.

The verifier counted every current `<component>/*` tag with `git tag --list` and compared that evolving total with the fixed migration snapshot. Every legitimate release after migration therefore made the migration check fail and incorrectly suggested that the audit baseline was damaged.

## Fix

- Count component tags reachable from the recorded migration `newHead` with `git tag --merged <newHead> --list <component>/*`.
- Continue requiring that baseline count to equal the immutable inventory exactly.
- Report newer post-migration tags separately without treating them as migration history.
- Clarify this distinction in the migration record and GitLab full-clone note.
- Add a regression test that proves AIMS has more current tags than its migration baseline while the verifier still succeeds.

During the full release check, the next latent failure was an Assets-local `useDashboard` override that did not implement the `setSidebarCollapsed` contract introduced by the shared Foundation sidebar. The local composable was aligned with the shared contract so all workspace typechecks can complete.

## Verification

- Before the fix, `node --test scripts/test/verify-monorepo-migration.test.mjs` failed with the original `expected 6 tags, got 7` error.
- After the fix, the regression test passed.
- `node scripts/verify-monorepo-migration.mjs` passed and reported `aims: tree and 6 migrated tags (+1 post-migration)`.
- `pnpm --dir assets typecheck` passed.
- `pnpm release:check -- --allow-dirty` passed in full, including active workspace lint, typecheck and tests plus all three Go suites.
