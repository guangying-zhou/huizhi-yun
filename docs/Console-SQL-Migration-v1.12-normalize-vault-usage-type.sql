-- Console SQL Migration v1.12: normalize legacy vault usage_type values.
-- Date: 2026-05-01
-- Purpose:
--   Earlier local data may contain vault_secrets.usage_type='service_client'.
--   The canonical model uses usage_type='service' and owner_type='service_client'.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

UPDATE `vault_secrets`
   SET `usage_type` = 'service',
       `owner_type` = 'service_client',
       `updated_at` = UTC_TIMESTAMP()
 WHERE `usage_type` = 'service_client';
