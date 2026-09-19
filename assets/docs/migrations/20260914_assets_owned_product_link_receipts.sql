-- ADR-018 incremental product relation commands.
-- Apply after 20260913_assets_owned_product_receipts.sql.
-- Re-running replaces the same CHECK atomically. Rolling back is unsafe once
-- a relation receipt exists; preserve those receipts and freeze relation writes.
-- Apply to the Assets owning schema before final copy. The unified migration
-- preserves this CHECK when renaming service_command_receipt to its registered
-- physical table. Do not create an unqualified compatibility view for receipts.
-- Existing cross-application receipts retain their original contract.
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
    )
  ));
