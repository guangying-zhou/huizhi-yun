-- APF-09d candidate only. Use reviewed domaininstall plan/apply/verify/rollback.
-- Do not run this DDL directly against a running Runtime.
CREATE TABLE `people_employee_private_facts` (
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
