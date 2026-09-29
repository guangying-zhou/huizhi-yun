-- Backfill schema drift, 2026-09-29.
-- assets_schema.sql gained three columns in earlier commits (0308e125, f70100ba)
-- without a migration, so a database that was built from an older canonical
-- schema (for example the restored production copy) lacks them while the
-- Assets Runtime reads and writes them. Definitions are copied verbatim from
-- assets_schema.sql (type, ENUM values, default, comment, position).
--
-- Precondition (fail closed): none of the three columns may exist yet. If any
-- already exists the guard below selects from a non-existent table, which
-- aborts this file before any change; inspect the database instead of
-- re-running. DDL is not transactional: take an encrypted backup first.
-- Verify: 20260929_backfill_schema_drift_verify.sql (3 PASS).
-- Rollback: 20260929_backfill_schema_drift_rollback.sql (only while unused).
SET @hzy_drift_existing = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND ((TABLE_NAME = 'asset_physical_details' AND COLUMN_NAME = 'config_detail')
      OR (TABLE_NAME = 'asset_documents' AND COLUMN_NAME IN ('artifact_type', 'source_context')))
);
SET @hzy_drift_guard = IF(@hzy_drift_existing = 0, 'SELECT 1', 'SELECT * FROM hzy_schema_drift_columns_already_exist');
PREPARE hzy_drift_guard_stmt FROM @hzy_drift_guard;
EXECUTE hzy_drift_guard_stmt;
DEALLOCATE PREPARE hzy_drift_guard_stmt;

ALTER TABLE `asset_physical_details`
  ADD COLUMN `config_detail` TEXT DEFAULT NULL COMMENT '详细配置，如 CPU/内存/磁盘/尺寸/配件说明' AFTER `model`;

ALTER TABLE `asset_documents`
  ADD COLUMN `artifact_type` ENUM('solution', 'requirement', 'design', 'test_report', 'deployment_manual', 'acceptance_report', 'training_material', 'ops_knowledge', 'customer_environment_record') DEFAULT NULL COMMENT '交付成果类型：方案/需求/设计/测试报告/部署手册/验收报告/培训材料/运维知识/客户环境记录' AFTER `document_type`,
  ADD COLUMN `source_context` JSON DEFAULT NULL COMMENT '来源上下文：source_app/source_biz/project/milestone/customer/contract/delivery' AFTER `artifact_type`;
