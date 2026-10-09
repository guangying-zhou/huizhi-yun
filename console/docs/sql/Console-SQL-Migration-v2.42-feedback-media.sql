-- Private, bounded image staging. No public object URL; install separately.
CREATE TABLE IF NOT EXISTS `console_feedback_attachments` (
 `tenant_code` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `feedback_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `attachment_id` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
 `request_key` CHAR(64) NOT NULL,
 `input_sha256` CHAR(64) NOT NULL,
 `sha256` CHAR(64) NOT NULL,
 `byte_size` INT NOT NULL,
 `image_bytes` MEDIUMBLOB NULL,
 `status` VARCHAR(24) NOT NULL DEFAULT 'staged',
 `upload_id` BIGINT NOT NULL DEFAULT 0,
 `upload_path` VARCHAR(512) NOT NULL DEFAULT '',
 `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 PRIMARY KEY(`tenant_code`,`feedback_id`,`attachment_id`),
 UNIQUE KEY `uq_feedback_media_request`(`tenant_code`,`request_key`),
 KEY `idx_feedback_media_retention`(`tenant_code`,`updated_at`),
 CONSTRAINT `ck_feedback_media_state` CHECK(`status` IN ('staged','uploading','uploaded','failed','unknown','expired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
