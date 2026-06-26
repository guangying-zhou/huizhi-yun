-- ============================================================================
-- 汇智云平台第五批 SQL Migration 草案
-- 目标范围：
--   1. authorization_audit_logs
--
-- 说明：
--   - 本批次不是协议跑通的最小前提
--   - 建议在前四批稳定后再补
-- ============================================================================

CREATE TABLE authorization_audit_logs (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    company_code    VARCHAR(7) NULL COMMENT '所属公司编码',
    operator_uid    VARCHAR(50) NOT NULL COMMENT '操作人 uid',
    target_type     VARCHAR(30) NOT NULL COMMENT '对象类型：user/role/template/binding/override/deployment/license',
    target_id       VARCHAR(100) NOT NULL COMMENT '对象ID',
    action          VARCHAR(50) NOT NULL COMMENT '动作：create/update/delete/grant/exclude/publish/revoke',
    before_json     JSON NULL COMMENT '变更前快照',
    after_json      JSON NULL COMMENT '变更后快照',
    source          VARCHAR(100) NULL COMMENT '来源接口或任务',
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    KEY idx_authorization_audit_logs_company_code (company_code),
    KEY idx_authorization_audit_logs_operator_uid (operator_uid),
    KEY idx_authorization_audit_logs_target (target_type, target_id),
    KEY idx_authorization_audit_logs_action (action),
    KEY idx_authorization_audit_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='授权审计日志表';

SELECT COUNT(*) AS authorization_audit_logs_count FROM authorization_audit_logs;
