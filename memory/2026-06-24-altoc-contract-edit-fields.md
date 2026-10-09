# Altoc contract edit fields hidden outside draft

## Symptom

Contract detail edit modal only showed parent/master contract controls for non-draft contracts, so users could not edit fields such as name, amount, dates, invoice type, warranty, or owner.

## Root cause

The detail page gated most edit form fields behind `contractBasicFieldsEditable`, which only allowed draft/rejected contracts. For other statuses the submit body was reduced to `parent_contract_id` and `is_master_contract`.

The page also saved through generic `PUT /contracts/{id}`, while the domain update endpoint is `/contracts/{id}/draft`; the generic path can silently skip fields protected by generic write-deny columns.

## Fix

- The contract detail edit modal now always displays the full basic-info form.
- Submit always sends the full contract header payload to `/api/v1/contracts/{id}/draft`.
- The runtime contract header update no longer blocks non-draft header-field updates. Status/lifecycle fields are still excluded from the allowed update list, and contract line mutations remain draft-only.
- Contract header updates now write audit action `update` instead of `draft_update`.

## Verification

Ran:

```bash
go test ./internal/apps/altoc ./internal/apps/finance ./cmd/wizbiz-receivable-diff
pnpm run typecheck
```

Both passed.
