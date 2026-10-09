-- CANDIDATE ONLY: stop manifest/governance writes; snapshot rows before deleting defaults.
-- After deletion restore the previous manifest, refresh/re-sign policies, then restore code.
-- Dropping the column alone would turn new global defaults into legacy custom rows!
-- Snapshot all scopes first. Only new owned defaults may be deleted; preserve manual.
START TRANSACTION;
DELETE FROM platform_app_role_scopes WHERE source_type='manifest_default';
COMMIT;
-- Refresh affected role policy hashes/revisions and re-sign/sync the approved bundle
-- through Platform's existing governance APIs before removing the provenance column.
-- Execute the following only after those readbacks pass (DDL commits implicitly):
-- ALTER TABLE platform_app_role_scopes DROP COLUMN source_type;
