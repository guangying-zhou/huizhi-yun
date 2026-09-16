-- Console SQL Seed v1.29: use S3-compatible provider for default OSS.
-- Date: 2026-06-19
-- Purpose:
--   Cloudflare builds cannot use the ali-oss native SDK. The shared
--   oss.default integration should explicitly use the Aliyun OSS S3-compatible
--   provider so modules can upload files from Cloudflare runtimes.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

UPDATE `integrations`
   SET `config_json` = JSON_SET(
         COALESCE(`config_json`, JSON_OBJECT()),
         '$.provider', 'aliyun-oss-s3',
         '$.objectStorageProvider', 'aliyun-oss-s3'
       ),
       `updated_at` = UTC_TIMESTAMP()
 WHERE `integration_code` = 'oss.default';

SELECT
  `integration_code`,
  JSON_UNQUOTE(JSON_EXTRACT(`config_json`, '$.provider')) AS `provider`,
  JSON_UNQUOTE(JSON_EXTRACT(`config_json`, '$.bucketName')) AS `bucket_name`,
  JSON_UNQUOTE(JSON_EXTRACT(`config_json`, '$.endpoint')) AS `endpoint`,
  JSON_UNQUOTE(JSON_EXTRACT(`config_json`, '$.region')) AS `region`
FROM `integrations`
WHERE `integration_code` = 'oss.default';
