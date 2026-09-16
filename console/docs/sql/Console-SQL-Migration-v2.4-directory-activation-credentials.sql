-- v2.4: 目录账号一次性激活凭据。
-- 可重复执行；只建表，不改写任何既有目录数据。
--
-- People 受控入职要求 People 不接收明文初始密码。账号以 Console 生成、
-- 谁都不知道也不留存的一次性口令创建，员工凭激活凭据自行设定真实密码。
-- 表中只保存令牌的 SHA-256，明文令牌只在签发响应里出现一次。

CREATE TABLE IF NOT EXISTS `directory_activation_credentials` (
  `credential_id` CHAR(36) NOT NULL,
  `uid` VARCHAR(64) NOT NULL,
  `token_sha256` CHAR(64) NOT NULL,
  `purpose` VARCHAR(32) NOT NULL DEFAULT 'initial_activation',
  `source_app` VARCHAR(50) NULL COMMENT '签发来源应用，例如 people；Console 管理员签发为 NULL',
  `issued_operation_id` CHAR(36) NULL COMMENT '触发签发的建号 operation',
  `redeem_operation_id` CHAR(36) NULL COMMENT '兑换时排队的改密 operation',
  `attempt_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `expires_at` DATETIME(3) NOT NULL,
  `redeemed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`credential_id`),
  -- 令牌哈希唯一，保证同一个令牌不可能对应两条记录。
  UNIQUE KEY `uk_directory_activation_token` (`token_sha256`),
  -- 每个 uid 同时只允许一条 active 凭据：重新签发必须先作废旧的，
  -- 否则一个账号会存在多条并行有效的激活路径。
  KEY `idx_directory_activation_uid_status` (`uid`, `status`, `expires_at`),
  CONSTRAINT `ck_directory_activation_status`
    CHECK (`status` IN ('active', 'redeemed', 'revoked', 'expired')),
  CONSTRAINT `ck_directory_activation_purpose`
    CHECK (`purpose` IN ('initial_activation', 'password_reset')),
  CONSTRAINT `ck_directory_activation_terminal`
    CHECK (
      (`status` = 'redeemed' AND `redeemed_at` IS NOT NULL)
      OR (`status` <> 'redeemed' AND `redeemed_at` IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT 'directory_activation_credentials' AS `table_name`, COUNT(*) AS `row_count`
FROM `directory_activation_credentials`;
