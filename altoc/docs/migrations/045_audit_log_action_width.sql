-- 加宽 audit_log.action（走查 ISSUE-B-022）。
--
-- audit_log.action 是 VARCHAR(20)，注释里的示例值都很短
-- （create/update/delete/status_change/approve/reject），但代码后来引入了长得多的
-- 语义动作名。在 STRICT_TRANS_TABLES 下，超长写入会抛 MySQL 1406
-- "Data too long for column 'action'"，而 altoc/finance 都没有 MySQL 错误码映射，
-- 该错误经 data-runtime writeError 兜底成 500 internal_error，BFF 再包成
-- 503 "Tenant Runtime unavailable"，用户只看到 "Internal server error"。
--
-- 三处超长动作名（均导致对应流程在生产必然失败）：
--   'aims_work_item_dispatch'  23 字符  服务工单派发到 Aims
--   'invoice_request_freeze'   22 字符  回款计划发起开票申请（主线）
--   'create_from_quotation'    21 字符  报价转合同（主线）
--
-- 这不是 schema 漂移：altoc_schema.sql 自己声明的也是 VARCHAR(20)，
-- 是代码写入值超出了自身 schema 契约，且这三条流程从未在真实环境跑过。
--
-- 选择加宽而不是改短动作名：动作名是审计语义的一部分，改短会牺牲可读性，
-- 且新动作还会继续变长。64 字符与本库其他语义列（source_biz_type 等）一致。
--
-- 幂等：仅在当前宽度小于 64 时执行。

USE hzy_altoc;

SET @needs_widen := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'audit_log'
    AND COLUMN_NAME = 'action'
    AND CHARACTER_MAXIMUM_LENGTH < 64
);

SET @ddl := IF(@needs_widen > 0,
  'ALTER TABLE `audit_log` MODIFY COLUMN `action` VARCHAR(64) NOT NULL COMMENT ''操作类型：create/update/delete/status_change/approve/reject 等语义动作名''',
  'SELECT ''audit_log.action already >= 64'' AS skipped'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 核验：应返回 64。
-- SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
-- WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_log' AND COLUMN_NAME = 'action';
