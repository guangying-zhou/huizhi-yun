-- ============================================================
-- Migration 001: 行业/区域迁移到 Account 统一管理
-- ============================================================
USE hzy_altoc;
-- ============================================================
-- 背景：按平台规范，业务字典中的"行业"和"区域"统一由 account 模块
-- （通过 /api/v1/business-domains 和 /api/v1/companies/:code/regions）提供，
-- altoc 不再维护本地字典表。
--
-- 影响范围：
--   - customer.industry_id BIGINT → industry_code VARCHAR(64)
--   - customer.region_id   BIGINT → region_code   VARCHAR(64)
--   - 删除本地 industry / region 两张配置表
--
-- ⚠️ 注意：如果生产库已有数据，需要先按下方"数据迁移"部分
--   把旧 BIGINT id 映射到 account 的 domainCode / regionCode 再执行。
-- ============================================================

-- 1. 客户表字段改名（同时扩容为 VARCHAR）
ALTER TABLE customer
  ADD COLUMN industry_code VARCHAR(64) DEFAULT NULL COMMENT '所属行业编码（对应 account business-domain.domainCode）' AFTER customer_type_id,
  ADD COLUMN region_code   VARCHAR(64) DEFAULT NULL COMMENT '所属区域编码（对应 account region.regionCode）'         AFTER industry_code;

-- 数据迁移：如果旧 industry/region 表仍在，且 code 字段就等于 account 的 domainCode/regionCode，
-- 那么可以直接通过 code 回填。需要根据实际情况调整映射。
-- UPDATE customer c
--   LEFT JOIN industry i ON c.industry_id = i.id
--   LEFT JOIN region   r ON c.region_id   = r.id
--   SET c.industry_code = i.code,
--       c.region_code   = r.code
--   WHERE c.deleted_at IS NULL;

-- 2. 删除旧列和索引
ALTER TABLE customer
  DROP INDEX idx_industry_id,
  DROP INDEX idx_region_id,
  DROP COLUMN industry_id,
  DROP COLUMN region_id;

ALTER TABLE customer
  ADD INDEX idx_industry_code (industry_code),
  ADD INDEX idx_region_code   (region_code);

-- 3. 删除本地字典表（数据已不再使用）
DROP TABLE IF EXISTS industry;
DROP TABLE IF EXISTS region;
