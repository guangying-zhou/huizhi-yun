-- CANDIDATE ONLY. Execute after Platform release approval and a tested backup.
-- Existing scopes all remain manual; do not infer provenance from manifest_action_id.
-- Precondition: source_type does not exist; inspect information_schema first.
ALTER TABLE platform_app_role_scopes
  ADD COLUMN source_type ENUM('manual', 'manifest_default') NOT NULL DEFAULT 'manual'
  COMMENT 'manual/custom or recommendedRoles.defaultScopes; never infer from manifest_action_id';
