-- ============================================================
-- Migration 007: 回填原 OA 客户所在省、市
-- ============================================================
-- 源库：wizbizdb.wb_organization
-- 目标：hzy_altoc.customer
-- 关联规则：存量迁移客户编码为 CUMIG{wb_organization.org_id}

USE hzy_altoc;

DROP PROCEDURE IF EXISTS add_customer_column_if_missing;
DELIMITER $$
CREATE PROCEDURE add_customer_column_if_missing(IN p_column_name VARCHAR(64), IN p_column_def TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'customer'
      AND column_name = p_column_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE customer ADD COLUMN ', p_column_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL add_customer_column_if_missing('telephone', 'telephone VARCHAR(30) DEFAULT NULL COMMENT ''联系电话'' AFTER website');
CALL add_customer_column_if_missing('province', 'province VARCHAR(50) DEFAULT NULL COMMENT ''省/直辖市'' AFTER telephone');
CALL add_customer_column_if_missing('city', 'city VARCHAR(50) DEFAULT NULL COMMENT ''地市'' AFTER province');
CALL add_customer_column_if_missing('wechat_official_account', 'wechat_official_account VARCHAR(100) DEFAULT NULL COMMENT ''微信公众号'' AFTER city');
CALL add_customer_column_if_missing('started_at', 'started_at DATE DEFAULT NULL COMMENT ''源系统起始日期'' AFTER wechat_official_account');
CALL add_customer_column_if_missing('parent_customer_id', 'parent_customer_id BIGINT DEFAULT NULL COMMENT ''上级客户ID'' AFTER started_at');
CALL add_customer_column_if_missing('legacy_source', 'legacy_source VARCHAR(50) DEFAULT NULL COMMENT ''迁移来源系统'' AFTER last_follow_up_at');
CALL add_customer_column_if_missing('legacy_id', 'legacy_id BIGINT DEFAULT NULL COMMENT ''迁移来源主键'' AFTER legacy_source');
CALL add_customer_column_if_missing('legacy_stats_json', 'legacy_stats_json JSON DEFAULT NULL COMMENT ''源系统历史统计快照'' AFTER legacy_id');

DROP PROCEDURE IF EXISTS add_customer_column_if_missing;

UPDATE customer c
INNER JOIN wizbizdb.wb_organization o
        ON c.code = CONCAT('CUMIG', o.org_id)
SET c.province = NULLIF(TRIM(o.province), ''),
    c.city = NULLIF(TRIM(o.city), ''),
    c.telephone = COALESCE(NULLIF(c.telephone, ''), NULLIF(TRIM(o.telephone), '')),
    c.website = COALESCE(NULLIF(c.website, ''), NULLIF(TRIM(o.web_site), '')),
    c.wechat_official_account = COALESCE(NULLIF(c.wechat_official_account, ''), NULLIF(TRIM(o.weixin_number), '')),
    c.legacy_source = 'wizbizdb',
    c.legacy_id = o.org_id,
    c.updated_at = NOW()
WHERE c.deleted_at IS NULL
  AND c.code LIKE 'CUMIG%';
