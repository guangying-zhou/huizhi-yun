-- v2.5: 目录身份预留。可重复执行；只建表，不改写任何既有目录数据。
--
-- LDAP 账号在 Connector 回执成功之前不会写入 directory_users，因此建号请求
-- 之间只靠 pending operation 挡同一个 uid，username 与邮箱没有任何跨请求的
-- 唯一性保护。受控入职要求在真正开户之前先原子预留 UID/登录名/邮箱：预留只
-- 阻止冲突，不创建 active Directory 用户，也不投影 Platform。
SET NAMES utf8mb4;
USE `hzy_console`;

CREATE TABLE IF NOT EXISTS `directory_identity_reservations` (
  `reservation_id` CHAR(36) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `username` VARCHAR(100) NULL,
  `email` VARCHAR(255) NULL,
  `provider_code` VARCHAR(32) NULL COMMENT '外部身份来源，例如 dingtalk',
  `provider_subject` VARCHAR(255) NULL COMMENT '外部身份唯一标识；预留期间即锁定，防止同一主体被两条入职单占用',
  `source_app` VARCHAR(50) NULL COMMENT '发起方应用，例如 people',
  `source_biz_code` VARCHAR(191) NULL COMMENT '发起方业务键，例如 onboarding_code',
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME(3) NOT NULL,
  `consumed_at` DATETIME(3) NULL COMMENT '账号创建成功后置位',
  `released_at` DATETIME(3) NULL COMMENT '主动释放或过期回收时置位',
  `created_by_uid` VARCHAR(64) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- 只有 active 预留参与唯一性；已消费、已释放和已过期的不再占用标识符。
  `active_uid` VARCHAR(64) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN `uid` ELSE NULL END
  ) STORED,
  `active_username` VARCHAR(100) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN LOWER(`username`) ELSE NULL END
  ) STORED,
  `active_email` VARCHAR(255) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' THEN LOWER(`email`) ELSE NULL END
  ) STORED,
  `active_provider_subject` VARCHAR(320) GENERATED ALWAYS AS (
    CASE WHEN `status` = 'active' AND `provider_subject` IS NOT NULL
      THEN CONCAT(COALESCE(`provider_code`, ''), ':', `provider_subject`)
      ELSE NULL END
  ) STORED,

  PRIMARY KEY (`reservation_id`),
  UNIQUE KEY `uk_directory_reservation_active_uid` (`active_uid`),
  UNIQUE KEY `uk_directory_reservation_active_username` (`active_username`),
  UNIQUE KEY `uk_directory_reservation_active_email` (`active_email`),
  UNIQUE KEY `uk_directory_reservation_active_subject` (`active_provider_subject`),
  KEY `idx_directory_reservation_expiry` (`status`, `expires_at`),
  KEY `idx_directory_reservation_source` (`source_app`, `source_biz_code`),

  CONSTRAINT `ck_directory_reservation_status`
    CHECK (`status` IN ('active', 'consumed', 'released', 'expired')),
  -- 预留期间禁止出现 dt-* 合成主体。
  CONSTRAINT `ck_directory_reservation_uid`
    CHECK (`uid` = TRIM(`uid`) AND `uid` <> '' AND LOWER(`uid`) NOT LIKE 'dt-%'),
  CONSTRAINT `ck_directory_reservation_terminal`
    CHECK (
      (`status` = 'active' AND `consumed_at` IS NULL AND `released_at` IS NULL)
      OR (`status` = 'consumed' AND `consumed_at` IS NOT NULL)
      OR (`status` IN ('released', 'expired') AND `released_at` IS NOT NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'directory_identity_reservations' AS `table_name`, COUNT(*) AS `row_count`
FROM `directory_identity_reservations`;
