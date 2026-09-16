-- Aims v5.11: 公司项目周报汇总可编辑草稿。
-- 发布内容仍写入 company_weekly_summary_versions，不覆盖历史版本。

SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'company_weekly_summaries'
    AND column_name = 'draft_content_json'
);

SET @ddl := IF(
  @column_exists = 0,
  'ALTER TABLE company_weekly_summaries ADD COLUMN draft_content_json JSON DEFAULT NULL COMMENT ''仅当前草稿可变；发布版本使用不可变快照'' AFTER codocs_document_uuid',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
