-- Repeatable migration: bind Console in-app notification idempotency keys to
-- an immutable canonical request hash.
--
-- Existing rows cannot be canonically reconstructed because historical channel
-- requests were not persisted. They receive a deterministic legacy sentinel;
-- replaying an old key is therefore rejected conservatively with HTTP 409.

SET @portal_notification_request_hash_exists := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'portal_notifications'
     AND column_name = 'request_hash'
);
SET @portal_notification_request_hash_ddl := IF(
  @portal_notification_request_hash_exists = 0,
  'ALTER TABLE `portal_notifications` ADD COLUMN `request_hash` CHAR(64) NULL AFTER `idempotency_key`',
  'SELECT 1'
);
PREPARE portal_notification_request_hash_statement FROM @portal_notification_request_hash_ddl;
EXECUTE portal_notification_request_hash_statement;
DEALLOCATE PREPARE portal_notification_request_hash_statement;

UPDATE `portal_notifications`
   SET `request_hash` = SHA2(CONCAT(
     'legacy-notification:',
     `source_app_code`, ':',
     COALESCE(`idempotency_key`, ''), ':',
     `notification_id`
   ), 256)
 WHERE `request_hash` IS NULL
    OR `request_hash` NOT REGEXP '^[0-9a-f]{64}$';

ALTER TABLE `portal_notifications`
  MODIFY COLUMN `request_hash` CHAR(64) NOT NULL AFTER `idempotency_key`;
