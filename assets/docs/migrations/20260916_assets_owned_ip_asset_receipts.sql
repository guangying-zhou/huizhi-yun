-- ADR-018: add IP-asset commands to the existing Assets-owned receipt allowlist.
-- Apply after 20260915; older receipt schemas fail closed at Runtime startup.
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
      OR (operation_code = 'assets.ip-assets.create.v1' AND required_capability = 'assets:ip-asset:create')
      OR (operation_code = 'assets.ip-assets.edit.v1' AND required_capability = 'assets:ip-asset:edit')
    )
  ));
