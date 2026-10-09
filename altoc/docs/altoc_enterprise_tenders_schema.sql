-- APF-16a new unified-domain installation candidate; do not run on standalone legacy Altoc.
-- Canonical fixed installer: internal/enterprise/domaininstall/altoc_tenders.json.

CREATE TABLE altoc_tender (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '投标编号(TD-xxxxxx)',
    name                    VARCHAR(200) NOT NULL COMMENT '项目名称',
    opportunity_id          BIGINT DEFAULT NULL COMMENT '关联商机ID',
    customer_id             BIGINT DEFAULT NULL COMMENT '关联客户ID',
    status                  VARCHAR(30) DEFAULT 'info_gathering' COMMENT '状态',
    project_code            VARCHAR(100) DEFAULT NULL COMMENT '项目编号(甲方)',
    budget_amount           DECIMAL(18,2) DEFAULT NULL COMMENT '项目预算金额',
    tender_type             VARCHAR(30) DEFAULT NULL COMMENT '招标类型：open/invited/negotiation/single_source/inquiry',
    publish_date            DATE DEFAULT NULL COMMENT '招标公告发布日期',
    registration_deadline   DATE DEFAULT NULL COMMENT '报名截止日期',
    bid_submission_deadline DATE DEFAULT NULL COMMENT '投标截止日期',
    bid_opening_date        DATE DEFAULT NULL COMMENT '开标日期',
    winning_notice_date     DATE DEFAULT NULL COMMENT '中标通知日期',
    bid_amount              DECIMAL(18,2) DEFAULT NULL COMMENT '我方投标金额',
    bid_bond_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '投标保证金',
    owner_user_id           VARCHAR(50) NOT NULL COMMENT '负责人',
    presales_user_id        VARCHAR(50) DEFAULT NULL COMMENT '售前负责人',
    tenderer_name           VARCHAR(200) DEFAULT NULL COMMENT '招标人名称(默认客户名)',
    agency_id               BIGINT DEFAULT NULL COMMENT '招标代理机构ID',
    contact_id              BIGINT DEFAULT NULL COMMENT '客户联系人ID',
    contact_phone           VARCHAR(30) DEFAULT NULL COMMENT '联系电话',
    contact_email           VARCHAR(100) DEFAULT NULL COMMENT '联系邮箱',
    competitors             TEXT DEFAULT NULL COMMENT '竞争对手信息',
    key_requirements        TEXT DEFAULT NULL COMMENT '关键要求/资质条件',
    -- 中标信息
    winning_amount          DECIMAL(18,2) DEFAULT NULL COMMENT '中标金额',
    -- 落标复盘
    lost_to                 VARCHAR(200) DEFAULT NULL COMMENT '中标方名称',
    lost_to_amount          DECIMAL(18,2) DEFAULT NULL COMMENT '中标方金额',
    lost_reason_type        VARCHAR(30) DEFAULT NULL COMMENT '落标原因分类：price/technical/qualification/relationship/other',
    lost_reason_detail      TEXT DEFAULT NULL COMMENT '落标详细分析',
    improvement_suggestion  TEXT DEFAULT NULL COMMENT '改进建议',
    review_by               VARCHAR(50) DEFAULT NULL COMMENT '复盘人',
    review_at               DATETIME DEFAULT NULL COMMENT '复盘时间',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    row_version INT UNSIGNED NOT NULL DEFAULT 1,
    owner_dept_code VARCHAR(50) DEFAULT NULL,
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_status (status),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_bid_submission_deadline (bid_submission_deadline),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投标项目表';

CREATE TABLE altoc_tender_agency (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    name            VARCHAR(200) NOT NULL COMMENT '机构名称',
    agency_type     VARCHAR(30) DEFAULT NULL COMMENT '代理类型：government/group/third_party',
    address         VARCHAR(500) DEFAULT NULL COMMENT '地址',
    contact_name    VARCHAR(50) DEFAULT NULL COMMENT '联系人',
    contact_phone   VARCHAR(30) DEFAULT NULL COMMENT '联系电话',
    contact_email   VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    row_version INT UNSIGNED NOT NULL DEFAULT 1,
    created_by VARCHAR(50) DEFAULT NULL,
    updated_by VARCHAR(50) DEFAULT NULL,
    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='招标代理机构表';

CREATE TABLE altoc_tender_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    tender_id       BIGINT NOT NULL COMMENT '投标项目ID',
    user_id         VARCHAR(50) NOT NULL COMMENT '用户ID',
    role            VARCHAR(30) DEFAULT 'member' COMMENT '角色：pm/business/presales/technical/finance/member',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_tender_user (tender_id, user_id),
    row_version INT UNSIGNED NOT NULL DEFAULT 1,
    created_by VARCHAR(50) DEFAULT NULL,
    updated_by VARCHAR(50) DEFAULT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_tender_id (tender_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投标团队成员表';

CREATE TABLE altoc_tender_milestone (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    tender_id           BIGINT NOT NULL COMMENT '投标项目ID',
    name                VARCHAR(200) NOT NULL COMMENT '节点名称',
    due_date            DATE DEFAULT NULL COMMENT '截止日期',
    status              VARCHAR(20) DEFAULT 'todo' COMMENT '状态：todo/in_progress/done/overdue',
    assignee_user_id    VARCHAR(50) DEFAULT NULL COMMENT '责任人',
    sort_no             INT DEFAULT 0 COMMENT '排序号',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    completed_at        DATETIME DEFAULT NULL COMMENT '完成时间',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    row_version INT UNSIGNED NOT NULL DEFAULT 1,
    created_by VARCHAR(50) DEFAULT NULL,
    updated_by VARCHAR(50) DEFAULT NULL,
    INDEX idx_tender_id (tender_id),
    INDEX idx_status (status),
    INDEX idx_due_date (due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投标关键节点表';
