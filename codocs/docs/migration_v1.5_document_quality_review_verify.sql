-- v1.5 verification: deterministic document-version hashes and review grants.

DELIMITER $$

DROP PROCEDURE IF EXISTS `codocs_verify_v15_document_quality`$$
CREATE PROCEDURE `codocs_verify_v15_document_quality`()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_versions'
      AND COLUMN_NAME = 'content_sha256'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'document_versions.content_sha256 missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_review_grants'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'document_review_grants missing';
  END IF;
END$$

CALL `codocs_verify_v15_document_quality`()$$
DROP PROCEDURE IF EXISTS `codocs_verify_v15_document_quality`$$

DELIMITER ;

SELECT
  COUNT(*) AS legacy_versions_requiring_hash_backfill
FROM document_versions
WHERE content_sha256 IS NULL
   OR content_sha256 NOT REGEXP '^[0-9a-fA-F]{64}$';
