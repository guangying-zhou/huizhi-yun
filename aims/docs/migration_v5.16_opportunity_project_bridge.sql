-- Aims v5.16: Altoc 商机到售前/销售项目的业务幂等约束。

DELIMITER $$

DROP PROCEDURE IF EXISTS `aims_apply_v5_16`$$
CREATE PROCEDURE `aims_apply_v5_16`()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `aims_projects`
    WHERE `opp_id` IS NOT NULL AND `category` IN ('presales', 'sales')
    GROUP BY `opp_id`, `category`
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Aims v5.16 preflight failed: duplicate opp_id + category projects must be consolidated first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'aims_projects'
      AND INDEX_NAME = 'uk_aims_project_opportunity_category'
  ) THEN
    ALTER TABLE `aims_projects`
      ADD UNIQUE KEY `uk_aims_project_opportunity_category` (`opp_id`, `category`);
  END IF;
END$$

CALL `aims_apply_v5_16`()$$
DROP PROCEDURE IF EXISTS `aims_apply_v5_16`$$

DELIMITER ;
