# Altoc Contract Termination Bad Debt Amount

- Date: 2026-06-24
- Issue: Contract `CTMIG277` showed `未回款` 150000 in the detail header but the management tab disabled termination with `没有未回款金额`.
- Root cause: The header `未回款` used contract-level balance (`contract amount - received total`), while the management tab and backend termination API used `OutstandingAmount`, which follows the receivable basis (`receivable plan total` when plans exist, otherwise `invoice total`) minus received total. For migrated contracts where existing invoices/payments cover the receivable basis but not the full contract amount, `OutstandingAmount` can be 0 while contract-level unreceived amount remains positive.
- Fix: Added a termination-specific bad debt amount: `max(receivable outstanding amount, contract amount - received total)`. Frontend management tab uses this amount for button enablement and display. Backend termination API uses the same amount for validation, audit payloads, response payloads, and fallback bad-debt receivable plan creation.
- Validation: `go test ./internal/apps/altoc` in `data-runtime`; `pnpm run typecheck` in `altoc`.
