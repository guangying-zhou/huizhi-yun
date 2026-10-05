# 2026-06-24 Altoc payment_record retirement

Root cause: Altoc contract list, contract detail, management actions, and dashboard month receipt metrics still used the local `payment_record` table while WizBiz receipts had been migrated into Finance `finance_receipt`. This produced inflated unreceived amounts and blocked valid contract termination.

Fix: Contract received/unreceived amounts now use Finance contract summaries backed by live `finance_receipt` aggregates. Contract detail and receivable plan detail list Finance receipts through the existing `payment_records` response key for frontend compatibility. Receivable confirmation and force-complete auto-receipt now create Finance receipts instead of local payment records. Altoc no longer requires the `payment_record` table in schema checks.

Verification: `go test ./internal/apps/altoc ./internal/apps/finance ./cmd/wizbiz-receivable-diff` and `pnpm run typecheck` in `altoc` passed.
