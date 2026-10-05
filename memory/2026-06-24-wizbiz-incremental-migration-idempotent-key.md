# WizBiz incremental migration idempotent key fix

Date: 2026-06-24

## Symptom

Running the dry-run command failed at the contracts target:

```text
[wizbiz-incremental-migrate] failed: contracts source id 4: missing legacy_id
```

## Root Cause

The migration code added `legacy_source` and `legacy_id` to each transformed row,
then filtered the row by the target table's actual columns before calling
`upsert`. In environments where the target `contract` table does not expose
`legacy_id`, the filtered map no longer contained the source primary key, and
`upsert` failed before it could use a stable fallback.

The all-target dry-run was also slow because lookups for customers, contacts,
contracts, and bank accounts were performed row by row.

## Fix

- Added `upsertMatch` so source id and generated business code survive target
  column filtering.
- Changed upsert matching to prefer `legacy_source + legacy_id` and fall back
  to `code` when legacy columns are unavailable.
- Changed dry-run mode to validate conversion and idempotent key availability
  without per-row target existence checks.
- Preloaded customer/contact/contract/bank-account target references into
  memory to avoid row-by-row lookup queries.

## Verification

```bash
go test ./...
go build -o /tmp/wizbiz-incremental-migrate ./cmd/wizbiz-incremental-migrate
go run ./cmd/wizbiz-incremental-migrate --env .env --targets contracts
go run ./cmd/wizbiz-incremental-migrate --env .env --targets all
```

Dry-run result after the fix:

- `contracts`: scanned 1547, insert candidates 1545, skipped 2.
- `all`: completed successfully; remaining warnings are unmapped source records,
  not migration runner errors.

## Follow-up: account balance duplicate key

During `--apply --targets all`, the balance snapshot target failed with:

```text
Duplicate entry '33-2023-02-25-migration' for key 'finance_account_balance_snapshot.uk_balance_account_date'
```

Additional root cause:

- `finance_account_balance_snapshot` has a natural unique key
  `(bank_account_id, snapshot_date, source_type)`.
- The source table `wb_account_balance` uses `check_date` as the actual balance
  snapshot date.
- The migration runner did not include `check_date`, so it fell back to
  `operate_time`, incorrectly mapping multiple source rows to the same
  operation date.

Additional fix:

- `account-balances` now uses `check_date` before fallback date columns.
- `account-balances` upsert can match existing rows by the natural unique key.
- Apply mode now logs per-target start/done and every 250-row progress.

Verified with:

```bash
go test ./...
go run ./cmd/wizbiz-incremental-migrate --env .env --apply --batch-code MIG_INC_20260624_DEBUG2 --targets account-balances --limit 20
```

## Follow-up: preserve contract status

Requirement: incremental OA migration must not overwrite contract statuses that
have already been changed in the new system.

Implementation:

- New contract inserts still initialize lifecycle/fulfillment/financial status
  from OA.
- Existing contract updates preserve:
  `status`, `legal_status`, `fulfillment_status`, `financial_status`,
  `activation_status`, `completed_at`, `terminated_at`,
  `last_status_changed_at`, and `last_status_changed_by`.
- Non-status business fields such as name, amount, dates, refs, and remarks can
  still be updated from the source record.
