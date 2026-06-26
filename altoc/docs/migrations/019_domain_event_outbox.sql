-- Migration 019: Domain event outbox
-- Run in hzy_altoc or the target Altoc tenant database.

CREATE TABLE IF NOT EXISTS domain_event_outbox (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    event_key           VARCHAR(160) NOT NULL COMMENT '业务幂等事件键',
    event_type          VARCHAR(100) NOT NULL COMMENT '事件类型：LeadConverted等',
    aggregate_type      VARCHAR(50) NOT NULL COMMENT '聚合类型：lead/opportunity等',
    aggregate_id        BIGINT NOT NULL COMMENT '聚合ID',
    payload_json        JSON NOT NULL COMMENT '事件载荷',
    status              VARCHAR(20) DEFAULT 'pending' COMMENT '状态：pending/publishing/published/failed',
    attempts            INT DEFAULT 0 COMMENT '发布尝试次数',
    available_at        DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '可发布时间',
    published_at        DATETIME DEFAULT NULL COMMENT '发布时间',
    last_error          TEXT DEFAULT NULL COMMENT '最后错误',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_event_key (event_key),
    INDEX idx_status_available (status, available_at),
    INDEX idx_event_type (event_type),
    INDEX idx_aggregate (aggregate_type, aggregate_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='领域事件Outbox表';
