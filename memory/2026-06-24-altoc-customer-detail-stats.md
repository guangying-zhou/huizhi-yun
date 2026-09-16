# Altoc customer detail stats missing

## Symptom

Customer detail cards showed `--` for contract total and cumulative receipts even though the related contracts tab listed contracts with amounts.

## Root cause

`GET /v1/altoc/customers/{id}` was handled by the generic compat resource for `customer`, which returns only `SELECT * FROM customer`. The Nuxt customer detail page already expected `customer.stats.contract_amount` and `customer.stats.total_received`, but the runtime did not populate `stats`.

## Fix

Added a custom Altoc customer detail GET route that preserves existing data-scope filters and injects `stats`.

- Opportunity cards are aggregated from scoped `opportunity` rows.
- Contract total is aggregated from all scoped, non-deleted `contract` rows for the customer.
- Cumulative receipts are aggregated from Finance `ContractSummary.ReceivedAmount` via the existing Finance bridge, avoiding local `payment_record`.

## Verification

Ran:

```bash
go test ./internal/apps/altoc ./internal/apps/finance ./cmd/wizbiz-receivable-diff
```

Result: pass.
