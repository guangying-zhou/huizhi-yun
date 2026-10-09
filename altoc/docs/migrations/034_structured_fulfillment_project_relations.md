# Migration 034: Structured Fulfillment Project Relations

Run `034_structured_fulfillment_project_relations.sql` after migration 033 in each Altoc tenant database.

## Purpose

- Add `contract_project_line_rel` as the queryable relation between Altoc contract lines and Aims projects.
- Add `contract_project_obligation_rel` as the queryable relation between Altoc fulfillment obligations and Aims projects.
- Add `service_agreement_project_rel` as the queryable relation between Altoc service agreements and Aims service projects.
- Keep `contract_project_link.line_codes_json` and `obligation_codes_json` as compatibility snapshots and fallback data, not as the preferred source of truth.

## Backfill Sources

1. Direct legacy `contract_project_link.contract_line_id`.
2. Direct legacy `contract_project_link.obligation_id`.
3. Parseable `contract_project_link.line_codes_json` entries matched to `contract_line.code` within the same contract.
4. Parseable `contract_project_link.obligation_codes_json` entries matched to `contract_obligation.code` within the same contract.
5. Planned or active service agreements whose contract has exactly one active/planned maintenance or operation project link become default maintenance project relations.

The migration is idempotent. Duplicate relation inserts restore soft-deleted rows and refresh audit columns.

## Verification

After the migration, run:

```sql
source altoc/docs/backfill/034_fulfillment_relation_check.sql;
```

Expected healthy result:

- `duplicate_line_relation_count = 0`
- `duplicate_obligation_relation_count = 0`
- `orphan_line_relation_count = 0`
- `orphan_obligation_relation_count = 0`
- The final `active_default_count` query returns no rows.

Non-zero `unmatched_line_code_count`, `unmatched_obligation_code_count`, or invalid JSON counts mean legacy snapshots could not be fully backfilled and need data cleanup. The runtime still preserves JSON fallback for reads while those records are repaired.
