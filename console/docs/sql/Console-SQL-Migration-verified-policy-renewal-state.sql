-- Renewal state for the opt-in verified policy store (docs/Policy-Sync-Cadence-Assessment-20260922.md).
-- Select the tenant Console database explicitly and run once after
-- Console-SQL-Migration-verified-policy-snapshots.sql. Existing rows keep NULL,
-- which means "no renewal outcome" and grants no outage grace. Runtime keeps
-- serving snapshots before this migration; only the renewal endpoint returns 503.
ALTER TABLE `verified_policy_snapshots`
  ADD COLUMN `renewal_state` varchar(32) COLLATE utf8mb4_bin NULL,
  ADD COLUMN `renewal_attempted_at` bigint NULL;
