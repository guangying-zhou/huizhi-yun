-- Console SQL Seed v2.35 (candidate): GitLab repository operations become read-only.
-- Date: 2026-10-04
--
-- Document asset design DOC-01 (docs/Document-Asset-Unified-Management-Design.md §6):
-- the platform no longer writes to GitLab repositories. Runtime removed the
-- fixed operations `commit` and `resolve-actions`; this script withdraws the
-- matching semantic operation grants so that the grant ledger agrees with code.
--
-- CANDIDATE ONLY: executing it is an environment write and needs explicit
-- approval for the target environment. It removes two operation names from the
-- `integration_operations:execute` semantic policy of every service client.
-- It does not change `status`, does not delete rows, does not revive revoked
-- rows, and leaves `gitlab.issue-upsert`, the read operations and all WeCom
-- operations untouched. Re-running it is a no-op.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

UPDATE `service_client_grants`
SET
  `scope_json` = JSON_REMOVE(
    `scope_json`,
    JSON_UNQUOTE(JSON_SEARCH(`scope_json`, 'one', 'gitlab.commit', NULL, '$.operations'))
  ),
  `updated_at` = UTC_TIMESTAMP()
WHERE `resource_code` = 'integration_operations'
  AND `action` = 'execute'
  AND JSON_SEARCH(`scope_json`, 'one', 'gitlab.commit', NULL, '$.operations') IS NOT NULL;

UPDATE `service_client_grants`
SET
  `scope_json` = JSON_REMOVE(
    `scope_json`,
    JSON_UNQUOTE(JSON_SEARCH(`scope_json`, 'one', 'gitlab.resolve-actions', NULL, '$.operations'))
  ),
  `updated_at` = UTC_TIMESTAMP()
WHERE `resource_code` = 'integration_operations'
  AND `action` = 'execute'
  AND JSON_SEARCH(`scope_json`, 'one', 'gitlab.resolve-actions', NULL, '$.operations') IS NOT NULL;

COMMIT;
