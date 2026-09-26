-- ADR-018: Assets-owned product and product-category receipts.
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
      (operation_code IN ('assets.products.create.v1', 'assets.products.edit.v1') AND required_capability = 'assets:product:edit')
      OR (operation_code = 'assets.product-categories.save.v1' AND required_capability = 'assets:admin:admin')
    )
  ));
