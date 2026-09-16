# Console Cloudflare deployment missing activation vars

Date: 2026-08-24

## DEBUG REPORT

- **Symptom:** `pnpm --dir console deploy:cloudflare` completed lint, typecheck and 402 tests, then `render-cloudflare-config.mjs` exited because `HZY_PLATFORM_SIGNING_KID`, `HZY_PLATFORM_SIGNING_PUBKEY`, and `HZY_CONNECTOR_RUNTIME_RELEASE_PUBLIC_KEY_PEM_BASE64` were missing.
- **Root cause:** the deployment-host file `console/.env.cloudflare` was absent in this worktree and all three variables were unset in the invoking shell. The file is deliberately gitignored, so a new worktree does not inherit it. The renderer correctly fails closed rather than using placeholders or generating new trust anchors.
- **Fix:** recovered the three current `plain_text` public trust anchors from the active `hzy-console-prod` Worker version and restored an ignored `console/.env.cloudflare` from the repository production template. No Worker secrets or private keys were read or written.
- **Evidence:** strict Console Cloudflare validation passed; config generation passed; full deployment preflight passed with 402/402 tests, lint, typecheck, build and Wrangler dry-run; production deployment completed as version `d58dbe15-76af-4b9c-8485-9d80dcb984b0`.
- **Production verification:** `https://console.huizhi.yun/`, direct Console `/api/auth/me`, tenant Gateway `/api/auth/me`, and tenant Gateway `/.well-known/jwks.json` returned 200. Direct `console.huizhi.yun/.well-known/jwks.json` returned the expected 503 without trusted tenant-runtime context; the tenant Gateway route is the public JWKS path and returned 200.
- **Regression guard:** `pnpm run validate:console-cloudflare -- --env-file console/.env.cloudflare --strict-env` plus the existing fail-closed renderer validation.
- **Related:** `console/.env.cloudflare` and `.wrangler.generated.jsonc` remain ignored deployment-host artifacts. New worktrees or CI runners must provision the non-secret env file (or inject the three variables) before deploying.
- **Status:** DONE
