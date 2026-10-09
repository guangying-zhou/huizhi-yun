-- People 员工私密档案与 OA 历史入职日期补录。
-- 私密字段不进入 people_employees 通用资源，避免被普通 employees:view 列表暴露。

CREATE TABLE IF NOT EXISTS `people_employee_private_facts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `employee_uid` VARCHAR(64) NOT NULL,
  `field_code` ENUM('id_number', 'birth_date', 'education_level', 'major', 'graduation_school', 'graduation_date') NOT NULL,
  `source_code` ENUM('dingtalk', 'oa_archive', 'manual') NOT NULL,
  `value_text` VARCHAR(255) NOT NULL COMMENT '规范化字段值；身份证号属于高度敏感数据，仅限 employees/admin 接口读取且只返回掩码',
  `source_biz_id` VARCHAR(128) DEFAULT NULL,
  `source_updated_at` DATETIME DEFAULT NULL,
  `created_by` VARCHAR(64) DEFAULT NULL,
  `updated_by` VARCHAR(64) DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_employee_private_fact` (`employee_uid`, `field_code`, `source_code`),
  KEY `idx_people_employee_private_source` (`source_code`, `source_updated_at`),
  KEY `idx_people_employee_private_employee` (`employee_uid`, `field_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 员工私密档案分来源事实；有效值按钉钉、人工、OA 优先级解析';

ALTER TABLE `people_employees`
  MODIFY COLUMN `onboard_date_source`
    ENUM('dingtalk', 'oa_archive', 'manual')
    NULL DEFAULT NULL
    COMMENT '入职日期有效来源；钉钉有值时优先，否则可由 OA 历史档案或 HR 维护';

-- 旧列为 NOT NULL DEFAULT 'dingtalk'，因此历史空日期也被误标成钉钉来源。
-- 清理后 OA 导入和 HR 补录才能接管这些真正缺失的日期。
UPDATE `people_employees`
SET `onboard_date_source` = NULL
WHERE `onboard_date` IS NULL OR `onboard_date` = '1970-01-01';
