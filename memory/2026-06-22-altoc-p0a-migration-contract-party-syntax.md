# Altoc P0A Migration Contract Party Syntax Check

## Symptom

Executing `altoc/docs/migrations/026_contract_line_core.sql` reported MySQL error 1064 while creating `contract_party`. The displayed SQL ended at:

```sql
party_name_snapshot VARCHAR(200) NOT NULL COMMENT '参与方名称快照',
```

## Root Cause

The SQL statement sent to MySQL was truncated before the rest of the `CREATE TABLE contract_party` definition. The repository migration file contains the full statement through `role_code`, indexes, foreign key, and closing `) ENGINE=...;`.

## Evidence

- Inspected `altoc/docs/migrations/026_contract_line_core.sql` lines 95-116; the statement is complete.
- Checked bytes around the statement; no hidden terminator or malformed quote was present.
- Verified the complete `contract_party` DDL against a temporary local MySQL 9.5 instance with a minimal parent `contract(id)` table. `CREATE TABLE contract_party` succeeded and `SHOW CREATE TABLE` returned the expected definition.

## Fix / Operational Guidance

Run the full migration file or select the complete `CREATE TABLE contract_party ... COMMENT='合同参与方表';` block. Do not execute only the first six lines of the statement. Prefer CLI execution for scripts containing `DELIMITER`:

```bash
mysql --default-character-set=utf8mb4 -h <host> -u <user> -p hzy_altoc < altoc/docs/migrations/026_contract_line_core.sql
```

## Status

DONE_WITH_CONCERNS: no repository code change was needed; the remaining risk is SQL client execution mode or partial statement selection.

## Follow-up: Missing Legacy Compatibility Columns

### Symptom

The same migration later failed with:

```text
Error Code: 1054. Unknown column 'source_contract_type' in 'field list'
```

### Root Cause

`026_contract_line_core.sql` assumed `002_wizbizdb_marketing_compat.sql` had already added optional legacy compatibility columns on `contract`, such as `source_contract_type`, `is_third_party`, `service_period_months`, `content_summary`, `service_terms`, `legacy_source`, and `legacy_id`. Some target tenant databases do not have those legacy columns.

### Fix

Updated `026_contract_line_core.sql` so the `primary_type` backfill and historical summary-line snapshot are generated with dynamic SQL based on `information_schema.COLUMNS`. If optional legacy columns exist, their values are used; otherwise the migration falls back to `legacy_contract` and a generic `P0A 存量合同历史汇总行` description.

### Evidence

Created a temporary local MySQL 9.5 database with a minimal `contract` table that intentionally omitted all optional legacy compatibility columns. Running the full migration succeeded. The migrated row had `primary_type=legacy_contract`, `source_type=manual`, one `legacy_summary` contract line, and 12 business templates.

### Status

DONE.

## Follow-up: Missing `contract.contact_id`

### Symptom

The migration later failed while backfilling `contract_party`:

```text
Error Code: 1054. Unknown column 'ct.contact_id' in 'on clause'
```

### Root Cause

`contract.contact_id` is also a compatibility column added by `002_wizbizdb_marketing_compat.sql`. Some tenant databases have contracts without direct contact references. The migration also still had direct references to optional source columns (`quotation_id`, `opportunity_id`) and optional legacy summary columns (`created_by`, `deleted_at`, amount/date fields), which could cause the next 1054 failure.

### Fix

Updated `026_contract_line_core.sql` so:

- `source_type/source_code` backfill only joins quotation/opportunity when the columns and tables exist.
- `contract_party` backfill only joins `contact` when `contract.contact_id` and `contact` exist; otherwise contact snapshot fields are inserted as `NULL`.
- `contract_party` handles missing `customer.code`, `contract.created_by`, and `contract.deleted_at`.
- Historical summary line backfill handles missing amount, tax, currency, date, created_by, and deleted_at columns with safe defaults.

### Evidence

Created a temporary MySQL 9.5 database with:

- `contract` containing only `id`, `code`, `name`, `customer_id`, `status`, and `version_no`.
- `customer` containing no `code`.
- no `contact`, `quotation`, or `opportunity` tables.

Running the full migration succeeded. It produced:

- `contract.source_type=manual`, `source_code=CT-1`
- one `contract_party` row with `party_name_snapshot=测试客户` and null contact fields
- one `legacy_summary` contract line with amount `0`, tax rate `6`, currency `CNY`

### Status

DONE.
