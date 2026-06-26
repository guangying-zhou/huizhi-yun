-- ============================================
-- 汇智云模块模板 - 数据库表结构
-- 数据库名: hzy_template (请根据实际模块名修改)
-- ============================================

-- 系统参数表
CREATE TABLE IF NOT EXISTS `system_parameters` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `param_key` VARCHAR(100) NOT NULL COMMENT '参数键',
  `param_value` TEXT NOT NULL COMMENT '参数值',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '参数说明',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_param_key` (`param_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='系统参数表';

-- TODO: 根据业务需求添加更多表
