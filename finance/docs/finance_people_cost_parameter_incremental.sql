-- ============================================
-- Finance people cost parameter incremental migration
-- 适用场景：已执行旧版 finance_schema.sql 的租户库，补齐 People 职级成本计算所需参数
-- 执行说明：
-- 1. 连接客户侧 Finance 数据库后执行本文件
-- 2. 不需要删除数据库或重建已有 Finance 表
-- 3. 参数后续在 Finance「财务设置 / 人力成本参数」中按有效期维护
-- ============================================
SET NAMES utf8mb4;
USE `hzy_finance`;

CREATE TABLE IF NOT EXISTS `finance_people_cost_parameter` (
  `id` BIGINT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `code` VARCHAR(50) NOT NULL COMMENT '参数编码',
  `name` VARCHAR(100) NOT NULL COMMENT '参数名称',
  `effective_from` DATE NOT NULL COMMENT '生效日期',
  `effective_to` DATE DEFAULT NULL COMMENT '失效日期',
  `base_salary` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '基本工资基数',
  `welfare_cost_rate` DECIMAL(10,4) NOT NULL DEFAULT 0.0000 COMMENT '福利成本费率',
  `management_allocation_rate` DECIMAL(10,4) NOT NULL DEFAULT 0.0000 COMMENT '管理分摊系数',
  `resource_allocation_cost` DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '固定资源分摊成本',
  `currency_code` VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
  `status` VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
  `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
  `created_by` VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  `updated_by` VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_cost_parameter_code` (`code`),
  KEY `idx_people_cost_parameter_effective` (`status`, `effective_from`, `effective_to`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Finance 人力成本核算参数';

INSERT INTO `finance_people_cost_parameter` (
  `code`, `name`, `effective_from`, `base_salary`, `welfare_cost_rate`, `management_allocation_rate`,
  `resource_allocation_cost`, `currency_code`, `status`, `remark`
) VALUES (
  'PCP-DEFAULT-2026', '默认人力成本参数', '2026-01-01', 8000.00, 0.3000, 0.2000,
  2000.00, 'CNY', 'active', '用于 People 职级标准成本快照生成；可按有效期新增版本覆盖'
) ON DUPLICATE KEY UPDATE
  `name` = VALUES(`name`),
  `effective_from` = VALUES(`effective_from`),
  `base_salary` = VALUES(`base_salary`),
  `welfare_cost_rate` = VALUES(`welfare_cost_rate`),
  `management_allocation_rate` = VALUES(`management_allocation_rate`),
  `resource_allocation_cost` = VALUES(`resource_allocation_cost`),
  `currency_code` = VALUES(`currency_code`),
  `status` = VALUES(`status`),
  `remark` = VALUES(`remark`);
