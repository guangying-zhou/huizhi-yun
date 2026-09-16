-- People 工号统一重排与自动编号序列。
--
-- 规则：
-- 1. 全部 people_employees 按入职日期升序编号，空日期排在最后；同日按 id 稳定排序。
-- 2. 第一名为 000，三位不足补零，超过 999 后自然扩展为 1000。
-- 3. 未完成/已完成但尚未关联员工的非取消入职单排在现有员工之后预留号码。
-- 4. 旧值与新值永久保存到 history 表，便于审计和必要时回退。
-- 5. 使用临时占位值分两阶段更新，避免 uk_people_employee_no 中途碰撞。
--
-- 建议在业务低峰执行；执行前确认没有正在进行的钉钉人事同步或入职资料保存。

CREATE TABLE IF NOT EXISTS `people_employee_number_sequences` (
  `sequence_code` VARCHAR(64) NOT NULL,
  `next_value` BIGINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '下一次尝试分配的十进制整数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sequence_code`),
  CONSTRAINT `ck_people_employee_number_sequence_nonnegative` CHECK (`next_value` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 并发安全业务编号序列';

CREATE TABLE IF NOT EXISTS `people_employee_number_reassignment_history` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `migration_code` VARCHAR(64) NOT NULL,
  `entity_type` ENUM('employee', 'onboarding_case') NOT NULL,
  `entity_key` VARCHAR(64) NOT NULL,
  `old_employee_no` VARCHAR(64) DEFAULT NULL,
  `new_employee_no` VARCHAR(64) NOT NULL,
  `onboard_date` DATE DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_people_employee_number_reassignment` (`migration_code`, `entity_type`, `entity_key`),
  KEY `idx_people_employee_number_reassignment_new` (`migration_code`, `new_employee_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='People 工号重排审计与回退映射';

ALTER TABLE `people_employees`
  MODIFY COLUMN `employee_no` VARCHAR(64) NOT NULL
    COMMENT 'People 自动分配工号；至少三位十进制数字';

ALTER TABLE `people_onboarding_cases`
  MODIFY COLUMN `employee_no` VARCHAR(64) DEFAULT NULL
    COMMENT 'People 自动工号；资料首次保存时分配且完成前必须唯一';

START TRANSACTION;

DROP TEMPORARY TABLE IF EXISTS `tmp_people_employee_number_map`;
CREATE TEMPORARY TABLE `tmp_people_employee_number_map` (
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `employee_uid` VARCHAR(64) NOT NULL,
  `old_employee_no` VARCHAR(64) NOT NULL,
  `new_employee_no` VARCHAR(64) NOT NULL,
  `onboard_date` DATE DEFAULT NULL,
  PRIMARY KEY (`employee_id`),
  UNIQUE KEY `uk_tmp_people_employee_number` (`new_employee_no`)
) ENGINE=InnoDB;

INSERT INTO `tmp_people_employee_number_map`
  (`employee_id`, `employee_uid`, `old_employee_no`, `new_employee_no`, `onboard_date`)
SELECT
  ranked.`id`,
  ranked.`employee_uid`,
  ranked.`employee_no`,
  LPAD(
    CAST(ranked.`sequence_value` AS CHAR),
    GREATEST(3, CHAR_LENGTH(CAST(ranked.`sequence_value` AS CHAR))),
    '0'
  ),
  ranked.`onboard_date`
FROM (
  SELECT
    employee.`id`,
    employee.`employee_uid`,
    employee.`employee_no`,
    employee.`onboard_date`,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN employee.`onboard_date` IS NULL THEN 1 ELSE 0 END,
        employee.`onboard_date`,
        employee.`id`
    ) - 1 AS `sequence_value`
  FROM `people_employees` employee
) ranked;

SET @people_employee_count = (SELECT COUNT(*) FROM `tmp_people_employee_number_map`);

DROP TEMPORARY TABLE IF EXISTS `tmp_people_onboarding_number_map`;
CREATE TEMPORARY TABLE `tmp_people_onboarding_number_map` (
  `onboarding_id` BIGINT UNSIGNED NOT NULL,
  `onboarding_code` VARCHAR(64) NOT NULL,
  `old_employee_no` VARCHAR(64) DEFAULT NULL,
  `new_employee_no` VARCHAR(64) NOT NULL,
  `onboard_date` DATE DEFAULT NULL,
  `linked_employee` TINYINT(1) NOT NULL,
  PRIMARY KEY (`onboarding_id`),
  UNIQUE KEY `uk_tmp_people_onboarding_number` (`new_employee_no`)
) ENGINE=InnoDB;

-- 已经关联正式员工的入职单沿用该员工的新工号。
INSERT INTO `tmp_people_onboarding_number_map`
  (`onboarding_id`, `onboarding_code`, `old_employee_no`, `new_employee_no`, `onboard_date`, `linked_employee`)
SELECT
  onboarding.`id`,
  onboarding.`onboarding_code`,
  onboarding.`employee_no`,
  employee_map.`new_employee_no`,
  COALESCE(onboarding.`planned_onboard_date`, onboarding.`source_onboard_date`),
  1
FROM `people_onboarding_cases` onboarding
INNER JOIN `tmp_people_employee_number_map` employee_map
  ON employee_map.`employee_uid` = onboarding.`canonical_uid`
WHERE onboarding.`status` <> 'cancelled';

-- 尚未关联正式员工的有效入职单在现有员工之后继续预留号码。
INSERT INTO `tmp_people_onboarding_number_map`
  (`onboarding_id`, `onboarding_code`, `old_employee_no`, `new_employee_no`, `onboard_date`, `linked_employee`)
SELECT
  ranked.`id`,
  ranked.`onboarding_code`,
  ranked.`employee_no`,
  LPAD(
    CAST(@people_employee_count + ranked.`sequence_offset` AS CHAR),
    GREATEST(3, CHAR_LENGTH(CAST(@people_employee_count + ranked.`sequence_offset` AS CHAR))),
    '0'
  ),
  ranked.`onboard_date`,
  0
FROM (
  SELECT
    onboarding.`id`,
    onboarding.`onboarding_code`,
    onboarding.`employee_no`,
    COALESCE(onboarding.`planned_onboard_date`, onboarding.`source_onboard_date`) AS `onboard_date`,
    ROW_NUMBER() OVER (
      ORDER BY
        CASE WHEN COALESCE(onboarding.`planned_onboard_date`, onboarding.`source_onboard_date`) IS NULL THEN 1 ELSE 0 END,
        COALESCE(onboarding.`planned_onboard_date`, onboarding.`source_onboard_date`),
        onboarding.`id`
    ) - 1 AS `sequence_offset`
  FROM `people_onboarding_cases` onboarding
  LEFT JOIN `people_employees` employee
    ON employee.`employee_uid` = onboarding.`canonical_uid`
  WHERE onboarding.`status` <> 'cancelled'
    AND employee.`id` IS NULL
) ranked;

INSERT INTO `people_employee_number_reassignment_history`
  (`migration_code`, `entity_type`, `entity_key`, `old_employee_no`, `new_employee_no`, `onboard_date`)
SELECT '20260904_employee_number_sequence', 'employee', `employee_uid`, `old_employee_no`, `new_employee_no`, `onboard_date`
FROM `tmp_people_employee_number_map`
ON DUPLICATE KEY UPDATE
  `new_employee_no` = VALUES(`new_employee_no`),
  `onboard_date` = VALUES(`onboard_date`);

INSERT INTO `people_employee_number_reassignment_history`
  (`migration_code`, `entity_type`, `entity_key`, `old_employee_no`, `new_employee_no`, `onboard_date`)
SELECT '20260904_employee_number_sequence', 'onboarding_case', `onboarding_code`, `old_employee_no`, `new_employee_no`, `onboard_date`
FROM `tmp_people_onboarding_number_map`
ON DUPLICATE KEY UPDATE
  `new_employee_no` = VALUES(`new_employee_no`),
  `onboard_date` = VALUES(`onboard_date`);

UPDATE `people_employees` employee
INNER JOIN `tmp_people_employee_number_map` employee_map
  ON employee_map.`employee_id` = employee.`id`
SET employee.`employee_no` = CONCAT('~20260904E', LPAD(employee.`id`, 20, '0'));

UPDATE `people_onboarding_cases` onboarding
INNER JOIN `tmp_people_onboarding_number_map` onboarding_map
  ON onboarding_map.`onboarding_id` = onboarding.`id`
SET onboarding.`employee_no` = CONCAT('~20260904O', LPAD(onboarding.`id`, 20, '0'));

UPDATE `people_employees` employee
INNER JOIN `tmp_people_employee_number_map` employee_map
  ON employee_map.`employee_id` = employee.`id`
SET employee.`employee_no` = employee_map.`new_employee_no`,
    employee.`updated_by` = 'migration:20260904_employee_number_sequence',
    employee.`updated_at` = NOW();

UPDATE `people_onboarding_cases` onboarding
INNER JOIN `tmp_people_onboarding_number_map` onboarding_map
  ON onboarding_map.`onboarding_id` = onboarding.`id`
SET onboarding.`employee_no` = onboarding_map.`new_employee_no`,
    onboarding.`updated_by` = 'migration:20260904_employee_number_sequence',
    onboarding.`updated_at` = NOW();

SET @people_unlinked_onboarding_count = (
  SELECT COUNT(*) FROM `tmp_people_onboarding_number_map` WHERE `linked_employee` = 0
);
SET @people_employee_number_next = @people_employee_count + @people_unlinked_onboarding_count;

INSERT INTO `people_employee_number_sequences` (`sequence_code`, `next_value`)
VALUES ('employee_no', @people_employee_number_next)
ON DUPLICATE KEY UPDATE
  `next_value` = GREATEST(`next_value`, VALUES(`next_value`)),
  `updated_at` = NOW();

COMMIT;

-- 返回本次员工新旧工号映射，建议保存执行结果。
SELECT
  `entity_key` AS `employee_uid`,
  `old_employee_no`,
  `new_employee_no`,
  `onboard_date`
FROM `people_employee_number_reassignment_history`
WHERE `migration_code` = '20260904_employee_number_sequence'
  AND `entity_type` = 'employee'
ORDER BY CAST(`new_employee_no` AS UNSIGNED), `entity_key`;
