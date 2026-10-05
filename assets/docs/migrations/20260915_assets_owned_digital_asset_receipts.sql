-- ADR-018: allow Assets-owned digital asset commands in the existing receipt
-- table.  This is additive to 20260913 and must be applied before enabling
-- Enterprise digital asset writes; older schemas fail closed.
ALTER TABLE service_command_receipt
  DROP CHECK chk_scr_cross_app,
  ADD CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app OR (
    source_app = 'assets' AND target_app = 'assets'
    AND source_deployment_code = deployment_code
    AND original_actor_uid IS NOT NULL AND CHAR_LENGTH(TRIM(original_actor_uid)) > 0
    AND command_schema_version = 'assets-owned-command.v1'
    AND (
      (operation_code IN ('assets.products.create.v1', 'assets.products.edit.v1', 'assets.products.link-base.v1', 'assets.products.link-asset.v1', 'assets.products.link-document.v1') AND required_capability = 'assets:product:edit')
      OR (operation_code = 'assets.product-categories.save.v1' AND required_capability = 'assets:admin:admin')
      OR (operation_code = 'assets.digital-assets.create.v1' AND required_capability = 'assets:digital-asset:create')
      OR (operation_code = 'assets.digital-assets.edit.v1' AND required_capability = 'assets:digital-asset:edit')
    )
  ));
