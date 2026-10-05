-- Codocs-owned commands (Enterprise document workspace) write receipts with
-- source_app = target_app = 'codocs'. The original CHECK only allowed
-- cross-application receipts, so every owned command failed (Error 3819).
-- Mirrors assets/docs/migrations/20260914_assets_owned_product_link_receipts.sql:
-- only the exact owned operation/capability/schema triples below are allowed,
-- in the same deployment and with a verified actor. Cross-application receipts
-- keep their original contract. Re-running replaces the same CHECK atomically.
-- Apply to the schema that holds the Codocs `service_command_receipt` (in the
-- unified Enterprise database, the physical table the Codocs adapter writes).
-- The list must match data-runtime/internal/apps/codocs (guarded by
-- TestOwnedReceiptCheckCoversCodocsCommands).
ALTER TABLE service_command_receipt
  DROP CHECK chk_scr_cross_app,
  ADD CONSTRAINT chk_scr_cross_app CHECK (source_app <> target_app OR (
    source_app = 'codocs' AND target_app = 'codocs'
    AND source_deployment_code = deployment_code
    AND original_actor_uid IS NOT NULL AND CHAR_LENGTH(TRIM(original_actor_uid)) > 0
    AND (
      (operation_code = 'codocs.personal-documents.update.v1' AND required_capability = 'codocs:personal-documents:edit' AND command_schema_version = 'codocs-document-update.v1')
      OR (operation_code = 'codocs.personal-documents.recycle.v1' AND required_capability = 'codocs:personal-documents:delete' AND command_schema_version = 'codocs-personal-recycle.v1')
      OR (operation_code = 'codocs.personal-documents.restore.v1' AND required_capability = 'codocs:personal-documents:edit' AND command_schema_version = 'codocs-personal-restore.v1')
      OR (operation_code = 'codocs.personal-folders.create.v1' AND required_capability = 'codocs:personal-folders:create' AND command_schema_version = 'codocs-personal-folder.v1')
      OR (operation_code = 'codocs.personal-cabinet.delete.v1' AND required_capability = 'codocs:personal-cabinet:delete' AND command_schema_version = 'codocs-cabinet-delete.v1')
      OR (operation_code = 'codocs.personal-documents.department-transfer.v1' AND required_capability = 'codocs:document-transfer:department' AND command_schema_version = 'codocs-dept-transfer.v1')
      OR (operation_code = 'codocs.personal-documents.project-transfer.v1' AND required_capability = 'codocs:document-transfer:project' AND command_schema_version = 'codocs-project-transfer.v1')
      OR (operation_code = 'codocs.document-annotations.mutate.v1' AND required_capability IN ('codocs:document-annotations:create', 'codocs:document-annotations:edit') AND command_schema_version = 'codocs-annotation-mutation.v1')
    )
  ));
