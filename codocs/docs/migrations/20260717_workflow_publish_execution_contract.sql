-- Workflow 发文审批后置执行链路 schema
-- 适用数据库：hzy_codocs / MySQL 8.0+
-- 执行顺序：先执行本脚本，再发布包含 tenant-runtime 后置执行合同的版本。

-- document_publish_requests 已由 Workflow 发文申请链路创建；以下补齐归档、
-- 盖章、发送、接收状态字段。使用 information_schema 保持重复执行安全。
SET @add_archive_oss_path := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND COLUMN_NAME = 'archive_oss_path'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD COLUMN `archive_oss_path` VARCHAR(500) NULL COMMENT ''发布后文档 OSS 路径'' AFTER `workflow_status`'
);
PREPARE stmt FROM @add_archive_oss_path;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_execution_status := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND COLUMN_NAME = 'execution_status'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD COLUMN `execution_status` VARCHAR(30) NULL COMMENT ''pending_seal/pending_send/pending_receive/received'' AFTER `archive_oss_path`'
);
PREPARE stmt FROM @add_execution_status;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_published_document_uuid := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND COLUMN_NAME = 'published_document_uuid'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD COLUMN `published_document_uuid` VARCHAR(36) NULL COMMENT ''发布版本文档 UUID'' AFTER `execution_status`'
);
PREPARE stmt FROM @add_published_document_uuid;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_sealed_at := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND COLUMN_NAME = 'sealed_at'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD COLUMN `sealed_at` DATETIME NULL COMMENT ''确认盖章时间'' AFTER `published_document_uuid`'
);
PREPARE stmt FROM @add_sealed_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_sent_at := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND COLUMN_NAME = 'sent_at'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD COLUMN `sent_at` DATETIME NULL COMMENT ''确认发送时间'' AFTER `sealed_at`'
);
PREPARE stmt FROM @add_sent_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @add_received_at := IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND COLUMN_NAME = 'received_at'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD COLUMN `received_at` DATETIME NULL COMMENT ''确认接收时间'' AFTER `sent_at`'
);
PREPARE stmt FROM @add_received_at;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS `document_seal_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `review_id` BIGINT UNSIGNED NOT NULL COMMENT 'Workflow 发布申请 ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '发布版本文档 UUID',
  `seal_types` JSON NOT NULL COMMENT '盖章类型数组',
  `page_count` INT NOT NULL COMMENT '文档页数',
  `operator_uid` VARCHAR(64) NOT NULL COMMENT '盖章确认人',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `confirmed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '确认盖章时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_review_id` (`review_id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_operator_uid` (`operator_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档盖章记录表';

CREATE TABLE IF NOT EXISTS `document_send_records` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  `review_id` BIGINT UNSIGNED NOT NULL COMMENT 'Workflow 发布申请 ID',
  `document_uuid` VARCHAR(36) NOT NULL COMMENT '发布版本文档 UUID',
  `sender_uid` VARCHAR(64) NOT NULL COMMENT '指定发送人',
  `receiver_name` VARCHAR(100) NOT NULL COMMENT '接收人',
  `receiver_phone` VARCHAR(30) NOT NULL COMMENT '联系电话',
  `channel` VARCHAR(20) NOT NULL COMMENT '发送途径',
  `sent_date` DATE NOT NULL COMMENT '实际发送日期',
  `receive_date` DATE NULL COMMENT '实际接收日期',
  `target_account` VARCHAR(200) DEFAULT NULL COMMENT '对方账号或寄递信息',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `confirmed_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '确认发送时间',
  `received_confirmed_at` DATETIME NULL COMMENT '确认接收时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  INDEX `idx_review_id` (`review_id`),
  INDEX `idx_document_uuid` (`document_uuid`),
  INDEX `idx_sender_uid` (`sender_uid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档发送记录表';

SET @add_execution_queue_index := IF(
  EXISTS(
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'document_publish_requests'
      AND INDEX_NAME = 'idx_publish_execution_queue'
  ),
  'SELECT 1',
  'ALTER TABLE `document_publish_requests` ADD INDEX `idx_publish_execution_queue` (`review_type`, `execution_status`)'
);
PREPARE stmt FROM @add_execution_queue_index;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 部署后快速核对：
SELECT `workflow_status`, `execution_status`, COUNT(*) AS record_count
FROM `document_publish_requests`
GROUP BY `workflow_status`, `execution_status`
ORDER BY `workflow_status`, `execution_status`;
