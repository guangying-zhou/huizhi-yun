-- ============================================================
-- huizhi-yun Altoc 模块完整数据库脚本
-- 数据库名: hzy_altoc
-- 版本: v1.0
-- 创建日期: 2026-03-21
-- 说明: LTC 经营平台 MVP 数据库结构 + 种子数据
-- 基于: Altoc_Data_Model.md, Altoc_Design_Doc.md
-- ============================================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS hzy_altoc
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE hzy_altoc;

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 一、基础配置表
-- ============================================================

-- ------------------------------------------------------------
-- 1.1 行业 / 1.2 区域：已迁移至 Account 模块统一管理
-- ------------------------------------------------------------
-- 行业（business domain）：GET /api/v1/companies/:code/business-domains
-- 区域（region）：          GET /api/v1/companies/:code/regions
-- altoc 通过 server/utils/accountDict.ts 代理获取
-- 见 docs/migrations/001_industry_region_to_account.sql

-- ------------------------------------------------------------
-- 1.3 客户等级配置表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS customer_level;
CREATE TABLE customer_level (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code        VARCHAR(50) NOT NULL COMMENT '等级编码',
    name        VARCHAR(100) NOT NULL COMMENT '等级名称',
    sort_no     INT DEFAULT 0 COMMENT '排序号',
    is_enabled  TINYINT DEFAULT 1 COMMENT '是否启用：1启用 0禁用',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户等级配置表';

-- ------------------------------------------------------------
-- 1.4 客户类型配置表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS customer_type;
CREATE TABLE customer_type (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(50) NOT NULL COMMENT '类型编码',
    name            VARCHAR(100) NOT NULL COMMENT '类型名称',
    is_partner_type TINYINT DEFAULT 0 COMMENT '是否渠道伙伴类型：1是 0否',
    is_enabled      TINYINT DEFAULT 1 COMMENT '是否启用：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户类型配置表';

-- ------------------------------------------------------------
-- 1.5 商机阶段配置表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS opportunity_stage;
CREATE TABLE opportunity_stage (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '阶段编码',
    pipeline_code       VARCHAR(50) NOT NULL DEFAULT 'default' COMMENT '销售管线模板：default/solution/tog_project',
    name                VARCHAR(100) NOT NULL COMMENT '阶段名称',
    stage_kind          VARCHAR(30) DEFAULT 'normal' COMMENT '阶段类型：normal/won/lost/paused',
    sort_no             INT DEFAULT 0 COMMENT '排序号',
    win_rate            DECIMAL(5,2) DEFAULT 0.00 COMMENT '默认赢率(%)',
    is_closed           TINYINT DEFAULT 0 COMMENT '是否关闭阶段：1是 0否',
    is_won              TINYINT DEFAULT 0 COMMENT '是否赢单阶段：1是 0否',
    is_lost             TINYINT DEFAULT 0 COMMENT '是否输单阶段：1是 0否',
    required_fields_json JSON DEFAULT NULL COMMENT '必填字段JSON',
    exit_criteria_json  JSON DEFAULT NULL COMMENT '退出标准JSON',
    is_enabled          TINYINT DEFAULT 1 COMMENT '是否启用：1启用 0禁用',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_pipeline_sort (pipeline_code, sort_no, id),
    INDEX idx_stage_kind (stage_kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商机阶段配置表';

-- ------------------------------------------------------------
-- 1.6 付款条款模板表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS payment_term_template;
CREATE TABLE payment_term_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(50) NOT NULL COMMENT '模板编码',
    name            VARCHAR(100) NOT NULL COMMENT '模板名称',
    template_json   JSON NOT NULL COMMENT '模板内容JSON',
    is_enabled      TINYINT DEFAULT 1 COMMENT '是否启用：1启用 0禁用',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='付款条款模板表';

-- ------------------------------------------------------------
-- 1.7 审批规则配置表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS approval_rule;
CREATE TABLE approval_rule (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(50) NOT NULL COMMENT '规则编码',
    rule_type           VARCHAR(50) NOT NULL COMMENT '规则类型：quotation_discount/quotation_margin/contract_amount/expense',
    rule_name           VARCHAR(100) NOT NULL COMMENT '规则名称',
    condition_json      JSON NOT NULL COMMENT '条件配置JSON',
    approver_scope_json JSON DEFAULT NULL COMMENT '审批人范围JSON',
    is_enabled          TINYINT DEFAULT 1 COMMENT '是否启用：1启用 0禁用',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审批规则配置表';

-- ------------------------------------------------------------
-- 1.8 角色表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS role;
CREATE TABLE role (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(50) NOT NULL COMMENT '角色编码',
    name            VARCHAR(100) NOT NULL COMMENT '角色名称',
    description     VARCHAR(500) DEFAULT NULL COMMENT '角色描述',
    is_system_role  TINYINT DEFAULT 0 COMMENT '是否系统角色：1是 0否',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色表';

-- ------------------------------------------------------------
-- 1.9 权限表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS permission;
CREATE TABLE permission (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    resource_code   VARCHAR(100) NOT NULL COMMENT '资源编码',
    action_code     VARCHAR(50) NOT NULL COMMENT '操作编码：view/create/edit/delete/approve/export/领域动作/admin',
    description     VARCHAR(200) DEFAULT NULL COMMENT '权限描述',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_resource_action (resource_code, action_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='权限表';

-- ------------------------------------------------------------
-- 1.10 角色权限关联表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS role_permission;
CREATE TABLE role_permission (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    role_id         BIGINT NOT NULL COMMENT '角色ID',
    permission_id   BIGINT NOT NULL COMMENT '权限ID',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_role_perm (role_id, permission_id),
    INDEX idx_role_id (role_id),
    INDEX idx_permission_id (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色权限关联表';

-- ------------------------------------------------------------
-- 1.11 用户角色关联表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS user_role;
CREATE TABLE user_role (
    id          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    user_id     VARCHAR(50) NOT NULL COMMENT '用户ID(Account模块uid)',
    role_id     BIGINT NOT NULL COMMENT '角色ID',
    scope_type  VARCHAR(20) DEFAULT 'all' COMMENT '数据范围：self/dept/dept_tree/all',
    scope_id    VARCHAR(50) DEFAULT NULL COMMENT '范围关联ID(部门编码等)',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_user_role (user_id, role_id),
    INDEX idx_user_id (user_id),
    INDEX idx_role_id (role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户角色关联表';

-- ============================================================
-- 二、核心业务表
-- ============================================================

-- ------------------------------------------------------------
-- 2.1 客户表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS customer;
CREATE TABLE customer (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(30) NOT NULL COMMENT '客户编号(CU-xxxxxx)',
    name                VARCHAR(200) NOT NULL COMMENT '客户名称',
    normalized_name     VARCHAR(200) DEFAULT NULL COMMENT '标准化客户名称，用于去重匹配',
    unified_social_credit_code VARCHAR(50) DEFAULT NULL COMMENT '统一社会信用代码',
    organization_domain VARCHAR(200) DEFAULT NULL COMMENT '组织官网/邮箱域名，用于去重匹配',
    short_name          VARCHAR(100) DEFAULT NULL COMMENT '客户简称',
    customer_type_id    BIGINT DEFAULT NULL COMMENT '客户类型ID',
    industry_code       VARCHAR(64) DEFAULT NULL COMMENT '所属行业编码（account business-domain.domainCode）',
    region_code         VARCHAR(64) DEFAULT NULL COMMENT '所属区域编码（account region.regionCode）',
    customer_level_id   BIGINT DEFAULT NULL COMMENT '客户等级ID',
    source_type         VARCHAR(50) DEFAULT NULL COMMENT '来源渠道：marketing/referral/visit/tender/partner/other',
    status              VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/approval_pending/approved/active/inactive/archived',
    owner_user_id       VARCHAR(50) NOT NULL COMMENT '归属人(Account模块uid)',
    owner_dept_code     VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    website             VARCHAR(300) DEFAULT NULL COMMENT '官网地址',
    telephone           VARCHAR(30) DEFAULT NULL COMMENT '联系电话',
    province            VARCHAR(50) DEFAULT NULL COMMENT '省/直辖市',
    city                VARCHAR(50) DEFAULT NULL COMMENT '地市',
    wechat_official_account VARCHAR(100) DEFAULT NULL COMMENT '微信公众号',
    started_at          DATE DEFAULT NULL COMMENT '源系统起始日期',
    parent_customer_id  BIGINT DEFAULT NULL COMMENT '上级客户ID',
    address             VARCHAR(500) DEFAULT NULL COMMENT '详细地址',
    description         TEXT DEFAULT NULL COMMENT '客户描述',
    is_partner          TINYINT DEFAULT 0 COMMENT '是否渠道伙伴：1是 0否',
    credit_level        VARCHAR(20) DEFAULT NULL COMMENT '信用等级：A/B/C/D',
    last_follow_up_at   DATETIME DEFAULT NULL COMMENT '最近跟进时间',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    legacy_stats_json   JSON DEFAULT NULL COMMENT '源系统历史统计快照',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_name (name),
    INDEX idx_normalized_name (normalized_name),
    INDEX idx_unified_social_credit_code (unified_social_credit_code),
    INDEX idx_organization_domain (organization_domain),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_industry_code (industry_code),
    INDEX idx_region_code (region_code),
    INDEX idx_customer_level_id (customer_level_id),
    INDEX idx_parent_customer_id (parent_customer_id),
    UNIQUE KEY uk_customer_legacy (legacy_source, legacy_id),
    INDEX idx_status (status),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户表';

-- ------------------------------------------------------------
-- 2.2 联系人表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contact;
CREATE TABLE contact (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    customer_id         BIGINT NOT NULL COMMENT '所属客户ID',
    name                VARCHAR(50) NOT NULL COMMENT '联系人姓名',
    gender              TINYINT DEFAULT 0 COMMENT '性别：0未知 1男 2女',
    dept_name           VARCHAR(100) DEFAULT NULL COMMENT '部门名称',
    job_title           VARCHAR(100) DEFAULT NULL COMMENT '职位',
    mobile              VARCHAR(30) DEFAULT NULL COMMENT '手机号',
    normalized_mobile   VARCHAR(30) DEFAULT NULL COMMENT '标准化手机号，用于去重匹配',
    alternate_mobile    VARCHAR(30) DEFAULT NULL COMMENT '备用手机号',
    phone               VARCHAR(30) DEFAULT NULL COMMENT '固定电话',
    email               VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
    normalized_email    VARCHAR(100) DEFAULT NULL COMMENT '标准化邮箱，用于去重匹配',
    wechat              VARCHAR(100) DEFAULT NULL COMMENT '微信号',
    mailing_address     VARCHAR(500) DEFAULT NULL COMMENT '快递/联系地址',
    star_level          INT DEFAULT NULL COMMENT '源系统星级编码',
    decision_role       VARCHAR(30) DEFAULT NULL COMMENT '决策角色：decision_maker/purchaser/tech_influencer/user/other',
    influence_level     VARCHAR(20) DEFAULT NULL COMMENT '影响力等级：high/medium/low',
    is_key_contact      TINYINT DEFAULT 0 COMMENT '是否关键联系人：1是 0否',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    owner_user_id       VARCHAR(50) DEFAULT NULL COMMENT '归属人',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    INDEX idx_customer_id (customer_id),
    INDEX idx_name (name),
    INDEX idx_normalized_mobile (normalized_mobile),
    INDEX idx_normalized_email (normalized_email),
    INDEX idx_is_key_contact (is_key_contact),
    UNIQUE KEY uk_contact_legacy (legacy_source, legacy_id),
    CONSTRAINT fk_contact_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='联系人表';

-- ------------------------------------------------------------
-- 2.2.1 客户开票信息表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS customer_invoice_info;
CREATE TABLE customer_invoice_info (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    customer_id         BIGINT NOT NULL COMMENT '所属客户ID',
    taxpayer_name       VARCHAR(200) DEFAULT NULL COMMENT '发票抬头/购方名称',
    taxpayer_no         VARCHAR(50) DEFAULT NULL COMMENT '纳税人识别号/统一社会信用代码',
    registered_address  VARCHAR(500) DEFAULT NULL COMMENT '注册地址',
    registered_phone    VARCHAR(50) DEFAULT NULL COMMENT '注册电话',
    bank_name           VARCHAR(200) DEFAULT NULL COMMENT '开户行',
    bank_account        VARCHAR(100) DEFAULT NULL COMMENT '银行账号',
    invoice_type        VARCHAR(30) DEFAULT 'special_vat' COMMENT '默认发票类型：special_vat/general_vat/electronic',
    invoice_email       VARCHAR(100) DEFAULT NULL COMMENT '收票邮箱',
    receiver_name       VARCHAR(100) DEFAULT NULL COMMENT '收票人',
    receiver_phone      VARCHAR(50) DEFAULT NULL COMMENT '收票电话',
    receiver_address    VARCHAR(500) DEFAULT NULL COMMENT '收票地址',
    is_default          TINYINT DEFAULT 1 COMMENT '是否默认开票信息：1是 0否',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_customer_invoice_info_customer (customer_id),
    UNIQUE KEY uk_customer_invoice_info_legacy (legacy_source, legacy_id),
    INDEX idx_taxpayer_no (taxpayer_no),
    INDEX idx_status (status),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_customer_invoice_info_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户开票信息表';

-- ------------------------------------------------------------
-- 2.3 线索表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS `lead`;
CREATE TABLE `lead` (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '线索编号(LE-xxxxxx)',
    name                    VARCHAR(200) NOT NULL COMMENT '线索名称',
    org_name                VARCHAR(200) DEFAULT NULL COMMENT '组织/公司名称',
    source_type             VARCHAR(50) DEFAULT NULL COMMENT '来源类型：marketing/referral/visit/tender/partner/website/other',
    source_detail           VARCHAR(200) DEFAULT NULL COMMENT '来源详情',
    need_summary            VARCHAR(1000) DEFAULT NULL COMMENT '真实需求或客户问题摘要',
    project_type            VARCHAR(30) DEFAULT NULL COMMENT '项目类型：tob/tog/renewal/upsell/channel',
    budget_status           VARCHAR(30) DEFAULT NULL COMMENT '预算状态：unknown/applying/approved/allocated',
    estimated_budget        DECIMAL(18,2) DEFAULT NULL COMMENT '初步预算',
    procurement_mode        VARCHAR(50) DEFAULT NULL COMMENT '采购方式：direct/competitive_consultation/open_tender/framework/other',
    expected_procurement_date DATE DEFAULT NULL COMMENT '预计采购时间',
    source_evidence_url     VARCHAR(500) DEFAULT NULL COMMENT '来源证据链接',
    qualification_result    VARCHAR(30) DEFAULT NULL COMMENT '资格判定：passed/nurture/invalid/duplicate',
    qualification_reason_code VARCHAR(50) DEFAULT NULL COMMENT '资格判定原因编码',
    contact_name            VARCHAR(50) DEFAULT NULL COMMENT '联系人姓名',
    contact_mobile          VARCHAR(30) DEFAULT NULL COMMENT '联系人手机',
    contact_email           VARCHAR(100) DEFAULT NULL COMMENT '联系人邮箱',
    status                  VARCHAR(20) DEFAULT 'new' COMMENT '状态：new/pending_assign/following/converted/closed_invalid',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '负责人',
    owner_dept_code         VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    score                   INT DEFAULT NULL COMMENT '线索评分(0-100，可由规则或AI生成)',
    next_action             VARCHAR(500) DEFAULT NULL COMMENT '下一步动作',
    next_action_due_at      DATETIME DEFAULT NULL COMMENT '下一步动作截止时间',
    last_follow_up_at       DATETIME DEFAULT NULL COMMENT '最近跟进时间',
    invalid_reason_code     VARCHAR(50) DEFAULT NULL COMMENT '结构化无效原因编码',
    invalid_reason          VARCHAR(500) DEFAULT NULL COMMENT '无效原因',
    converted_customer_id   BIGINT DEFAULT NULL COMMENT '转化后客户ID',
    converted_opportunity_id BIGINT DEFAULT NULL COMMENT '转化后商机ID',
    converted_at            DATETIME DEFAULT NULL COMMENT '转化时间',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_status (status),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_source_type (source_type),
    INDEX idx_qualification_result (qualification_result),
    INDEX idx_expected_procurement_date (expected_procurement_date),
    INDEX idx_invalid_reason_code (invalid_reason_code),
    INDEX idx_last_follow_up_at (last_follow_up_at),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线索表';

-- ------------------------------------------------------------
-- 2.4 商机表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS opportunity;
CREATE TABLE opportunity (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                        VARCHAR(30) NOT NULL COMMENT '商机编号(OP-xxxxxx)',
    name                        VARCHAR(200) NOT NULL COMMENT '商机名称',
    customer_id                 BIGINT NOT NULL COMMENT '所属客户ID',
    lead_id                     BIGINT DEFAULT NULL COMMENT '来源线索ID',
    source_type                 VARCHAR(50) DEFAULT NULL COMMENT '商机来源：customer_visit/existing_customer_revisit/telemarketing/online_promotion/referral/other',
    source_detail               VARCHAR(500) DEFAULT NULL COMMENT '商机来源详细说明',
    stage_id                    BIGINT NOT NULL COMMENT '当前阶段ID',
    forecast_category           VARCHAR(20) DEFAULT 'pipeline' COMMENT '预测分类：pipeline/best_case/commit',
    status                      VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/won/lost/paused',
    amount_tax_inclusive        DECIMAL(18,2) DEFAULT NULL COMMENT '预计金额(含税)',
    amount_tax_exclusive        DECIMAL(18,2) DEFAULT NULL COMMENT '预计金额(不含税)',
    currency_code               VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    expected_sign_date          DATE DEFAULT NULL COMMENT '预计签约日期',
    expected_payment_date       DATE DEFAULT NULL COMMENT '预计回款日期',
    win_rate                    DECIMAL(5,2) DEFAULT NULL COMMENT '赢率(%)',
    owner_user_id               VARCHAR(50) NOT NULL COMMENT '商机负责人',
    owner_dept_code             VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    pre_sales_user_id           VARCHAR(50) DEFAULT NULL COMMENT '售前负责人',
    delivery_user_id            VARCHAR(50) DEFAULT NULL COMMENT '交付负责人',
    next_action                 VARCHAR(500) DEFAULT NULL COMMENT '下一步动作',
    next_action_due_at          DATETIME DEFAULT NULL COMMENT '下一步动作截止时间',
    last_follow_up_at           DATETIME DEFAULT NULL COMMENT '最近跟进时间',
    risk_level                  VARCHAR(20) DEFAULT NULL COMMENT '风险等级：high/medium/low',
    risk_reason                 VARCHAR(500) DEFAULT NULL COMMENT '风险原因',
    competitor_info             TEXT DEFAULT NULL COMMENT '竞品信息',
    key_contact_complete_rate   DECIMAL(5,2) DEFAULT NULL COMMENT '关键人完整度(%)',
    won_at                      DATETIME DEFAULT NULL COMMENT '赢单时间',
    won_reason_code             VARCHAR(50) DEFAULT NULL COMMENT '结构化赢单原因编码',
    won_reason                  VARCHAR(500) DEFAULT NULL COMMENT '赢单原因',
    lost_at                     DATETIME DEFAULT NULL COMMENT '输单时间',
    lost_reason_code            VARCHAR(50) DEFAULT NULL COMMENT '结构化输单原因编码',
    lost_reason                 VARCHAR(500) DEFAULT NULL COMMENT '输单原因',
    pause_reason_code           VARCHAR(50) DEFAULT NULL COMMENT '结构化暂停原因编码',
    pause_reason                VARCHAR(500) DEFAULT NULL COMMENT '暂停原因',
    remark                      VARCHAR(500) DEFAULT NULL COMMENT '备注',
    version_no                  INT DEFAULT 1 COMMENT '版本号',
    last_status_changed_at      DATETIME DEFAULT NULL COMMENT '最后状态变更时间',
    last_status_changed_by      VARCHAR(50) DEFAULT NULL COMMENT '最后状态变更人',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_opportunity_lead_id (lead_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_source_type (source_type),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_stage_id (stage_id),
    INDEX idx_forecast_category (forecast_category),
    INDEX idx_expected_sign_date (expected_sign_date),
    INDEX idx_status (status),
    INDEX idx_last_follow_up_at (last_follow_up_at),
    INDEX idx_won_reason_code (won_reason_code),
    INDEX idx_lost_reason_code (lost_reason_code),
    INDEX idx_pause_reason_code (pause_reason_code),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_opp_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_opp_stage FOREIGN KEY (stage_id) REFERENCES opportunity_stage(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商机表';

-- ------------------------------------------------------------
-- 2.4.1 线索转化记录表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS lead_conversion;
CREATE TABLE lead_conversion (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    lead_id                     BIGINT NOT NULL COMMENT '线索ID',
    customer_id                 BIGINT NOT NULL COMMENT '转化客户ID',
    contact_id                  BIGINT DEFAULT NULL COMMENT '转化联系人ID',
    opportunity_id              BIGINT NOT NULL COMMENT '转化商机ID',
    converted_by                VARCHAR(50) DEFAULT NULL COMMENT '转化人',
    converted_at                DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '转化时间',
    idempotency_key             VARCHAR(100) DEFAULT NULL COMMENT '幂等键',
    conversion_snapshot_json    JSON DEFAULT NULL COMMENT '转化请求与结果快照',

    UNIQUE KEY uk_lead_conversion_lead (lead_id),
    UNIQUE KEY uk_lead_conversion_idempotency (idempotency_key),
    INDEX idx_customer_id (customer_id),
    INDEX idx_contact_id (contact_id),
    INDEX idx_opportunity_id (opportunity_id),
    CONSTRAINT fk_lc_lead FOREIGN KEY (lead_id) REFERENCES `lead`(id),
    CONSTRAINT fk_lc_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_lc_contact FOREIGN KEY (contact_id) REFERENCES contact(id),
    CONSTRAINT fk_lc_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='线索转化记录表';

-- ------------------------------------------------------------
-- 2.4.2 商机联系人角色表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS opportunity_contact_role;
CREATE TABLE opportunity_contact_role (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    opportunity_id      BIGINT NOT NULL COMMENT '商机ID',
    contact_id          BIGINT NOT NULL COMMENT '联系人ID',
    role                VARCHAR(50) NOT NULL COMMENT '角色：decision_maker/economic_buyer/sponsor/procurement/technical_influencer/end_user/competitor_supporter',
    influence_level     VARCHAR(20) DEFAULT 'medium' COMMENT '影响力：high/medium/low',
    attitude            VARCHAR(20) DEFAULT 'neutral' COMMENT '态度：supportive/neutral/resistant/unknown',
    is_primary          TINYINT DEFAULT 0 COMMENT '是否主要联系人：1是 0否',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_opportunity_contact (opportunity_id, contact_id),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_contact_id (contact_id),
    INDEX idx_role (role),
    INDEX idx_is_primary (is_primary),
    CONSTRAINT fk_ocr_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id) ON DELETE CASCADE,
    CONSTRAINT fk_ocr_contact FOREIGN KEY (contact_id) REFERENCES contact(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商机联系人角色表';

-- ------------------------------------------------------------
-- 2.5 商机阶段流转日志表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS opportunity_stage_log;
CREATE TABLE opportunity_stage_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    opportunity_id  BIGINT NOT NULL COMMENT '商机ID',
    from_stage_id   BIGINT DEFAULT NULL COMMENT '原阶段ID',
    to_stage_id     BIGINT NOT NULL COMMENT '目标阶段ID',
    changed_by      VARCHAR(50) NOT NULL COMMENT '操作人',
    changed_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '变更时间',
    change_reason   VARCHAR(500) DEFAULT NULL COMMENT '变更原因',
    amount_snapshot DECIMAL(18,2) DEFAULT NULL COMMENT '变更后金额快照',
    forecast_category_snapshot VARCHAR(20) DEFAULT NULL COMMENT '变更后预测分类快照',
    expected_sign_date_snapshot DATE DEFAULT NULL COMMENT '变更后预计签约日期快照',
    win_rate_snapshot DECIMAL(5,2) DEFAULT NULL COMMENT '变更后赢率快照',
    version_no      INT DEFAULT NULL COMMENT '变更后商机版本号',

    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_changed_at (changed_at),
    CONSTRAINT fk_stage_log_opp FOREIGN KEY (opportunity_id) REFERENCES opportunity(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商机阶段流转日志表';

-- ------------------------------------------------------------
-- 2.6 销售活动表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS sales_activity;
CREATE TABLE sales_activity (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(30) NOT NULL COMMENT '活动编号',
    activity_type       VARCHAR(20) NOT NULL COMMENT '活动类型：visit/call/demo/meeting/tender/memo',
    subject             VARCHAR(200) NOT NULL COMMENT '活动主题',
    lead_id             BIGINT DEFAULT NULL COMMENT '关联线索ID',
    customer_id         BIGINT DEFAULT NULL COMMENT '关联客户ID',
    contact_id          BIGINT DEFAULT NULL COMMENT '关联联系人ID',
    opportunity_id      BIGINT DEFAULT NULL COMMENT '关联商机ID',
    activity_at         DATETIME NOT NULL COMMENT '活动时间',
    participants_json   JSON DEFAULT NULL COMMENT '参与人JSON',
    content             TEXT DEFAULT NULL COMMENT '活动内容/纪要',
    result_summary      VARCHAR(500) DEFAULT NULL COMMENT '结果摘要',
    next_action         VARCHAR(500) DEFAULT NULL COMMENT '下一步动作',
    next_action_due_at  DATETIME DEFAULT NULL COMMENT '下一步截止时间',
    owner_user_id       VARCHAR(50) NOT NULL COMMENT '记录人',
    status              VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/canceled',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_lead_id (lead_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_activity_at (activity_at),
    CONSTRAINT fk_activity_lead FOREIGN KEY (lead_id) REFERENCES `lead`(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售活动表';

-- ------------------------------------------------------------
-- 2.7 销售任务表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS sales_task;
CREATE TABLE sales_task (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(30) NOT NULL COMMENT '任务编号',
    name                VARCHAR(200) NOT NULL COMMENT '任务名称',
    related_type        VARCHAR(30) DEFAULT NULL COMMENT '关联对象类型：customer/opportunity/lead/contract/quotation',
    related_id          BIGINT DEFAULT NULL COMMENT '关联对象ID',
    assignee_user_id    VARCHAR(50) NOT NULL COMMENT '责任人',
    due_at              DATETIME DEFAULT NULL COMMENT '截止时间',
    status              VARCHAR(20) DEFAULT 'todo' COMMENT '状态：todo/doing/done/canceled/overdue',
    priority            VARCHAR(10) DEFAULT 'medium' COMMENT '优先级：high/medium/low',
    content             TEXT DEFAULT NULL COMMENT '任务描述',
    completed_at        DATETIME DEFAULT NULL COMMENT '完成时间',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_assignee_user_id (assignee_user_id),
    INDEX idx_status (status),
    INDEX idx_due_at (due_at),
    INDEX idx_related (related_type, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售任务表';

-- ------------------------------------------------------------
-- 2.8 产品/服务目录表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS product;
CREATE TABLE product (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(50) NOT NULL COMMENT '产品编码',
    name            VARCHAR(200) NOT NULL COMMENT '产品名称',
    product_type    VARCHAR(30) DEFAULT NULL COMMENT '产品类型：software/service/implementation/maintenance/hardware',
    parent_product_id BIGINT DEFAULT NULL COMMENT '上级产品ID',
    specification   VARCHAR(500) DEFAULT NULL COMMENT '规格说明',
    unit            VARCHAR(20) DEFAULT NULL COMMENT '单位：套/个/人天/月/年',
    standard_price  DECIMAL(18,2) DEFAULT NULL COMMENT '标准售价',
    cost_price      DECIMAL(18,2) DEFAULT NULL COMMENT '成本价',
    tax_rate        DECIMAL(5,2) DEFAULT 6.00 COMMENT '税率(%)',
    status          VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    started_at      DATE DEFAULT NULL COMMENT '源系统启动日期',
    completeness    INT DEFAULT NULL COMMENT '源系统完成度',
    legacy_source   VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id       BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    legacy_refs_json JSON DEFAULT NULL COMMENT '源系统归口部门/产品经理/解决方案等引用',
    remark          VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by      VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by      VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at      DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_product_legacy (legacy_source, legacy_id),
    INDEX idx_parent_product_id (parent_product_id),
    INDEX idx_product_type (product_type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品/服务目录表';

-- ------------------------------------------------------------
-- 2.9 报价单表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS quotation;
CREATE TABLE quotation (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '报价编号(QU-xxxxxx)',
    quotation_no            VARCHAR(50) DEFAULT NULL COMMENT '报价单号(业务流水号)',
    customer_id             BIGINT NOT NULL COMMENT '所属客户ID',
    opportunity_id          BIGINT DEFAULT NULL COMMENT '所属商机ID',
    version_no              INT DEFAULT 1 COMMENT '版本号',
    status                  VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/sent/accepted/expired/voided',
    valid_until             DATE DEFAULT NULL COMMENT '有效期截止日',
    discount_rate           DECIMAL(5,2) DEFAULT NULL COMMENT '整单折扣率(%)',
    gross_margin_rate       DECIMAL(5,2) DEFAULT NULL COMMENT '整单毛利率(%)',
    amount_tax_inclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '报价金额(含税)',
    amount_tax_exclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '报价金额(不含税)',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    tax_rate                DECIMAL(5,2) DEFAULT 6.00 COMMENT '税率(%)',
    approved_at             DATETIME DEFAULT NULL COMMENT '审批通过时间',
    approved_by             VARCHAR(50) DEFAULT NULL COMMENT '审批人',
    rejected_at             DATETIME DEFAULT NULL COMMENT '审批拒绝时间',
    rejected_by             VARCHAR(50) DEFAULT NULL COMMENT '拒绝人',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    sent_at                 DATETIME DEFAULT NULL COMMENT '发送客户时间',
    accepted_at             DATETIME DEFAULT NULL COMMENT '客户接受时间',
    expired_at              DATETIME DEFAULT NULL COMMENT '失效时间',
    owner_user_id           VARCHAR(50) NOT NULL COMMENT '负责人',
    owner_dept_code         VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    last_status_changed_at  DATETIME DEFAULT NULL COMMENT '最后状态变更时间',
    last_status_changed_by  VARCHAR(50) DEFAULT NULL COMMENT '最后状态变更人',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_customer_id (customer_id),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_status (status),
    INDEX idx_valid_until (valid_until),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_quot_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_quot_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报价单表';

-- ------------------------------------------------------------
-- 2.10 报价明细表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS quotation_item;
CREATE TABLE quotation_item (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    quotation_id            BIGINT NOT NULL COMMENT '报价单ID',
    product_id              BIGINT DEFAULT NULL COMMENT '产品ID',
    item_name               VARCHAR(200) NOT NULL COMMENT '项目名称',
    specification           VARCHAR(500) DEFAULT NULL COMMENT '规格说明',
    unit                    VARCHAR(20) DEFAULT NULL COMMENT '单位',
    quantity                DECIMAL(12,2) DEFAULT 1.00 COMMENT '数量',
    unit_price              DECIMAL(18,2) DEFAULT NULL COMMENT '单价',
    discount_rate           DECIMAL(5,2) DEFAULT NULL COMMENT '行折扣率(%)',
    cost_price              DECIMAL(18,2) DEFAULT NULL COMMENT '成本价',
    tax_rate                DECIMAL(5,2) DEFAULT 6.00 COMMENT '税率(%)',
    amount_tax_inclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '含税小计',
    amount_tax_exclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '不含税小计',
    sort_no                 INT DEFAULT 0 COMMENT '排序号',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_quotation_id (quotation_id),
    CONSTRAINT fk_qi_quotation FOREIGN KEY (quotation_id) REFERENCES quotation(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报价明细表';

-- ------------------------------------------------------------
-- 2.11 报价版本快照表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS quotation_version;
CREATE TABLE quotation_version (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    quotation_id    BIGINT NOT NULL COMMENT '报价单ID',
    version_no      INT NOT NULL COMMENT '版本号',
    snapshot_json   JSON NOT NULL COMMENT '版本快照JSON',
    created_by      VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_quotation_id (quotation_id),
    CONSTRAINT fk_qv_quotation FOREIGN KEY (quotation_id) REFERENCES quotation(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='报价版本快照表';

-- ------------------------------------------------------------
-- 2.12 合同表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract;
CREATE TABLE contract (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '合同编号(CT-xxxxxx)',
    contract_no             VARCHAR(50) DEFAULT NULL COMMENT '合同号(业务流水号)',
    name                    VARCHAR(200) NOT NULL COMMENT '合同名称',
    customer_id             BIGINT NOT NULL COMMENT '所属客户ID',
    contact_id              BIGINT DEFAULT NULL COMMENT '客户联系人ID',
    parent_contract_id      BIGINT DEFAULT NULL COMMENT '父合同ID',
    is_master_contract      TINYINT NOT NULL DEFAULT 0 COMMENT '是否可作为主合同：1是 0否',
    opportunity_id          BIGINT DEFAULT NULL COMMENT '关联商机ID',
    quotation_id            BIGINT DEFAULT NULL COMMENT '关联报价单ID',
    status                  VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/pending_approval/approved/rejected/effective/completed/terminated/invalid',
    legal_status            VARCHAR(30) NOT NULL DEFAULT 'draft' COMMENT '法律生命周期状态',
    fulfillment_status      VARCHAR(30) NOT NULL DEFAULT 'not_started' COMMENT '履约状态',
    financial_status        VARCHAR(30) NOT NULL DEFAULT 'unplanned' COMMENT '财务状态，由应收/应付/Finance事件维护',
    activation_status       VARCHAR(30) NOT NULL DEFAULT 'not_planned' COMMENT '履约启动状态',
    direction               VARCHAR(20) NOT NULL DEFAULT 'sales' COMMENT '合同方向：sales/purchase',
    primary_type            VARCHAR(50) DEFAULT 'legacy_contract' COMMENT '合同主类型',
    agreement_form          VARCHAR(50) DEFAULT 'standard_contract' COMMENT '协议形式',
    template_code           VARCHAR(64) DEFAULT NULL COMMENT '创建时使用的业务模板',
    source_type             VARCHAR(50) DEFAULT NULL COMMENT '来源类型：quotation/opportunity/manual',
    source_code             VARCHAR(100) DEFAULT NULL COMMENT '来源业务编号',
    sign_date               DATE DEFAULT NULL COMMENT '签约日期',
    effective_date          DATE DEFAULT NULL COMMENT '生效日期',
    end_date                DATE DEFAULT NULL COMMENT '结束日期',
    amount_tax_inclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '合同金额(含税)',
    amount_tax_exclusive    DECIMAL(18,2) DEFAULT NULL COMMENT '合同金额(不含税)',
    prime_amount            DECIMAL(18,2) DEFAULT NULL COMMENT '源系统有效金额',
    invoiced_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '源系统已开票金额',
    executed_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '源系统已执行/已回款金额',
    gross_margin_rate       DECIMAL(5,2) DEFAULT NULL COMMENT '毛利率(%)',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    tax_rate                DECIMAL(5,2) DEFAULT 6.00 COMMENT '税率(%)',
    payment_term_summary    VARCHAR(500) DEFAULT NULL COMMENT '付款条款摘要',
    retention_rate          DECIMAL(5,2) DEFAULT NULL COMMENT '质保金比例(%)',
    source_contract_type    VARCHAR(20) DEFAULT NULL COMMENT '源系统合同类型编码',
    is_third_party          TINYINT DEFAULT 0 COMMENT '是否三方合同：1是 0否',
    third_party_customer_id BIGINT DEFAULT NULL COMMENT '第三方客户ID',
    service_period_months   INT DEFAULT NULL COMMENT '服务周期(月)',
    contract_period_months  INT DEFAULT NULL COMMENT '合同周期(月)',
    content_summary         VARCHAR(1000) DEFAULT NULL COMMENT '源系统主要内容',
    service_terms           VARCHAR(1000) DEFAULT NULL COMMENT '源系统服务条款',
    owner_user_id           VARCHAR(50) NOT NULL COMMENT '负责人',
    owner_dept_code         VARCHAR(50) DEFAULT NULL COMMENT '归属部门编码',
    approved_at             DATETIME DEFAULT NULL COMMENT '审批通过时间',
    approved_by             VARCHAR(50) DEFAULT NULL COMMENT '审批人',
    rejected_at             DATETIME DEFAULT NULL COMMENT '拒绝时间',
    rejected_by             VARCHAR(50) DEFAULT NULL COMMENT '拒绝人',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '拒绝原因',
    terminated_at           DATETIME DEFAULT NULL COMMENT '终止时间',
    completed_at            DATETIME DEFAULT NULL COMMENT '完成时间',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    version_no              INT DEFAULT 1 COMMENT '版本号',
    lock_version            INT NOT NULL DEFAULT 0 COMMENT '乐观锁版本',
    legacy_source           VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id               BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    legacy_refs_json        JSON DEFAULT NULL COMMENT '源系统项目/公司/银行账户/系统等引用',
    last_status_changed_at  DATETIME DEFAULT NULL COMMENT '最后状态变更时间',
    last_status_changed_by  VARCHAR(50) DEFAULT NULL COMMENT '最后状态变更人',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_contract_legacy (legacy_source, legacy_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_contact_id (contact_id),
    INDEX idx_parent_contract_id (parent_contract_id),
    INDEX idx_contract_master_candidate (is_master_contract, customer_id, direction),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_status (status),
    INDEX idx_contract_legal_status (legal_status),
    INDEX idx_contract_fulfillment_status (fulfillment_status),
    INDEX idx_contract_financial_status (financial_status),
    INDEX idx_contract_activation_status (activation_status),
    INDEX idx_contract_direction (direction),
    INDEX idx_contract_primary_type (primary_type),
    INDEX idx_contract_template_code (template_code),
    INDEX idx_contract_source (source_type, source_code),
    INDEX idx_effective_date (effective_date),
    INDEX idx_end_date (end_date),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_ct_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_ct_contact FOREIGN KEY (contact_id) REFERENCES contact(id),
    CONSTRAINT fk_ct_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同表';

-- ------------------------------------------------------------
-- 2.12.1 合同业务模板表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_business_template;
CREATE TABLE contract_business_template (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(64) NOT NULL COMMENT '业务模板编码',
    name            VARCHAR(120) NOT NULL COMMENT '业务模板名称',
    direction       VARCHAR(20) NOT NULL DEFAULT 'sales' COMMENT '合同方向：sales/purchase',
    primary_type    VARCHAR(50) NOT NULL COMMENT '合同主类型',
    is_system       TINYINT NOT NULL DEFAULT 1 COMMENT '是否系统预置',
    status          VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive',
    version_no      INT NOT NULL DEFAULT 1 COMMENT '模板版本',
    template_json   JSON NOT NULL COMMENT '模板快照JSON',
    created_by      VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by      VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at      DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_business_template_code (code),
    INDEX idx_contract_template_direction (direction, primary_type),
    INDEX idx_contract_template_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同业务模板表';

-- ------------------------------------------------------------
-- 2.12.2 合同参与方表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_party;
CREATE TABLE contract_party (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_id         BIGINT NOT NULL COMMENT '合同ID',
    party_type          VARCHAR(30) NOT NULL COMMENT '参与方类型：customer/supplier/organization/person',
    party_ref_code      VARCHAR(100) DEFAULT NULL COMMENT '参与方稳定编码',
    party_name_snapshot VARCHAR(200) NOT NULL COMMENT '参与方名称快照',
    role_code           VARCHAR(50) NOT NULL COMMENT '角色：buyer/seller/payer/end_customer/vendor/agent/guarantor',
    is_primary          TINYINT NOT NULL DEFAULT 0 COMMENT '是否主要参与方',
    contact_name        VARCHAR(100) DEFAULT NULL COMMENT '联系人',
    contact_mobile      VARCHAR(50) DEFAULT NULL COMMENT '联系电话',
    contact_email       VARCHAR(100) DEFAULT NULL COMMENT '联系邮箱',
    sort_no             INT NOT NULL DEFAULT 0 COMMENT '排序',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_party_role_ref (contract_id, role_code, party_ref_code),
    INDEX idx_contract_party_contract (contract_id),
    INDEX idx_contract_party_role (role_code, is_primary),
    CONSTRAINT fk_contract_party_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同参与方表';

-- ------------------------------------------------------------
-- 2.12.3 合同行表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_line;
CREATE TABLE contract_line (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                        VARCHAR(64) NOT NULL COMMENT '合同行编号',
    contract_id                 BIGINT NOT NULL COMMENT '合同ID',
    line_no                     INT NOT NULL COMMENT '合同行号',
    line_type                   VARCHAR(50) NOT NULL COMMENT '合同行类型',
    name                        VARCHAR(200) NOT NULL COMMENT '行名称',
    description                 TEXT DEFAULT NULL COMMENT '行说明',
    catalog_item_id             BIGINT DEFAULT NULL COMMENT '商业目录项ID',
    catalog_item_code           VARCHAR(100) DEFAULT NULL COMMENT '商业目录项编码',
    product_code                VARCHAR(100) DEFAULT NULL COMMENT '产品编码',
    product_version             VARCHAR(100) DEFAULT NULL COMMENT '产品版本',
    product_origin              VARCHAR(30) DEFAULT 'own' COMMENT '产品来源：own/third_party',
    supplier_code               VARCHAR(100) DEFAULT NULL COMMENT '供应商编码',
    source_quotation_item_id    BIGINT DEFAULT NULL COMMENT '来源报价明细ID',
    quantity                    DECIMAL(18,4) DEFAULT 1.0000 COMMENT '数量',
    unit                        VARCHAR(30) DEFAULT NULL COMMENT '单位',
    quantity_factors_json       JSON DEFAULT NULL COMMENT '数量因子快照',
    unit_price                  DECIMAL(18,2) DEFAULT NULL COMMENT '单价',
    amount_tax_exclusive        DECIMAL(18,2) DEFAULT NULL COMMENT '不含税金额',
    amount_tax_inclusive        DECIMAL(18,2) DEFAULT NULL COMMENT '含税金额',
    tax_rate                    DECIMAL(5,2) DEFAULT 6.00 COMMENT '税率(%)',
    planned_cost                DECIMAL(18,2) DEFAULT NULL COMMENT '计划成本',
    planned_margin              DECIMAL(18,2) DEFAULT NULL COMMENT '计划毛利',
    currency_code               VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    billing_method              VARCHAR(30) DEFAULT 'fixed_price' COMMENT '计费方式',
    fulfillment_method          VARCHAR(30) DEFAULT 'point_in_time' COMMENT '履约方式',
    service_start_date          DATE DEFAULT NULL COMMENT '服务开始日期',
    service_end_date            DATE DEFAULT NULL COMMENT '服务结束日期',
    project_policy              VARCHAR(30) DEFAULT 'none' COMMENT '项目策略：none/optional/required',
    project_template_code       VARCHAR(100) DEFAULT NULL COMMENT '项目模板编码',
    asset_policy                VARCHAR(50) DEFAULT 'none' COMMENT '资产策略',
    service_policy              VARCHAR(50) DEFAULT 'none' COMMENT '服务策略',
    procurement_policy          VARCHAR(30) DEFAULT 'none' COMMENT '采购策略',
    acceptance_required         TINYINT NOT NULL DEFAULT 0 COMMENT '是否需要验收',
    acceptance_criteria         VARCHAR(1000) DEFAULT NULL COMMENT '验收标准',
    status                      VARCHAR(20) NOT NULL DEFAULT 'active' COMMENT '状态：active/inactive/cancelled',
    sort_no                     INT NOT NULL DEFAULT 0 COMMENT '排序',
    snapshot_json               JSON DEFAULT NULL COMMENT '创建快照',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_line_code (code),
    UNIQUE KEY uk_contract_line_no (contract_id, line_no),
    INDEX idx_contract_line_contract (contract_id, sort_no, id),
    INDEX idx_contract_line_type (line_type),
    INDEX idx_contract_line_source_quote_item (source_quotation_item_id),
    CONSTRAINT fk_contract_line_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_line_quote_item FOREIGN KEY (source_quotation_item_id) REFERENCES quotation_item(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同行表';

-- ------------------------------------------------------------
-- 2.12.4 合同履约义务表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_obligation;
CREATE TABLE contract_obligation (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(64) NOT NULL COMMENT '履约义务编号',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    contract_line_id        BIGINT DEFAULT NULL COMMENT '合同行ID',
    obligation_type         VARCHAR(50) NOT NULL COMMENT '义务类型',
    name                    VARCHAR(200) NOT NULL COMMENT '义务名称',
    description             TEXT DEFAULT NULL COMMENT '义务说明',
    fulfillment_method      VARCHAR(30) DEFAULT NULL COMMENT '履约方式',
    planned_start_at        DATETIME DEFAULT NULL COMMENT '计划开始时间',
    planned_due_at          DATETIME DEFAULT NULL COMMENT '计划完成时间',
    actual_completed_at     DATETIME DEFAULT NULL COMMENT '实际完成时间',
    submitted_at            DATETIME DEFAULT NULL COMMENT '提交时间',
    accepted_at             DATETIME DEFAULT NULL COMMENT '验收通过时间',
    rejected_at             DATETIME DEFAULT NULL COMMENT '驳回时间',
    acceptance_required     TINYINT NOT NULL DEFAULT 0 COMMENT '是否需要验收',
    acceptance_criteria     VARCHAR(1000) DEFAULT NULL COMMENT '验收标准',
    status                  VARCHAR(30) NOT NULL DEFAULT 'not_started' COMMENT '状态：not_started/in_progress/submitted/accepted/rejected/completed/waived/blocked/cancelled',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '负责人',
    evidence_document_uuid  VARCHAR(100) DEFAULT NULL COMMENT '证据文档UUID',
    evidence_note           VARCHAR(1000) DEFAULT NULL COMMENT '证据说明',
    waiver_reason           VARCHAR(500) DEFAULT NULL COMMENT '豁免原因',
    reject_reason           VARCHAR(500) DEFAULT NULL COMMENT '驳回原因',
    source_type             VARCHAR(50) DEFAULT NULL COMMENT '来源类型：contract_line/legacy_contract_stage/manual',
    source_ref_id           BIGINT DEFAULT NULL COMMENT '来源ID',
    source_ref_code         VARCHAR(100) DEFAULT NULL COMMENT '来源编码',
    sort_no                 INT NOT NULL DEFAULT 0 COMMENT '排序',
    version_no              INT NOT NULL DEFAULT 1 COMMENT '版本号',
    snapshot_json           JSON DEFAULT NULL COMMENT '来源快照',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_obligation_code (code),
    INDEX idx_contract_obligation_contract (contract_id, sort_no, id),
    INDEX idx_contract_obligation_line (contract_line_id),
    INDEX idx_contract_obligation_status (status),
    INDEX idx_contract_obligation_source (source_type, source_ref_id),
    CONSTRAINT fk_contract_obligation_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_obligation_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同履约义务表';

-- ------------------------------------------------------------
-- 2.12.5 合同结算计划表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_billing_schedule;
CREATE TABLE contract_billing_schedule (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(64) NOT NULL COMMENT '结算计划编号',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    contract_line_id        BIGINT DEFAULT NULL COMMENT '合同行ID',
    obligation_id           BIGINT DEFAULT NULL COMMENT '履约义务ID',
    direction               VARCHAR(20) NOT NULL DEFAULT 'receivable' COMMENT '方向：receivable/payable',
    name                    VARCHAR(200) NOT NULL COMMENT '结算节点名称',
    trigger_type            VARCHAR(50) NOT NULL COMMENT '触发类型',
    trigger_ref_code        VARCHAR(100) DEFAULT NULL COMMENT '触发引用编码',
    milestone_type          VARCHAR(40) DEFAULT NULL COMMENT '收入节点类型：sign/delivery/milestone/recurring',
    amount                  DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '结算金额',
    paid_amount             DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '已支付/已回款金额',
    ratio                   DECIMAL(8,4) DEFAULT NULL COMMENT '合同金额比例(%)',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    expected_date           DATE DEFAULT NULL COMMENT '预计日期',
    due_date                DATE DEFAULT NULL COMMENT '收入到期日期',
    recurrence_rule_json    JSON DEFAULT NULL COMMENT '周期规则',
    invoice_required        TINYINT NOT NULL DEFAULT 1 COMMENT '是否需要开票',
    status                  VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '状态：planned/billable/invoicing/invoiced/received/paid/cancelled',
    finance_plan_code       VARCHAR(100) DEFAULT NULL COMMENT '财务计划或回款计划编码',
    source_type             VARCHAR(50) DEFAULT NULL COMMENT '来源类型：contract_line/legacy_payment_term/manual',
    source_ref_id           BIGINT DEFAULT NULL COMMENT '来源ID',
    source_ref_code         VARCHAR(100) DEFAULT NULL COMMENT '来源编码',
    snapshot_json           JSON DEFAULT NULL COMMENT '来源快照',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_billing_schedule_code (code),
    INDEX idx_contract_billing_contract (contract_id, expected_date, id),
    INDEX idx_contract_billing_line (contract_line_id),
    INDEX idx_contract_billing_obligation (obligation_id),
    INDEX idx_contract_billing_status (status),
    INDEX idx_contract_billing_source (source_type, source_ref_id),
    CONSTRAINT fk_contract_billing_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_billing_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_billing_obligation FOREIGN KEY (obligation_id) REFERENCES contract_obligation(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同结算计划表';

-- ------------------------------------------------------------
-- 2.12.6 合同项目关联表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_orchestration_step;
DROP TABLE IF EXISTS contract_orchestration_job;
DROP TABLE IF EXISTS service_cost_summary;
DROP TABLE IF EXISTS contract_line_profit_summary;
DROP TABLE IF EXISTS contract_line_cost_allocation;
DROP TABLE IF EXISTS contract_project_obligation_rel;
DROP TABLE IF EXISTS contract_project_line_rel;
DROP TABLE IF EXISTS contract_project_link;
CREATE TABLE contract_project_link (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    contract_line_id        BIGINT DEFAULT NULL COMMENT '合同行ID',
    obligation_id           BIGINT DEFAULT NULL COMMENT '履约义务ID',
    project_code            VARCHAR(64) NOT NULL COMMENT 'Aims项目编号',
    project_name_snapshot   VARCHAR(200) DEFAULT NULL COMMENT '项目名称快照',
    project_role            VARCHAR(30) NOT NULL DEFAULT 'delivery' COMMENT '项目角色',
    plan_key                VARCHAR(100) DEFAULT NULL COMMENT '履约启动项目计划键',
    line_codes_json         JSON DEFAULT NULL COMMENT '覆盖合同行编码JSON',
    obligation_codes_json   JSON DEFAULT NULL COMMENT '覆盖履约义务编码JSON',
    link_mode               VARCHAR(30) NOT NULL DEFAULT 'created_from_contract' COMMENT '关联方式',
    status                  VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：planned/active/closed/cancelled',
    source_job_id           BIGINT DEFAULT NULL COMMENT '来源编排作业ID',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_project_link (contract_id, project_code, project_role),
    INDEX idx_contract_project_contract (contract_id, status),
    INDEX idx_contract_project_plan (contract_id, plan_key),
    INDEX idx_contract_project_line (contract_line_id),
    INDEX idx_contract_project_obligation (obligation_id),
    INDEX idx_contract_project_code (project_code),
    INDEX idx_contract_project_source_job (source_job_id),
    CONSTRAINT fk_contract_project_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_project_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_project_obligation FOREIGN KEY (obligation_id) REFERENCES contract_obligation(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同项目关联表';

CREATE TABLE contract_project_line_rel (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_project_link_id    BIGINT NOT NULL COMMENT '合同项目关联ID',
    contract_line_id            BIGINT NOT NULL COMMENT '合同行ID',
    relation_type               VARCHAR(30) NOT NULL DEFAULT 'delivery' COMMENT '关系类型：delivery/customization/training/warranty/maintenance/change/other',
    allocation_method           VARCHAR(30) NOT NULL DEFAULT 'unallocated' COMMENT '分摊方法：unallocated/direct/ratio/amount/workdays',
    allocation_ratio            DECIMAL(8,4) DEFAULT NULL COMMENT '分摊比例(%)',
    allocated_amount            DECIMAL(18,2) DEFAULT NULL COMMENT '分摊金额',
    planned_workdays            DECIMAL(10,2) DEFAULT NULL COMMENT '计划人天',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_project_line_rel (contract_project_link_id, contract_line_id, relation_type),
    INDEX idx_cplr_line (contract_line_id),
    INDEX idx_cplr_link (contract_project_link_id),
    INDEX idx_cplr_method (allocation_method),
    CONSTRAINT fk_cplr_link FOREIGN KEY (contract_project_link_id) REFERENCES contract_project_link(id) ON DELETE RESTRICT,
    CONSTRAINT fk_cplr_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE RESTRICT,
    CHECK (allocation_ratio IS NULL OR allocation_ratio >= 0),
    CHECK (allocated_amount IS NULL OR allocated_amount >= 0),
    CHECK (planned_workdays IS NULL OR planned_workdays >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同项目-合同行结构化关系表';

CREATE TABLE contract_project_obligation_rel (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_project_link_id    BIGINT NOT NULL COMMENT '合同项目关联ID',
    obligation_id               BIGINT NOT NULL COMMENT '履约义务ID',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_project_obligation_rel (contract_project_link_id, obligation_id),
    INDEX idx_cpor_obligation (obligation_id),
    INDEX idx_cpor_link (contract_project_link_id),
    CONSTRAINT fk_cpor_link FOREIGN KEY (contract_project_link_id) REFERENCES contract_project_link(id) ON DELETE RESTRICT,
    CONSTRAINT fk_cpor_obligation FOREIGN KEY (obligation_id) REFERENCES contract_obligation(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同项目-履约义务结构化关系表';

CREATE TABLE contract_line_cost_allocation (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    tenant_id                   VARCHAR(64) DEFAULT NULL COMMENT '租户快照；单租户库可为空',
    contract_line_id            BIGINT DEFAULT NULL COMMENT '合同行本地ID快照',
    contract_line_code          VARCHAR(64) NOT NULL COMMENT '合同行编号',
    contract_code               VARCHAR(64) DEFAULT NULL COMMENT '合同编号快照',
    project_code                VARCHAR(64) NOT NULL COMMENT 'Aims项目编号',
    allocation_type             VARCHAR(30) NOT NULL DEFAULT 'direct' COMMENT '分摊方式：direct/ratio/amount/workdays',
    allocation_ratio            DECIMAL(8,4) DEFAULT NULL COMMENT '分摊比例(%)',
    allocated_amount            DECIMAL(18,2) DEFAULT NULL COMMENT '固定分摊金额',
    allocated_workdays          DECIMAL(10,2) DEFAULT NULL COMMENT '分摊人天',
    effective_from              DATE DEFAULT NULL COMMENT '生效开始日期',
    effective_to                DATE DEFAULT NULL COMMENT '生效结束日期',
    status                      VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：active/closed',
    source_type                 VARCHAR(40) NOT NULL DEFAULT 'manual' COMMENT '来源：manual/contract_project_line_rel/recalculation',
    source_ref_code             VARCHAR(120) DEFAULT NULL COMMENT '来源引用编码',
    snapshot_json               JSON DEFAULT NULL COMMENT '创建时规则快照',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_clca_line_project_type_period (contract_line_code, project_code, allocation_type, effective_from, effective_to),
    INDEX idx_clca_line_code (contract_line_code, status),
    INDEX idx_clca_project (project_code, status),
    INDEX idx_clca_contract (contract_code),
    INDEX idx_clca_line_id (contract_line_id),
    INDEX idx_clca_source (source_type, source_ref_code, status),
    CONSTRAINT fk_clca_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL,
    CHECK (allocation_ratio IS NULL OR allocation_ratio >= 0),
    CHECK (allocated_amount IS NULL OR allocated_amount >= 0),
    CHECK (allocated_workdays IS NULL OR allocated_workdays > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同行成本归集分摊规则';

CREATE TABLE contract_line_profit_summary (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_line_code          VARCHAR(64) NOT NULL COMMENT '合同行编号',
    contract_code               VARCHAR(64) DEFAULT NULL COMMENT '合同编号快照',
    customer_code               VARCHAR(64) DEFAULT NULL COMMENT '客户编号快照',
    period_start                DATE NOT NULL COMMENT '核算期间开始',
    period_end                  DATE NOT NULL COMMENT '核算期间结束',
    total_revenue               DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '收入金额',
    total_cost                  DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '成本金额',
    gross_profit                DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '毛利金额',
    gross_margin                DECIMAL(12,6) DEFAULT NULL COMMENT '毛利率',
    project_count               INT NOT NULL DEFAULT 0 COMMENT '参与项目数',
    calculation_key             VARCHAR(160) NOT NULL COMMENT '幂等计算键',
    source_version              VARCHAR(80) DEFAULT NULL COMMENT '来源版本或批次',
    calculated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
    version                     INT NOT NULL DEFAULT 1 COMMENT '版本号',
    is_current                  TINYINT NOT NULL DEFAULT 1 COMMENT '是否当前版本',
    detail_json                 JSON DEFAULT NULL COMMENT '可重建明细快照',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_clps_line_period_key (contract_line_code, period_start, period_end, calculation_key),
    INDEX idx_clps_contract (contract_code, period_start, period_end, is_current),
    INDEX idx_clps_customer (customer_code, period_start, period_end, is_current),
    INDEX idx_clps_line_current (contract_line_code, period_start, period_end, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同行毛利汇总，可重建派生数据';

CREATE TABLE service_cost_summary (
    id                          BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    service_agreement_code      VARCHAR(64) NOT NULL COMMENT '服务协议编号',
    project_code                VARCHAR(64) NOT NULL COMMENT 'Aims服务项目编号',
    environment_code            VARCHAR(64) DEFAULT NULL COMMENT '正式环境编号过滤快照',
    period_start                DATE NOT NULL COMMENT '核算期间开始',
    period_end                  DATE NOT NULL COMMENT '核算期间结束',
    ticket_count                INT NOT NULL DEFAULT 0 COMMENT '工单数',
    sla_ticket_count            INT NOT NULL DEFAULT 0 COMMENT 'SLA工单数',
    total_hours                 DECIMAL(12,2) NOT NULL DEFAULT 0.00 COMMENT '服务工时',
    total_cost                  DECIMAL(18,2) NOT NULL DEFAULT 0.00 COMMENT '服务成本',
    calculation_key             VARCHAR(160) NOT NULL COMMENT '幂等计算键',
    calculated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '计算时间',
    version                     INT NOT NULL DEFAULT 1 COMMENT '版本号',
    is_current                  TINYINT NOT NULL DEFAULT 1 COMMENT '是否当前版本',
    detail_json                 JSON DEFAULT NULL COMMENT '可重建明细快照',
    created_by                  VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by                  VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at                  DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at                  DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at                  DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_scs_agreement_project_period_key (service_agreement_code, project_code, period_start, period_end, calculation_key),
    INDEX idx_scs_agreement (service_agreement_code, period_start, period_end, is_current),
    INDEX idx_scs_project (project_code, period_start, period_end, is_current),
    INDEX idx_scs_environment (environment_code, period_start, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议成本汇总，可重建派生数据';

-- ------------------------------------------------------------
-- 2.12.7 合同编排作业表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_orchestration_job;
CREATE TABLE contract_orchestration_job (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(64) NOT NULL COMMENT '编排作业编号',
    job_type                VARCHAR(50) NOT NULL DEFAULT 'activation' COMMENT '作业类型',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    source_contract_code    VARCHAR(64) NOT NULL COMMENT '来源合同编号快照',
    idempotency_key         VARCHAR(200) NOT NULL COMMENT '幂等键',
    requested_by            VARCHAR(50) DEFAULT NULL COMMENT '请求人',
    status                  VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '状态：planned/running/partially_failed/completed/cancelled',
    tenant_code             VARCHAR(100) DEFAULT NULL COMMENT '租户编码快照',
    deployment_code         VARCHAR(100) DEFAULT NULL COMMENT '部署编码快照',
    feature_flag_snapshot   JSON DEFAULT NULL COMMENT '特性开关快照',
    plan_snapshot_json      JSON NOT NULL COMMENT '启动计划快照',
    started_at              DATETIME DEFAULT NULL COMMENT '开始时间',
    finished_at             DATETIME DEFAULT NULL COMMENT '结束时间',
    cancel_reason           VARCHAR(500) DEFAULT NULL COMMENT '取消原因',
    last_error              TEXT DEFAULT NULL COMMENT '最后错误',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_orchestration_job_code (code),
    UNIQUE KEY uk_contract_orchestration_idempotency (idempotency_key),
    INDEX idx_contract_orchestration_contract (contract_id, created_at),
    INDEX idx_contract_orchestration_status (status, updated_at),
    INDEX idx_contract_orchestration_type (job_type),
    CONSTRAINT fk_contract_orchestration_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同编排作业表';

-- ------------------------------------------------------------
-- 2.12.8 合同编排步骤表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_orchestration_step;
CREATE TABLE contract_orchestration_step (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    job_id                  BIGINT NOT NULL COMMENT '编排作业ID',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    step_key                VARCHAR(100) NOT NULL COMMENT '步骤稳定键',
    step_name               VARCHAR(100) NOT NULL COMMENT '步骤名称',
    sort_no                 INT NOT NULL DEFAULT 0 COMMENT '排序',
    depends_on_step_keys    JSON DEFAULT NULL COMMENT '前置步骤键',
    idempotency_key         VARCHAR(240) NOT NULL COMMENT '步骤幂等键',
    target_app              VARCHAR(50) NOT NULL COMMENT '目标应用',
    target_action           VARCHAR(100) NOT NULL COMMENT '目标动作',
    request_snapshot        JSON NOT NULL COMMENT '请求快照',
    result_snapshot         JSON DEFAULT NULL COMMENT '结果快照',
    status                  VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '状态：planned/running/succeeded/failed/skipped/cancelled/needs_manual_action',
    retry_count             INT NOT NULL DEFAULT 0 COMMENT '重试次数',
    max_retries             INT NOT NULL DEFAULT 3 COMMENT '最大重试次数',
    last_error              TEXT DEFAULT NULL COMMENT '最后错误',
    next_retry_at           DATETIME DEFAULT NULL COMMENT '下次重试时间',
    locked_by               VARCHAR(100) DEFAULT NULL COMMENT '执行锁持有人',
    locked_until            DATETIME DEFAULT NULL COMMENT '执行锁过期时间',
    heartbeat_at            DATETIME DEFAULT NULL COMMENT '执行心跳时间',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_orchestration_step (job_id, step_key),
    INDEX idx_contract_orchestration_step_idempotency (idempotency_key),
    INDEX idx_contract_orchestration_step_contract (contract_id, sort_no),
    INDEX idx_contract_orchestration_step_status (status, next_retry_at),
    INDEX idx_contract_orchestration_step_target (target_app, target_action),
    INDEX idx_contract_orchestration_step_lock (locked_until),
    CONSTRAINT fk_contract_orchestration_step_job FOREIGN KEY (job_id) REFERENCES contract_orchestration_job(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_orchestration_step_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同编排步骤表';

-- ------------------------------------------------------------
-- 2.12.9 合同计划交付资产表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS service_agreement_asset;
DROP TABLE IF EXISTS service_agreement_project_rel;
DROP TABLE IF EXISTS service_agreement;
DROP TABLE IF EXISTS contract_delivery_asset_plan;
CREATE TABLE contract_delivery_asset_plan (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(64) NOT NULL COMMENT '计划交付资产编号',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    contract_line_id        BIGINT DEFAULT NULL COMMENT '合同行ID',
    obligation_id           BIGINT DEFAULT NULL COMMENT '履约义务ID',
    customer_code           VARCHAR(100) DEFAULT NULL COMMENT '客户编码',
    name                    VARCHAR(200) NOT NULL COMMENT '计划资产名称',
    product_code            VARCHAR(100) DEFAULT NULL COMMENT '产品编码',
    product_version         VARCHAR(100) DEFAULT NULL COMMENT '产品版本',
    catalog_item_code       VARCHAR(100) DEFAULT NULL COMMENT '目录项编码',
    product_origin          VARCHAR(30) DEFAULT NULL COMMENT '产品来源',
    source_contract_code    VARCHAR(64) NOT NULL COMMENT '来源合同编号',
    source_contract_line_code VARCHAR(64) DEFAULT NULL COMMENT '来源合同行编号',
    source_obligation_code  VARCHAR(64) DEFAULT NULL COMMENT '来源义务编号',
    source_project_code     VARCHAR(64) DEFAULT NULL COMMENT '来源项目编号',
    external_asset_code     VARCHAR(100) DEFAULT NULL COMMENT 'Assets资产编码',
    deployment_mode         VARCHAR(50) DEFAULT NULL COMMENT '部署模式',
    instance_key            VARCHAR(100) DEFAULT NULL COMMENT '实例键',
    tenant_key              VARCHAR(100) DEFAULT NULL COMMENT '租户键',
    environment_code        VARCHAR(100) DEFAULT NULL COMMENT '环境编码',
    license_model           VARCHAR(50) DEFAULT NULL COMMENT '授权模型',
    license_quantity        DECIMAL(18,4) DEFAULT NULL COMMENT '授权数量',
    capacity                DECIMAL(18,4) DEFAULT NULL COMMENT '容量',
    unit                    VARCHAR(30) DEFAULT NULL COMMENT '单位',
    status                  VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '状态',
    planned_delivery_at     DATETIME DEFAULT NULL COMMENT '计划交付时间',
    delivered_at            DATETIME DEFAULT NULL COMMENT '交付时间',
    go_live_at              DATETIME DEFAULT NULL COMMENT '上线时间',
    accepted_at             DATETIME DEFAULT NULL COMMENT '验收时间',
    expired_at              DATETIME DEFAULT NULL COMMENT '到期时间',
    terminated_at           DATETIME DEFAULT NULL COMMENT '终止时间',
    warranty_start_at       DATETIME DEFAULT NULL COMMENT '质保开始时间',
    warranty_end_at         DATETIME DEFAULT NULL COMMENT '质保结束时间',
    support_expiry_at       DATETIME DEFAULT NULL COMMENT '支持到期时间',
    source_job_id           BIGINT DEFAULT NULL COMMENT '来源编排作业ID',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_contract_delivery_asset_plan_code (code),
    UNIQUE KEY uk_contract_delivery_asset_plan_line (contract_id, contract_line_id, instance_key),
    INDEX idx_contract_delivery_asset_contract (contract_id, status),
    INDEX idx_contract_delivery_asset_line (contract_line_id),
    INDEX idx_contract_delivery_asset_customer (customer_code),
    INDEX idx_contract_delivery_asset_external (external_asset_code),
    INDEX idx_contract_delivery_asset_source_job (source_job_id),
    CONSTRAINT fk_contract_delivery_asset_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_contract_delivery_asset_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL,
    CONSTRAINT fk_contract_delivery_asset_obligation FOREIGN KEY (obligation_id) REFERENCES contract_obligation(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同计划交付资产表';

-- ------------------------------------------------------------
-- 2.12.10 服务协议表
-- ------------------------------------------------------------
CREATE TABLE service_agreement (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(64) NOT NULL COMMENT '服务协议编号',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    contract_line_id        BIGINT DEFAULT NULL COMMENT '合同行ID',
    customer_code           VARCHAR(100) DEFAULT NULL COMMENT '客户编码',
    name                    VARCHAR(200) NOT NULL COMMENT '服务协议名称',
    service_level           VARCHAR(50) DEFAULT NULL COMMENT '服务等级',
    service_start_date      DATE DEFAULT NULL COMMENT '服务开始日期',
    service_end_date        DATE DEFAULT NULL COMMENT '服务结束日期',
    service_window          VARCHAR(100) DEFAULT NULL COMMENT '服务窗口',
    billing_mode            VARCHAR(50) DEFAULT NULL COMMENT '计费方式',
    renewal_policy          VARCHAR(100) DEFAULT NULL COMMENT '续约策略',
    response_minutes        INT DEFAULT NULL COMMENT '默认响应时限(分钟)',
    resolution_minutes      INT DEFAULT NULL COMMENT '默认解决时限(分钟)',
    included_quota          DECIMAL(10,2) DEFAULT NULL COMMENT '包含工单额度',
    quota_unit              VARCHAR(30) DEFAULT NULL COMMENT '额度单位：ticket/hour/day',
    consumed_quota          DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '已消耗额度',
    renewal_remind_at       DATE DEFAULT NULL COMMENT '续约提醒日期',
    status                  VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '状态：planned/active/suspended/expired/terminated/cancelled',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '负责人',
    maintenance_contract_id BIGINT DEFAULT NULL COMMENT '来源维保合同ID',
    source_job_id           BIGINT DEFAULT NULL COMMENT '来源编排作业ID',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_service_agreement_code (code),
    UNIQUE KEY uk_service_agreement_line (contract_id, contract_line_id),
    INDEX idx_service_agreement_contract (contract_id, status),
    INDEX idx_service_agreement_customer (customer_code),
    INDEX idx_service_agreement_line (contract_line_id),
    INDEX idx_service_agreement_maintenance (maintenance_contract_id),
    INDEX idx_service_agreement_renewal (renewal_remind_at, status),
    INDEX idx_service_agreement_source_job (source_job_id),
    CONSTRAINT fk_service_agreement_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_service_agreement_line FOREIGN KEY (contract_line_id) REFERENCES contract_line(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议表';

-- ------------------------------------------------------------
-- 2.12.11 服务协议覆盖资产表
-- ------------------------------------------------------------
CREATE TABLE service_agreement_asset (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    service_agreement_id    BIGINT NOT NULL COMMENT '服务协议ID',
    delivery_asset_code     VARCHAR(100) NOT NULL COMMENT '计划或正式交付资产编码',
    coverage_type           VARCHAR(50) NOT NULL DEFAULT 'planned_asset' COMMENT '覆盖类型：planned_asset/customer_delivery_asset/pending_asset/legacy_delivery',
    coverage_start_date     DATE DEFAULT NULL COMMENT '覆盖开始日期',
    coverage_end_date       DATE DEFAULT NULL COMMENT '覆盖结束日期',
    included                TINYINT NOT NULL DEFAULT 1 COMMENT '是否包含',
    exclusion_note          VARCHAR(500) DEFAULT NULL COMMENT '排除说明',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_service_agreement_asset (service_agreement_id, delivery_asset_code),
    INDEX idx_service_agreement_asset_code (delivery_asset_code),
    CONSTRAINT fk_service_agreement_asset_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议覆盖资产表';

-- ------------------------------------------------------------
-- 2.12.11.1 服务协议正式覆盖对象表
-- ------------------------------------------------------------
CREATE TABLE service_agreement_coverage (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    coverage_code           VARCHAR(64) NOT NULL COMMENT '服务覆盖关系编号',
    service_agreement_id    BIGINT NOT NULL COMMENT '服务协议ID',
    target_type             VARCHAR(40) NOT NULL DEFAULT 'pending_plan' COMMENT '目标类型：delivery_asset/environment/delivery_asset_environment/pending_plan/legacy',
    source_plan_code        VARCHAR(100) DEFAULT NULL COMMENT 'Altoc合同计划资产编码',
    delivery_asset_code     VARCHAR(100) DEFAULT NULL COMMENT 'Assets正式客户交付资产编码',
    environment_code        VARCHAR(100) DEFAULT NULL COMMENT 'Assets正式环境编码',
    legacy_reference        VARCHAR(255) DEFAULT NULL COMMENT '无法自动解析的旧引用',
    resolution_status       VARCHAR(30) NOT NULL DEFAULT 'pending' COMMENT '解析状态：pending/resolved/needs_review',
    coverage_status         VARCHAR(30) NOT NULL DEFAULT 'planned' COMMENT '覆盖状态：planned/active/suspended/ended/cancelled',
    coverage_scope          VARCHAR(50) DEFAULT NULL COMMENT '覆盖范围',
    product_scope_json      JSON DEFAULT NULL COMMENT '产品覆盖范围快照',
    effective_from          DATE DEFAULT NULL COMMENT '生效日期',
    effective_to            DATE DEFAULT NULL COMMENT '失效日期',
    included                TINYINT NOT NULL DEFAULT 1 COMMENT '是否包含',
    exclusion_note          VARCHAR(500) DEFAULT NULL COMMENT '排除说明',
    source_type             VARCHAR(30) NOT NULL DEFAULT 'manual' COMMENT '来源类型：activation/migration/manual/renewal/callback',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',
    active_target_key       VARCHAR(500) GENERATED ALWAYS AS (
      CASE
        WHEN deleted_at IS NULL AND coverage_status <> 'cancelled' THEN CONCAT(
          service_agreement_id, ':', target_type, ':',
          CASE
            WHEN target_type = 'pending_plan' THEN COALESCE(source_plan_code, '')
            WHEN target_type = 'legacy' THEN COALESCE(legacy_reference, '')
            ELSE ''
          END, ':',
          COALESCE(delivery_asset_code, ''), ':',
          COALESCE(environment_code, ''), ':',
          COALESCE(DATE_FORMAT(effective_from, '%Y-%m-%d'), ''), ':',
          COALESCE(DATE_FORMAT(effective_to, '%Y-%m-%d'), '')
        )
        ELSE NULL
      END
    ) STORED,

    UNIQUE KEY uk_service_agreement_coverage_code (coverage_code),
    UNIQUE KEY uk_service_agreement_coverage_target (active_target_key),
    INDEX idx_sac_agreement (service_agreement_id, coverage_status, resolution_status),
    INDEX idx_sac_source_plan (source_plan_code, resolution_status),
    INDEX idx_sac_delivery_asset (delivery_asset_code, coverage_status),
    INDEX idx_sac_environment (environment_code, coverage_status),
    INDEX idx_sac_resolution (resolution_status, target_type),
    CONSTRAINT fk_sac_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议正式覆盖对象表';

-- ------------------------------------------------------------
-- 2.12.12 服务协议项目关系表
-- ------------------------------------------------------------
CREATE TABLE service_agreement_project_rel (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    service_agreement_id    BIGINT NOT NULL COMMENT '服务协议ID',
    project_code            VARCHAR(64) NOT NULL COMMENT 'Aims项目编号',
    project_role            VARCHAR(30) NOT NULL DEFAULT 'maintenance' COMMENT '项目角色：maintenance/operation/inspection/upgrade/special',
    is_default              TINYINT NOT NULL DEFAULT 0 COMMENT '是否默认项目',
    effective_from          DATE DEFAULT NULL COMMENT '生效日期',
    effective_to            DATE DEFAULT NULL COMMENT '失效日期',
    status                  VARCHAR(30) NOT NULL DEFAULT 'active' COMMENT '状态：planned/active/suspended/ended',
    source_type             VARCHAR(30) NOT NULL DEFAULT 'manual' COMMENT '来源类型：activation/manual/migration/ticket_resolution',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_service_agreement_project_role (service_agreement_id, project_code, project_role),
    INDEX idx_sapr_agreement (service_agreement_id, status, is_default),
    INDEX idx_sapr_project (project_code, status),
    INDEX idx_sapr_effective (service_agreement_id, project_role, effective_from, effective_to),
    CONSTRAINT fk_sapr_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务协议-Aims项目关系表';

-- ------------------------------------------------------------
-- 2.13 合同付款条款表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_payment_term;
CREATE TABLE contract_payment_term (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    contract_id     BIGINT NOT NULL COMMENT '合同ID',
    term_name       VARCHAR(100) NOT NULL COMMENT '条款名称',
    term_type       VARCHAR(20) NOT NULL COMMENT '条款类型：one_time/advance/milestone/acceptance/retention/annual_service',
    billing_mode    VARCHAR(30) DEFAULT 'stage' COMMENT '计费模式：one_time/ratio/stage/annual',
    sort_no         INT DEFAULT 0 COMMENT '排序号',
    amount          DECIMAL(18,2) NOT NULL COMMENT '金额',
    ratio           DECIMAL(5,2) DEFAULT NULL COMMENT '占合同金额比例(%)',
    condition_desc  VARCHAR(500) DEFAULT NULL COMMENT '触发条件描述',
    trigger_stage_type VARCHAR(30) DEFAULT NULL COMMENT '触发合同环节：contract_signed/delivery/acceptance/service_end',
    expected_date   DATE DEFAULT NULL COMMENT '预计日期',
    recurrence_interval VARCHAR(20) DEFAULT NULL COMMENT '周期：year/month/quarter',
    recurrence_month TINYINT DEFAULT NULL COMMENT '年度周期支付月份',
    recurrence_day  TINYINT DEFAULT NULL COMMENT '周期支付日',
    service_start_date DATE DEFAULT NULL COMMENT '服务期开始日期',
    service_end_date DATE DEFAULT NULL COMMENT '服务期结束日期',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_contract_id (contract_id),
    CONSTRAINT fk_cpt_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同付款条款表';

-- ------------------------------------------------------------
-- 2.13.1 合同履约环节表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS contract_stage;
CREATE TABLE contract_stage (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(30) NOT NULL COMMENT '环节编号',
    contract_id     BIGINT NOT NULL COMMENT '合同ID',
    stage_type      VARCHAR(30) NOT NULL COMMENT '环节类型：contract_signed/delivery/acceptance/service_end',
    stage_name      VARCHAR(100) NOT NULL COMMENT '环节名称',
    status          VARCHAR(30) DEFAULT 'completed' COMMENT '状态：pending/completed',
    stage_date      DATE DEFAULT NULL COMMENT '环节日期',
    evidence_note   VARCHAR(1000) DEFAULT NULL COMMENT '证明说明',
    document_uuid   VARCHAR(100) DEFAULT NULL COMMENT '证明文档UUID',
    document_title  VARCHAR(200) DEFAULT NULL COMMENT '证明文档标题',
    handled_by      VARCHAR(50) DEFAULT NULL COMMENT '处理人',
    handled_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '处理时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_contract_stage_type (contract_id, stage_type),
    UNIQUE KEY uk_contract_stage_code (code),
    INDEX idx_contract_stage_contract (contract_id),
    INDEX idx_contract_stage_type (stage_type),
    CONSTRAINT fk_contract_stage_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='合同履约环节表';

-- ------------------------------------------------------------
-- 2.14 维保合同表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS renewal_opportunity;
DROP TABLE IF EXISTS service_ticket;
DROP TABLE IF EXISTS service_entitlement;
DROP TABLE IF EXISTS maintenance_contract;
CREATE TABLE maintenance_contract (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '维保合同编号(MC-xxxxxx)',
    customer_id             BIGINT NOT NULL COMMENT '客户ID',
    contract_id             BIGINT DEFAULT NULL COMMENT '原合同ID',
    opportunity_id          BIGINT DEFAULT NULL COMMENT '来源商机ID',
    delivery_code           VARCHAR(64) DEFAULT NULL COMMENT 'Assets交付视图编号',
    project_code            VARCHAR(64) DEFAULT NULL COMMENT 'Aims项目编号',
    product_code            VARCHAR(64) DEFAULT NULL COMMENT '产品编号',
    product_version         VARCHAR(64) DEFAULT NULL COMMENT '产品版本',
    name                    VARCHAR(200) NOT NULL COMMENT '维保合同名称',
    service_level           VARCHAR(30) DEFAULT 'standard' COMMENT '服务级别：standard/premium/custom',
    service_start_date      DATE NOT NULL COMMENT '服务开始日期',
    service_end_date        DATE NOT NULL COMMENT '服务结束日期',
    amount                  DECIMAL(18,2) DEFAULT 0.00 COMMENT '维保金额',
    currency_code           VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
    status                  VARCHAR(30) DEFAULT 'active' COMMENT '状态：draft/active/expiring/expired/terminated',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '客户成功负责人',
    renewal_remind_at       DATE DEFAULT NULL COMMENT '续约提醒日期',
    source_app              VARCHAR(50) DEFAULT NULL COMMENT '来源应用',
    source_biz_type         VARCHAR(50) DEFAULT NULL COMMENT '来源业务类型',
    source_biz_id           VARCHAR(100) DEFAULT NULL COMMENT '来源业务ID',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_customer_id (customer_id),
    INDEX idx_contract_id (contract_id),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_delivery_code (delivery_code),
    INDEX idx_project_code (project_code),
    INDEX idx_service_period (service_start_date, service_end_date),
    INDEX idx_status (status),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_mc_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_mc_contract FOREIGN KEY (contract_id) REFERENCES contract(id),
    CONSTRAINT fk_mc_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='维保合同表';

-- ------------------------------------------------------------
-- 2.15 服务权益 / SLA 表
-- ------------------------------------------------------------
CREATE TABLE service_entitlement (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '服务权益编号(SE-xxxxxx)',
    maintenance_contract_id BIGINT NOT NULL COMMENT '维保合同ID',
    service_agreement_id    BIGINT DEFAULT NULL COMMENT '迁移后的服务协议ID',
    entitlement_type        VARCHAR(30) DEFAULT 'sla' COMMENT '权益类型：sla/quota/onsite/remote',
    name                    VARCHAR(120) NOT NULL COMMENT '权益名称',
    service_window          VARCHAR(50) DEFAULT '5x8' COMMENT '服务窗口：5x8/7x24/custom',
    priority                VARCHAR(20) DEFAULT 'normal' COMMENT '适用优先级：low/normal/high/urgent',
    response_minutes        INT DEFAULT NULL COMMENT '响应时限(分钟)',
    resolution_minutes      INT DEFAULT NULL COMMENT '解决时限(分钟)',
    included_quota          DECIMAL(10,2) DEFAULT NULL COMMENT '包含额度',
    quota_unit              VARCHAR(30) DEFAULT NULL COMMENT '额度单位：hour/ticket/day',
    billing_mode            VARCHAR(30) DEFAULT 'included' COMMENT '计费方式：included/billable/overage',
    status                  VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_contract_id (maintenance_contract_id),
    INDEX idx_service_agreement_id (service_agreement_id),
    INDEX idx_entitlement_type (entitlement_type),
    INDEX idx_priority (priority),
    INDEX idx_status (status),
    CONSTRAINT fk_se_maintenance_contract FOREIGN KEY (maintenance_contract_id) REFERENCES maintenance_contract(id) ON DELETE CASCADE,
    CONSTRAINT fk_se_service_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务权益/SLA表';

-- ------------------------------------------------------------
-- 2.16 服务工单表
-- ------------------------------------------------------------
CREATE TABLE service_ticket (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '服务工单编号(ST-xxxxxx)',
    customer_id             BIGINT NOT NULL COMMENT '客户ID',
    maintenance_contract_id BIGINT DEFAULT NULL COMMENT '维保合同ID',
    contract_id             BIGINT DEFAULT NULL COMMENT '合同ID',
    service_agreement_id    BIGINT DEFAULT NULL COMMENT '服务协议ID',
    service_agreement_code  VARCHAR(64) DEFAULT NULL COMMENT '服务协议编号快照',
    delivery_code           VARCHAR(64) DEFAULT NULL COMMENT 'Assets交付视图编号',
    delivery_asset_code     VARCHAR(100) DEFAULT NULL COMMENT '客户交付资产编码',
    project_code            VARCHAR(64) DEFAULT NULL COMMENT 'Aims项目编号',
    product_code            VARCHAR(64) DEFAULT NULL COMMENT '产品编号',
    product_version         VARCHAR(64) DEFAULT NULL COMMENT '产品版本',
    environment_code        VARCHAR(64) DEFAULT NULL COMMENT '环境编号',
    ticket_type             VARCHAR(30) NOT NULL COMMENT '类型：incident/consulting/requirement/change',
    title                   VARCHAR(200) NOT NULL COMMENT '标题',
    description             TEXT DEFAULT NULL COMMENT '描述',
    priority                VARCHAR(20) DEFAULT 'normal' COMMENT '优先级：low/normal/high/urgent',
    status                  VARCHAR(30) DEFAULT 'open' COMMENT '状态：open/accepted/processing/waiting_customer/resolved/closed/cancelled',
    sla_status              VARCHAR(30) DEFAULT 'not_started' COMMENT 'SLA状态：not_started/on_track/warning/breached/met',
    entitlement_status      VARCHAR(30) NOT NULL DEFAULT 'unknown' COMMENT '权益状态：unknown/in_service/out_of_service/over_quota',
    quota_consumed          DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '本工单已扣减额度',
    reported_by_contact     VARCHAR(100) DEFAULT NULL COMMENT '报障联系人',
    reported_by_phone       VARCHAR(50) DEFAULT NULL COMMENT '联系电话',
    reported_by_email       VARCHAR(100) DEFAULT NULL COMMENT '联系邮箱',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '客户成功负责人',
    handler_user_id         VARCHAR(50) DEFAULT NULL COMMENT '当前处理人',
    response_due_at         DATETIME DEFAULT NULL COMMENT '响应截止时间',
    resolution_due_at       DATETIME DEFAULT NULL COMMENT '解决截止时间',
    first_responded_at      DATETIME DEFAULT NULL COMMENT '首次响应时间',
    resolved_at             DATETIME DEFAULT NULL COMMENT '解决时间',
    closed_at               DATETIME DEFAULT NULL COMMENT '关闭时间',
    aims_project_code       VARCHAR(64) DEFAULT NULL COMMENT '回流Aims项目编号',
    aims_work_item_key      VARCHAR(100) DEFAULT NULL COMMENT '回流Aims工作项键',
    aims_work_item_type     VARCHAR(50) DEFAULT NULL COMMENT '回流Aims工作项类型',
    codocs_document_uuid    VARCHAR(100) DEFAULT NULL COMMENT '运维知识文档UUID',
    source_app              VARCHAR(50) DEFAULT NULL COMMENT '来源应用',
    source_biz_type         VARCHAR(50) DEFAULT NULL COMMENT '来源业务类型',
    source_biz_id           VARCHAR(100) DEFAULT NULL COMMENT '来源业务ID',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_customer_id (customer_id),
    INDEX idx_maintenance_contract_id (maintenance_contract_id),
    INDEX idx_contract_id (contract_id),
    INDEX idx_service_agreement_id (service_agreement_id),
    INDEX idx_service_agreement_code (service_agreement_code),
    INDEX idx_delivery_code (delivery_code),
    INDEX idx_delivery_asset_code (delivery_asset_code),
    INDEX idx_project_code (project_code),
    INDEX idx_status (status),
    INDEX idx_sla_status (sla_status),
    INDEX idx_entitlement_status (entitlement_status),
    INDEX idx_priority (priority),
    INDEX idx_aims_work_item_key (aims_work_item_key),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_st_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_st_maintenance_contract FOREIGN KEY (maintenance_contract_id) REFERENCES maintenance_contract(id),
    CONSTRAINT fk_st_contract FOREIGN KEY (contract_id) REFERENCES contract(id),
    CONSTRAINT fk_st_service_agreement FOREIGN KEY (service_agreement_id) REFERENCES service_agreement(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务工单表';

-- ------------------------------------------------------------
-- 2.17 续约机会表
-- ------------------------------------------------------------
CREATE TABLE renewal_opportunity (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '续约机会编号(RO-xxxxxx)',
    customer_id             BIGINT NOT NULL COMMENT '客户ID',
    maintenance_contract_id BIGINT DEFAULT NULL COMMENT '维保合同ID',
    contract_id             BIGINT DEFAULT NULL COMMENT '合同ID',
    source_ticket_id        BIGINT DEFAULT NULL COMMENT '来源服务工单ID',
    opportunity_id          BIGINT DEFAULT NULL COMMENT '转化后的Altoc商机ID',
    name                    VARCHAR(200) NOT NULL COMMENT '续约机会名称',
    renewal_type            VARCHAR(30) DEFAULT 'maintenance' COMMENT '类型：maintenance/upsell/cross_sell',
    expected_amount         DECIMAL(18,2) DEFAULT NULL COMMENT '预计金额',
    expected_sign_date      DATE DEFAULT NULL COMMENT '预计签约日期',
    stage                   VARCHAR(30) DEFAULT 'identified' COMMENT '阶段：identified/contacted/proposal/negotiation/closed',
    status                  VARCHAR(30) DEFAULT 'open' COMMENT '状态：open/won/lost/cancelled',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '负责人',
    risk_level              VARCHAR(20) DEFAULT NULL COMMENT '风险等级：low/medium/high',
    reason                  VARCHAR(500) DEFAULT NULL COMMENT '来源原因',
    next_action             VARCHAR(500) DEFAULT NULL COMMENT '下一步动作',
    next_action_due_at      DATETIME DEFAULT NULL COMMENT '下一步截止时间',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_customer_id (customer_id),
    INDEX idx_maintenance_contract_id (maintenance_contract_id),
    INDEX idx_contract_id (contract_id),
    INDEX idx_source_ticket_id (source_ticket_id),
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_expected_sign_date (expected_sign_date),
    INDEX idx_status (status),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_ro_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
    CONSTRAINT fk_ro_maintenance_contract FOREIGN KEY (maintenance_contract_id) REFERENCES maintenance_contract(id),
    CONSTRAINT fk_ro_contract FOREIGN KEY (contract_id) REFERENCES contract(id),
    CONSTRAINT fk_ro_source_ticket FOREIGN KEY (source_ticket_id) REFERENCES service_ticket(id),
    CONSTRAINT fk_ro_opportunity FOREIGN KEY (opportunity_id) REFERENCES opportunity(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='续约机会表';

-- ------------------------------------------------------------
-- 2.18 回款计划表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS receivable_plan;
CREATE TABLE receivable_plan (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                    VARCHAR(30) NOT NULL COMMENT '回款计划编号(RP-xxxxxx)',
    contract_id             BIGINT NOT NULL COMMENT '合同ID',
    payment_term_id         BIGINT DEFAULT NULL COMMENT '付款条款ID',
    customer_id             BIGINT NOT NULL COMMENT '客户ID',
    opportunity_id          BIGINT DEFAULT NULL COMMENT '商机ID',
    plan_name               VARCHAR(200) NOT NULL COMMENT '计划名称',
    plan_type               VARCHAR(20) DEFAULT NULL COMMENT '计划类型：advance/milestone/acceptance/retention',
    status                  VARCHAR(20) DEFAULT 'pending' COMMENT '状态：pending/to_invoice/to_receive/partially_received/received/overdue/bad_debt',
    amount                  DECIMAL(18,2) NOT NULL COMMENT '计划金额',
    planned_invoice_date    DATE DEFAULT NULL COMMENT '计划开票日期',
    planned_payment_date    DATE DEFAULT NULL COMMENT '计划回款日期',
    received_amount         DECIMAL(18,2) DEFAULT 0.00 COMMENT '已回款金额',
    unreceived_amount       DECIMAL(18,2) DEFAULT NULL COMMENT '未回款金额',
    overdue_days            INT DEFAULT 0 COMMENT '逾期天数',
    risk_level              VARCHAR(20) DEFAULT NULL COMMENT '风险等级：high/medium/low',
    owner_user_id           VARCHAR(50) DEFAULT NULL COMMENT '负责人',
    remark                  VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by              VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by              VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at              DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at              DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at              DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_contract_id (contract_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_status (status),
    INDEX idx_planned_payment_date (planned_payment_date),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_deleted_at (deleted_at),
    CONSTRAINT fk_rp_contract FOREIGN KEY (contract_id) REFERENCES contract(id),
    CONSTRAINT fk_rp_customer FOREIGN KEY (customer_id) REFERENCES customer(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='回款计划表';

-- ------------------------------------------------------------
-- 2.19 发票遗留兼容表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS invoice;
CREATE TABLE invoice (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(30) NOT NULL COMMENT '发票记录编号(IV-xxxxxx)',
    receivable_plan_id  BIGINT DEFAULT NULL COMMENT '回款计划ID',
    contract_id         BIGINT NOT NULL COMMENT '合同ID',
    invoice_no          VARCHAR(50) DEFAULT NULL COMMENT '发票号码',
    invoice_type        VARCHAR(30) DEFAULT NULL COMMENT '发票类型：special_vat/general_vat/electronic',
    invoice_amount      DECIMAL(18,2) NOT NULL COMMENT '开票金额',
    invoice_date        DATE DEFAULT NULL COMMENT '开票日期',
    status              VARCHAR(20) DEFAULT 'draft' COMMENT '状态：draft/requested/issued/canceled',
    receiver_name       VARCHAR(200) DEFAULT NULL COMMENT '源系统接收方',
    invoice_item        VARCHAR(500) DEFAULT NULL COMMENT '源系统开票内容',
    taxpayer_name       VARCHAR(200) DEFAULT NULL COMMENT '购方名称',
    taxpayer_no         VARCHAR(50) DEFAULT NULL COMMENT '购方税号',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    legacy_refs_json    JSON DEFAULT NULL COMMENT '源系统项目/公司/档案页/旧合同等引用',
    remark              VARCHAR(500) DEFAULT NULL COMMENT '备注',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    updated_by          VARCHAR(50) DEFAULT NULL COMMENT '更新人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    deleted_at          DATETIME DEFAULT NULL COMMENT '软删除时间',

    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_invoice_legacy (legacy_source, legacy_id),
    INDEX idx_receivable_plan_id (receivable_plan_id),
    INDEX idx_contract_id (contract_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='发票遗留兼容表；正式发票以 Finance.finance_invoice 为准';

-- ------------------------------------------------------------
-- 2.20 到账记录表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS payment_record;
CREATE TABLE payment_record (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code                VARCHAR(30) NOT NULL COMMENT '到账记录编号(PM-xxxxxx)',
    receivable_plan_id  BIGINT DEFAULT NULL COMMENT '回款计划ID',
    contract_id         BIGINT NOT NULL COMMENT '合同ID',
    customer_id         BIGINT NOT NULL COMMENT '客户ID',
    received_amount     DECIMAL(18,2) NOT NULL COMMENT '到账金额',
    received_at         DATE NOT NULL COMMENT '到账日期',
    payer_name          VARCHAR(200) DEFAULT NULL COMMENT '付款方名称',
    bank_account        VARCHAR(100) DEFAULT NULL COMMENT '付款账号',
    source_income_type  VARCHAR(20) DEFAULT NULL COMMENT '源系统收入类型编码',
    channel             VARCHAR(20) DEFAULT NULL COMMENT '源系统收款渠道编码',
    handler_user_id     VARCHAR(50) DEFAULT NULL COMMENT '源系统经办人',
    legacy_source       VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT DEFAULT NULL COMMENT '迁移来源主键',
    legacy_refs_json    JSON DEFAULT NULL COMMENT '源系统项目/账户/对应支出等引用',
    note                VARCHAR(500) DEFAULT NULL COMMENT '备注',
    confirmed_by        VARCHAR(50) DEFAULT NULL COMMENT '确认人',
    confirmed_at        DATETIME DEFAULT NULL COMMENT '确认时间',
    created_by          VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code),
    UNIQUE KEY uk_payment_legacy (legacy_source, legacy_id),
    INDEX idx_receivable_plan_id (receivable_plan_id),
    INDEX idx_contract_id (contract_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_received_at (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='到账记录表';

-- ------------------------------------------------------------
-- 2.21 迁移来源映射表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS legacy_migration_map;
CREATE TABLE legacy_migration_map (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    batch_code          VARCHAR(50) NOT NULL COMMENT '迁移批次',
    source_system       VARCHAR(50) NOT NULL COMMENT '来源系统',
    source_table        VARCHAR(100) NOT NULL COMMENT '来源表名',
    source_id           VARCHAR(100) NOT NULL COMMENT '来源主键',
    target_table        VARCHAR(100) NOT NULL COMMENT '目标表名',
    target_id           BIGINT NOT NULL COMMENT '目标主键',
    source_hash         VARCHAR(64) DEFAULT NULL COMMENT '源记录摘要hash',
    migrated_at         DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '迁移时间',
    note                VARCHAR(500) DEFAULT NULL COMMENT '备注',

    UNIQUE KEY uk_legacy_map_source (source_system, source_table, source_id),
    INDEX idx_legacy_map_target (target_table, target_id),
    INDEX idx_legacy_map_batch (batch_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='迁移来源映射表';

-- ------------------------------------------------------------
-- 2.22 源系统未挂合同收入暂存表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS legacy_unmapped_income;
CREATE TABLE legacy_unmapped_income (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    legacy_source       VARCHAR(50) NOT NULL COMMENT '迁移来源系统',
    legacy_id           BIGINT NOT NULL COMMENT '源系统收入ID',
    project_legacy_id   BIGINT DEFAULT NULL COMMENT '源系统项目ID',
    handler_user_id     VARCHAR(50) DEFAULT NULL COMMENT '经办人',
    received_at         DATE NOT NULL COMMENT '到账日期',
    amount              DECIMAL(18,2) DEFAULT NULL COMMENT '金额',
    source_income_type  VARCHAR(20) DEFAULT NULL COMMENT '源系统收入类型编码',
    channel             VARCHAR(20) DEFAULT NULL COMMENT '收款渠道编码',
    payer_name          VARCHAR(200) DEFAULT NULL COMMENT '付款方名称',
    matter              VARCHAR(500) DEFAULT NULL COMMENT '事由',
    legacy_refs_json    JSON DEFAULT NULL COMMENT '源系统账户/对应支出/操作员等引用',
    resolution_status   VARCHAR(20) DEFAULT 'pending' COMMENT '处理状态：pending/linked/ignored',
    linked_payment_id   BIGINT DEFAULT NULL COMMENT '后续补链到账记录ID',
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_unmapped_income_legacy (legacy_source, legacy_id),
    INDEX idx_unmapped_income_received_at (received_at),
    INDEX idx_unmapped_income_status (resolution_status),
    INDEX idx_unmapped_income_linked_payment (linked_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='源系统未挂合同收入暂存表';

-- ------------------------------------------------------------
-- 2.23 看板快照表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS dashboard_snapshot;
CREATE TABLE dashboard_snapshot (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    snapshot_date   DATE NOT NULL COMMENT '快照日期',
    scope_type      VARCHAR(20) NOT NULL COMMENT '范围类型：company/dept/user',
    scope_id        VARCHAR(50) DEFAULT NULL COMMENT '范围ID',
    metric_key      VARCHAR(50) NOT NULL COMMENT '指标键',
    metric_value    DECIMAL(18,2) DEFAULT NULL COMMENT '指标值',
    dimension_json  JSON DEFAULT NULL COMMENT '维度JSON(附加维度信息)',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_snapshot_date (snapshot_date),
    INDEX idx_scope (scope_type, scope_id),
    INDEX idx_metric_key (metric_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='看板快照表';

-- ============================================================
-- 二B、组织与团队表
-- ============================================================

-- ------------------------------------------------------------
-- 2B.1 销售团队表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS sales_team;
CREATE TABLE sales_team (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    code            VARCHAR(50) NOT NULL COMMENT '团队编码',
    name            VARCHAR(100) NOT NULL COMMENT '团队名称',
    team_type       VARCHAR(20) NOT NULL DEFAULT 'sales' COMMENT '团队类型：sales/business/presales',
    parent_id       BIGINT DEFAULT NULL COMMENT '上级团队ID',
    leader_user_id  VARCHAR(50) DEFAULT NULL COMMENT '团队负责人(Account模块uid)',
    description     VARCHAR(500) DEFAULT NULL COMMENT '团队描述',
    status          VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_code (code),
    INDEX idx_team_type (team_type),
    INDEX idx_parent_id (parent_id),
    INDEX idx_leader_user_id (leader_user_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售团队表';

-- ------------------------------------------------------------
-- 2B.2 团队成员表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS sales_team_member;
CREATE TABLE sales_team_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    team_id         BIGINT NOT NULL COMMENT '所属团队ID',
    user_id         VARCHAR(50) NOT NULL COMMENT '用户ID(Account模块uid)',
    role            VARCHAR(30) NOT NULL DEFAULT 'member' COMMENT '团队内角色：senior_manager/manager/assistant/member',
    is_primary      TINYINT DEFAULT 0 COMMENT '是否主团队：1是 0否',
    joined_at       DATE DEFAULT NULL COMMENT '加入时间',
    left_at         DATE DEFAULT NULL COMMENT '离开时间',
    status          VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    UNIQUE KEY uk_team_user_active (team_id, user_id, status),
    INDEX idx_team_id (team_id),
    INDEX idx_user_id (user_id),
    INDEX idx_role (role),
    INDEX idx_status (status),
    CONSTRAINT fk_stm_team FOREIGN KEY (team_id) REFERENCES sales_team(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队成员表';

-- ------------------------------------------------------------
-- 2B.3 文档关联表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS document_link;
CREATE TABLE document_link (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    entity_type     VARCHAR(30) NOT NULL COMMENT '实体类型：lead/opportunity/contract/quotation/customer/tender',
    entity_id       BIGINT NOT NULL COMMENT '实体ID',
    document_uuid   CHAR(36) DEFAULT NULL COMMENT 'Codocs文档UUID，外部链接为空',
    external_url    VARCHAR(1000) DEFAULT NULL COMMENT '外部文档URL',
    external_mime_type VARCHAR(100) DEFAULT NULL COMMENT '外部文档MIME类型',
    document_title  VARCHAR(255) DEFAULT NULL COMMENT '文档标题(冗余)',
    link_type       VARCHAR(30) DEFAULT 'general' COMMENT '关联类型：proposal/contract_text/meeting_memo/tender_doc/general',
    source_type     VARCHAR(30) DEFAULT 'codocs' COMMENT '来源类型：codocs/external_url',
    legacy_source   VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
    legacy_id       VARCHAR(100) DEFAULT NULL COMMENT '迁移来源主键',
    created_by      VARCHAR(50) DEFAULT NULL COMMENT '创建人',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_entity_doc (entity_type, entity_id, document_uuid),
    UNIQUE KEY uk_document_link_legacy (legacy_source, legacy_id),
    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_document_uuid (document_uuid),
    INDEX idx_source_type (source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档关联表';

-- ============================================================
-- 二C、投标管理表
-- ============================================================

-- ------------------------------------------------------------
-- 2C.0 招标代理机构表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS tender_agency;
CREATE TABLE tender_agency (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    name            VARCHAR(200) NOT NULL COMMENT '机构名称',
    agency_type     VARCHAR(30) DEFAULT NULL COMMENT '代理类型：government/group/third_party',
    address         VARCHAR(500) DEFAULT NULL COMMENT '地址',
    contact_name    VARCHAR(50) DEFAULT NULL COMMENT '联系人',
    contact_phone   VARCHAR(30) DEFAULT NULL COMMENT '联系电话',
    contact_email   VARCHAR(100) DEFAULT NULL COMMENT '邮箱',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',

    INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='招标代理机构表';

-- ------------------------------------------------------------
-- 2C.1 投标项目表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS tender;
CREATE TABLE tender (
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
    INDEX idx_opportunity_id (opportunity_id),
    INDEX idx_customer_id (customer_id),
    INDEX idx_status (status),
    INDEX idx_owner_user_id (owner_user_id),
    INDEX idx_bid_submission_deadline (bid_submission_deadline),
    INDEX idx_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投标项目表';

-- ------------------------------------------------------------
-- 2C.2 投标关键节点表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS tender_milestone;
CREATE TABLE tender_milestone (
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

    INDEX idx_tender_id (tender_id),
    INDEX idx_status (status),
    INDEX idx_due_date (due_date),
    CONSTRAINT fk_tm_tender FOREIGN KEY (tender_id) REFERENCES tender(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投标关键节点表';

-- ------------------------------------------------------------
-- 2C.3 投标团队成员表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS tender_member;
CREATE TABLE tender_member (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    tender_id       BIGINT NOT NULL COMMENT '投标项目ID',
    user_id         VARCHAR(50) NOT NULL COMMENT '用户ID',
    role            VARCHAR(30) DEFAULT 'member' COMMENT '角色：pm/business/presales/technical/finance/member',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    UNIQUE KEY uk_tender_user (tender_id, user_id),
    INDEX idx_tender_id (tender_id),
    CONSTRAINT fk_tmem_tender FOREIGN KEY (tender_id) REFERENCES tender(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='投标团队成员表';

-- ============================================================
-- 三、辅助表
-- ============================================================

-- ------------------------------------------------------------
-- 3.1 附件表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS attachment;
CREATE TABLE attachment (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    entity_type     VARCHAR(30) NOT NULL COMMENT '实体类型：customer/lead/opportunity/quotation/contract/activity',
    entity_id       BIGINT NOT NULL COMMENT '实体ID',
    attachment_type VARCHAR(30) DEFAULT 'general' COMMENT '附件类型：general/contract_text/contract_scan/source_evidence等',
    file_name       VARCHAR(200) NOT NULL COMMENT '文件名',
    file_key        VARCHAR(500) NOT NULL COMMENT 'OSS文件Key',
    file_size       BIGINT DEFAULT NULL COMMENT '文件大小(字节)',
    content_type    VARCHAR(100) DEFAULT NULL COMMENT 'MIME类型',
    uploaded_by     VARCHAR(50) NOT NULL COMMENT '上传人',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_uploaded_by (uploaded_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='附件表';

-- ------------------------------------------------------------
-- 3.2 领域事件 Outbox 表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS domain_event_outbox;
CREATE TABLE domain_event_outbox (
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

-- ------------------------------------------------------------
-- 3.3 审计日志表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS audit_log;
CREATE TABLE audit_log (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    entity_type     VARCHAR(30) NOT NULL COMMENT '实体类型',
    entity_id       BIGINT NOT NULL COMMENT '实体ID',
    action          VARCHAR(20) NOT NULL COMMENT '操作类型：create/update/delete/status_change/approve/reject',
    old_value       JSON DEFAULT NULL COMMENT '变更前值',
    new_value       JSON DEFAULT NULL COMMENT '变更后值',
    operator_id     VARCHAR(50) NOT NULL COMMENT '操作人ID',
    operator_name   VARCHAR(50) DEFAULT NULL COMMENT '操作人姓名',
    ip_address      VARCHAR(50) DEFAULT NULL COMMENT 'IP地址',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_entity (entity_type, entity_id),
    INDEX idx_operator_id (operator_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='审计日志表';

-- ------------------------------------------------------------
-- 3.4 站内通知表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS notification;
CREATE TABLE notification (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    user_id         VARCHAR(50) NOT NULL COMMENT '接收人',
    title           VARCHAR(200) NOT NULL COMMENT '通知标题',
    content         TEXT DEFAULT NULL COMMENT '通知内容',
    notify_type     VARCHAR(30) NOT NULL COMMENT '通知类型：approval/reminder/overdue/system',
    related_type    VARCHAR(30) DEFAULT NULL COMMENT '关联实体类型',
    related_id      BIGINT DEFAULT NULL COMMENT '关联实体ID',
    is_read         TINYINT DEFAULT 0 COMMENT '是否已读：1是 0否',
    read_at         DATETIME DEFAULT NULL COMMENT '已读时间',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',

    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at),
    INDEX idx_related (related_type, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='站内通知表';

-- ============================================================
-- 四、AI 辅助表
-- ============================================================

-- ------------------------------------------------------------
-- 4.1 客户AI摘要表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS customer_ai_summary;
CREATE TABLE customer_ai_summary (
    id              BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    customer_id     BIGINT NOT NULL COMMENT '客户ID',
    summary_text    TEXT NOT NULL COMMENT '摘要文本',
    highlights_json JSON DEFAULT NULL COMMENT '要点JSON',
    generated_at    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
    model_name      VARCHAR(50) DEFAULT NULL COMMENT '模型名称',

    INDEX idx_customer_id (customer_id),
    CONSTRAINT fk_cais_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户AI摘要表';

-- ------------------------------------------------------------
-- 4.2 商机AI风险分析表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS opportunity_ai_risk;
CREATE TABLE opportunity_ai_risk (
    id                      BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    opportunity_id          BIGINT NOT NULL COMMENT '商机ID',
    risk_level              VARCHAR(20) NOT NULL COMMENT '风险等级：high/medium/low',
    risk_tags_json          JSON DEFAULT NULL COMMENT '风险标签JSON',
    risk_reason             TEXT DEFAULT NULL COMMENT '风险原因',
    suggested_next_action   VARCHAR(500) DEFAULT NULL COMMENT '建议下一步动作',
    generated_at            DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
    model_name              VARCHAR(50) DEFAULT NULL COMMENT '模型名称',

    INDEX idx_opportunity_id (opportunity_id),
    CONSTRAINT fk_oair_opp FOREIGN KEY (opportunity_id) REFERENCES opportunity(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='商机AI风险分析表';

-- ------------------------------------------------------------
-- 4.3 销售纪要AI结构化表
-- ------------------------------------------------------------
DROP TABLE IF EXISTS activity_ai_summary;
CREATE TABLE activity_ai_summary (
    id                  BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
    sales_activity_id   BIGINT NOT NULL COMMENT '销售活动ID',
    structured_json     JSON NOT NULL COMMENT '结构化结果JSON',
    generated_at        DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '生成时间',
    model_name          VARCHAR(50) DEFAULT NULL COMMENT '模型名称',
    confirmed_by_user   VARCHAR(50) DEFAULT NULL COMMENT '确认人',
    confirmed_at        DATETIME DEFAULT NULL COMMENT '确认时间',

    INDEX idx_sales_activity_id (sales_activity_id),
    CONSTRAINT fk_aais_activity FOREIGN KEY (sales_activity_id) REFERENCES sales_activity(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='销售纪要AI结构化表';

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 五、种子数据
-- ============================================================

-- ------------------------------------------------------------
-- 5.1 行业 / 5.2 区域：已迁移至 Account 模块统一管理
-- ------------------------------------------------------------
-- 行业字典：account.business_domain（GET /api/v1/business-domains）
-- 区域字典：account.company_region（GET /api/v1/companies/:code/regions）
-- altoc 运行时通过 server/utils/accountDict.ts 代理拉取

-- ------------------------------------------------------------
-- 5.3 客户等级数据
-- ------------------------------------------------------------
INSERT INTO customer_level (code, name, sort_no) VALUES
('strategic', '战略客户', 1),
('key', '重要客户', 2),
('standard', '普通客户', 3),
('potential', '潜力客户', 4);

-- ------------------------------------------------------------
-- 5.4 客户类型数据
-- ------------------------------------------------------------
INSERT INTO customer_type (code, name, is_partner_type) VALUES
('enterprise', '企业', 0),
('government', '政府', 0),
('institution', '事业单位', 0),
('state_owned', '国有企业', 0),
('partner', '渠道伙伴', 1);

-- ------------------------------------------------------------
-- 5.5 商机阶段数据
-- ------------------------------------------------------------
INSERT INTO opportunity_stage (code, pipeline_code, stage_kind, name, sort_no, win_rate, is_closed, is_won, is_lost, required_fields_json, exit_criteria_json) VALUES
('initial_contact', 'default', 'normal', '初步接触', 1, 10.00, 0, 0, 0, NULL, '{"description": "确认客户有初步需求意向并安排下一步", "fields": ["next_action", "next_action_due_at"]}'),
('requirement_confirmed', 'default', 'normal', '需求确认', 2, 25.00, 0, 0, 0, '["customer_id", "amount_tax_inclusive"]', '{"description": "客户需求已明确，可以输出方案", "fields": ["amount_tax_inclusive", "next_action", "next_action_due_at"]}'),
('proposal_quotation', 'default', 'normal', '方案报价', 3, 50.00, 0, 0, 0, '["amount_tax_inclusive", "competitor_info"]', '{"description": "方案/报价已提交客户并约定反馈", "fields": ["amount_tax_inclusive", "competitor_info", "next_action", "next_action_due_at"]}'),
('negotiation', 'default', 'normal', '商务谈判', 4, 70.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "完成商务条件谈判并明确签约计划", "fields": ["amount_tax_inclusive", "expected_sign_date", "next_action", "next_action_due_at"]}'),
('pending_sign', 'default', 'normal', '待签约', 5, 90.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "合同条款已确认，等待签署", "fields": ["amount_tax_inclusive", "expected_sign_date"]}'),
('won', 'default', 'won', '赢单', 6, 100.00, 1, 1, 0, '["amount_tax_inclusive", "expected_sign_date", "won_reason_code", "won_reason"]', NULL),
('lost', 'default', 'lost', '输单', 7, 0.00, 1, 0, 1, '["lost_reason_code", "lost_reason", "competitor_info"]', NULL),
('paused', 'default', 'paused', '暂停', 8, 0.00, 0, 0, 0, '["pause_reason_code", "pause_reason"]', NULL),
('solution_discovery', 'solution', 'normal', '线索确认', 1, 10.00, 0, 0, 0, NULL, '{"description": "确认客户业务痛点、预算可能性和下一步调研安排", "fields": ["next_action", "next_action_due_at"]}'),
('solution_requirements', 'solution', 'normal', '需求调研', 2, 25.00, 0, 0, 0, NULL, '{"description": "完成关键干系人访谈并形成需求范围", "fields": ["next_action", "next_action_due_at"]}'),
('solution_design', 'solution', 'normal', '方案设计', 3, 45.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "完成方案、范围和初步报价假设", "fields": ["amount_tax_inclusive", "expected_sign_date", "next_action", "next_action_due_at"]}'),
('solution_poc', 'solution', 'normal', 'POC/试点', 4, 60.00, 0, 0, 0, '["amount_tax_inclusive", "competitor_info"]', '{"description": "完成验证计划或试点反馈，明确成败标准", "fields": ["competitor_info", "next_action", "next_action_due_at"]}'),
('solution_negotiation', 'solution', 'normal', '商务谈判', 5, 75.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "商务条件、范围和实施节奏已进入谈判", "fields": ["amount_tax_inclusive", "expected_sign_date", "next_action", "next_action_due_at"]}'),
('solution_pending_sign', 'solution', 'normal', '待签约', 6, 90.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "合同条款已确认，等待签署", "fields": ["amount_tax_inclusive", "expected_sign_date"]}'),
('solution_won', 'solution', 'won', '赢单', 7, 100.00, 1, 1, 0, '["amount_tax_inclusive", "expected_sign_date", "won_reason_code", "won_reason"]', NULL),
('solution_lost', 'solution', 'lost', '输单', 8, 0.00, 1, 0, 1, '["lost_reason_code", "lost_reason", "competitor_info"]', NULL),
('solution_paused', 'solution', 'paused', '暂停', 9, 0.00, 0, 0, 0, '["pause_reason_code", "pause_reason"]', NULL),
('tog_intelligence', 'tog_project', 'normal', '项目信息', 1, 5.00, 0, 0, 0, NULL, '{"description": "识别项目背景、主管单位和采购窗口", "fields": ["next_action", "next_action_due_at"]}'),
('tog_budget_approval', 'tog_project', 'normal', '立项/预算', 2, 15.00, 0, 0, 0, '["expected_sign_date"]', '{"description": "跟进立项、预算和采购方式，确认推进路径", "fields": ["expected_sign_date", "next_action", "next_action_due_at"]}'),
('tog_tender_tracking', 'tog_project', 'normal', '招标跟进', 3, 30.00, 0, 0, 0, '["amount_tax_inclusive", "competitor_info"]', '{"description": "跟进招标文件、评分办法和竞争格局", "fields": ["amount_tax_inclusive", "competitor_info", "next_action", "next_action_due_at"]}'),
('tog_bid_preparation', 'tog_project', 'normal', '投标准备', 4, 45.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date", "competitor_info"]', '{"description": "完成标书、授权、报价和投标排期", "fields": ["amount_tax_inclusive", "expected_sign_date", "competitor_info", "next_action", "next_action_due_at"]}'),
('tog_bid_submitted', 'tog_project', 'normal', '已投标', 5, 60.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "已提交投标文件，等待评审或澄清", "fields": ["amount_tax_inclusive", "expected_sign_date", "next_action", "next_action_due_at"]}'),
('tog_pre_award', 'tog_project', 'normal', '中标候选', 6, 80.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "中标候选或拟成交，仍需等待公告、预算或合同流程", "fields": ["amount_tax_inclusive", "expected_sign_date", "next_action", "next_action_due_at"]}'),
('tog_pending_contract', 'tog_project', 'normal', '待签合同', 7, 90.00, 0, 0, 0, '["amount_tax_inclusive", "expected_sign_date"]', '{"description": "中标后合同条款和签署流程推进中", "fields": ["amount_tax_inclusive", "expected_sign_date"]}'),
('tog_won', 'tog_project', 'won', '赢单', 8, 100.00, 1, 1, 0, '["amount_tax_inclusive", "expected_sign_date", "won_reason_code", "won_reason"]', NULL),
('tog_lost', 'tog_project', 'lost', '输单', 9, 0.00, 1, 0, 1, '["lost_reason_code", "lost_reason", "competitor_info"]', NULL),
('tog_paused', 'tog_project', 'paused', '暂停', 10, 0.00, 0, 0, 0, '["pause_reason_code", "pause_reason"]', NULL);

-- ------------------------------------------------------------
-- 5.6 合同业务模板数据
-- ------------------------------------------------------------
INSERT INTO contract_business_template
  (code, name, direction, primary_type, is_system, status, version_no, template_json, created_by)
VALUES
  ('sales_software_license', '软件许可销售', 'sales', 'software_license', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'own_software_license', 'billing_method', 'fixed_price', 'fulfillment_method', 'point_in_time', 'project_policy', 'none', 'asset_policy', 'create_on_delivery')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('sales_saas_subscription', 'SaaS订阅', 'sales', 'saas_subscription', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'own_saas_subscription', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'project_policy', 'none', 'asset_policy', 'planned_on_effective')), 'required_fields', JSON_ARRAY('customer_id', 'service_start_date', 'service_end_date', 'lines')), 'system'),
  ('sales_custom_development', '定制开发', 'sales', 'custom_development', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'custom_development', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'project_policy', 'required', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'opportunity_id', 'lines')), 'system'),
  ('sales_implementation', '实施服务', 'sales', 'implementation_service', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'implementation', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'project_policy', 'required', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('sales_maintenance', '维保/技术支持', 'sales', 'maintenance_service', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'maintenance_support', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'service_policy', 'maintenance')), 'required_fields', JSON_ARRAY('customer_id', 'service_start_date', 'service_end_date', 'lines')), 'system'),
  ('sales_system_integration', '系统集成', 'sales', 'system_integration', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'system_integration', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'project_policy', 'required', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('sales_managed_service', '托管服务', 'sales', 'managed_service', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'managed_service', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'service_policy', 'managed_service')), 'required_fields', JSON_ARRAY('customer_id', 'service_start_date', 'service_end_date', 'lines')), 'system'),
  ('sales_third_party_resale', '第三方产品转售', 'sales', 'third_party_resale', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'third_party_software', 'billing_method', 'fixed_price', 'fulfillment_method', 'point_in_time', 'product_origin', 'third_party', 'procurement_policy', 'optional')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_software_subscription', '软件/订阅采购', 'purchase', 'software_subscription_purchase', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'third_party_software', 'billing_method', 'subscription', 'fulfillment_method', 'over_time', 'product_origin', 'third_party')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_hardware', '硬件设备采购', 'purchase', 'hardware_purchase', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'hardware', 'billing_method', 'fixed_price', 'fulfillment_method', 'point_in_time', 'product_origin', 'third_party')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_professional_service', '外包开发/专业服务采购', 'purchase', 'professional_service_purchase', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'custom_development', 'billing_method', 'milestone', 'fulfillment_method', 'over_time', 'product_origin', 'third_party', 'acceptance_required', true)), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system'),
  ('purchase_framework', '采购框架合同', 'purchase', 'purchase_framework', 1, 'active', 1, JSON_OBJECT('line_defaults', JSON_ARRAY(JSON_OBJECT('line_type', 'other_fee', 'billing_method', 'value', 'fulfillment_method', 'over_time', 'product_origin', 'third_party')), 'required_fields', JSON_ARRAY('customer_id', 'lines')), 'system');

-- ------------------------------------------------------------
-- 5.7 付款条款模板数据
-- ------------------------------------------------------------
INSERT INTO payment_term_template (code, name, template_json) VALUES
('standard_343', '标准343', '{"terms": [{"term_type": "advance", "ratio": 30, "name": "预付款(30%)", "condition": "合同签订后15日内"}, {"term_type": "milestone", "ratio": 40, "name": "里程碑款(40%)", "condition": "系统上线验收通过后15日内"}, {"term_type": "acceptance", "ratio": 30, "name": "验收款(30%)", "condition": "最终验收通过后30日内"}]}'),
('standard_532', '标准532', '{"terms": [{"term_type": "advance", "ratio": 50, "name": "预付款(50%)", "condition": "合同签订后15日内"}, {"term_type": "milestone", "ratio": 30, "name": "里程碑款(30%)", "condition": "系统上线验收通过后15日内"}, {"term_type": "acceptance", "ratio": 20, "name": "验收款(20%)", "condition": "最终验收通过后30日内"}]}'),
('milestone_3331', '里程碑3331', '{"terms": [{"term_type": "advance", "ratio": 30, "name": "预付款(30%)", "condition": "合同签订后15日内"}, {"term_type": "milestone", "ratio": 30, "name": "中期款(30%)", "condition": "中期里程碑完成后15日内"}, {"term_type": "acceptance", "ratio": 30, "name": "验收款(30%)", "condition": "最终验收通过后30日内"}, {"term_type": "retention", "ratio": 10, "name": "质保金(10%)", "condition": "质保期满后30日内"}]}'),
('gov_standard', '政府项目标准', '{"terms": [{"term_type": "milestone", "ratio": 50, "name": "到货验收款(50%)", "condition": "设备到货安装验收后30日内"}, {"term_type": "acceptance", "ratio": 45, "name": "终验款(45%)", "condition": "最终验收通过后60日内"}, {"term_type": "retention", "ratio": 5, "name": "质保金(5%)", "condition": "质保期满后30日内"}]}'),
('full_prepay', '全额预付', '{"terms": [{"term_type": "advance", "ratio": 100, "name": "全额预付", "condition": "合同签订后15日内"}]}');

-- ------------------------------------------------------------
-- 5.8 审批规则数据(MVP硬编码阈值)
-- ------------------------------------------------------------
INSERT INTO approval_rule (code, rule_type, rule_name, condition_json, approver_scope_json) VALUES
('quot_discount_15', 'quotation_discount', '报价折扣>15%需销售经理审批', '{"field": "discount_rate", "operator": ">", "value": 15}', '{"role": "sales_manager"}'),
('quot_discount_30', 'quotation_discount', '报价折扣>30%需管理层审批', '{"field": "discount_rate", "operator": ">", "value": 30}', '{"role": "executive"}'),
('quot_margin_low', 'quotation_margin', '报价毛利率<20%需销售经理审批', '{"field": "gross_margin_rate", "operator": "<", "value": 20}', '{"role": "sales_manager"}'),
('ct_amount_50w', 'contract_amount', '合同金额>50万需管理层审批', '{"field": "amount_tax_inclusive", "operator": ">", "value": 500000}', '{"role": "executive"}'),
('ct_amount_normal', 'contract_amount', '合同金额≤50万销售经理审批', '{"field": "amount_tax_inclusive", "operator": "<=", "value": 500000}', '{"role": "sales_manager"}');

-- ------------------------------------------------------------
-- 5.9 角色数据
-- ------------------------------------------------------------
INSERT INTO role (code, name, description, is_system_role) VALUES
('sales', '销售人员', '查看本人及授权客户/商机数据，录入跟进记录、报价、合同', 1),
('sales_manager', '销售经理', '查看所属团队数据，审批报价和合同，配置阶段与预测规则', 1),
('customer_success', '客户成功', '维护维保合同、SLA、服务工单和续约机会', 1),
('finance', '财务人员', '查看合同、开票、回款与应收数据，登记到账', 1),
('executive', '管理层', '查看全局分析和经营数据，审批重大合同', 1),
('admin', '管理员', '维护基础配置、审批规则、权限和集成参数', 1);

-- ------------------------------------------------------------
-- 5.10 权限数据
-- ------------------------------------------------------------
INSERT INTO permission (resource_code, action_code, description) VALUES
-- 客户权限
('customer', 'view', '查看客户'),
('customer', 'create', '创建客户'),
('customer', 'edit', '编辑客户'),
('customer', 'approve', '审批客户'),
('customer', 'delete', '删除客户'),
('customer', 'export', '导出客户'),
('customer', 'admin', '管理客户'),
-- 联系人权限
('contact', 'view', '查看联系人'),
('contact', 'create', '创建联系人'),
('contact', 'edit', '编辑联系人'),
('contact', 'delete', '删除联系人'),
-- 线索权限
('lead', 'view', '查看线索'),
('lead', 'create', '创建线索'),
('lead', 'edit', '编辑线索'),
('lead', 'delete', '删除线索'),
('lead', 'assign', '分配线索'),
('lead', 'disqualify', '关闭无效线索'),
('lead', 'convert', '转化线索'),
('lead', 'activity', '记录线索跟进'),
('lead', 'admin', '管理线索'),
-- 商机权限
('opportunity', 'view', '查看商机'),
('opportunity', 'create', '创建商机'),
('opportunity', 'edit', '编辑商机'),
('opportunity', 'delete', '删除商机'),
('opportunity', 'transition', '推进商机阶段'),
('opportunity', 'activity', '记录商机活动'),
('opportunity', 'export', '导出商机'),
('opportunity', 'admin', '管理商机'),
-- 报价权限
('quotation', 'view', '查看报价'),
('quotation', 'create', '创建报价'),
('quotation', 'edit', '编辑报价'),
('quotation', 'delete', '删除报价'),
('quotation', 'approve', '审批报价'),
('quotation', 'send', '发送报价'),
('quotation', 'admin', '管理报价'),
-- 合同权限
('contract', 'view', '查看合同'),
('contract', 'create', '创建合同'),
('contract', 'edit', '编辑合同'),
('contract', 'delete', '删除合同'),
('contract', 'approve', '审批合同'),
('contract', 'finance-summary:sync', '同步合同财务摘要'),
('contract', 'admin', '管理合同'),
-- 回款权限
('receivable', 'view', '查看回款'),
('receivable', 'create', '创建回款计划'),
('receivable', 'edit', '编辑回款计划'),
('receivable', 'confirm', '确认到账'),
('receivable', 'mark-billable', '标记回款可开票'),
('receivable', 'admin', '管理回款'),
-- 维保与服务权限
('maintenance_contract', 'view', '查看维保合同'),
('maintenance_contract', 'create', '创建维保合同'),
('maintenance_contract', 'edit', '编辑维保合同'),
('maintenance_contract', 'delete', '删除维保合同'),
('maintenance_contract', 'admin', '管理维保合同'),
('service_entitlement', 'view', '查看服务权益'),
('service_entitlement', 'create', '创建服务权益'),
('service_entitlement', 'edit', '编辑服务权益'),
('service_entitlement', 'delete', '删除服务权益'),
('service_entitlement', 'admin', '管理服务权益'),
('service_ticket', 'view', '查看服务工单'),
('service_ticket', 'create', '创建服务工单'),
('service_ticket', 'edit', '编辑服务工单'),
('service_ticket', 'close', '关闭服务工单'),
('service_ticket', 'delivery-result:sync', '同步服务工单交付结果'),
('service_ticket', 'delete', '删除服务工单'),
('service_ticket', 'admin', '管理服务工单'),
('renewal_opportunity', 'view', '查看续约机会'),
('renewal_opportunity', 'create', '创建续约机会'),
('renewal_opportunity', 'edit', '编辑续约机会'),
('renewal_opportunity', 'delete', '删除续约机会'),
('renewal_opportunity', 'admin', '管理续约机会'),
-- 发票权限
('invoice', 'view', '查看发票'),
('invoice', 'create', '创建发票'),
('invoice', 'edit', '编辑发票'),
-- 看板权限
('dashboard', 'view', '查看经营看板'),
('dashboard', 'export', '导出经营看板'),
('dashboard', 'view_all', '查看全局看板'),
-- 系统设置权限
('settings', 'view', '查看系统设置'),
('settings', 'edit', '编辑系统设置'),
('settings', 'admin', '管理系统设置'),
-- 应用管理权限
('admin', 'view', '查看系统管理'),
('admin', 'edit', '编辑系统管理'),
('admin', 'admin', '应用管理员'),
-- 角色权限管理
('role', 'view', '查看角色'),
('role', 'edit', '编辑角色'),
('user_role', 'view', '查看用户角色'),
('user_role', 'edit', '编辑用户角色');

-- ------------------------------------------------------------
-- 5.11 角色权限关联数据
-- ------------------------------------------------------------
-- 销售人员权限
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code = 'sales' AND (
    (p.resource_code = 'customer' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'contact' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'lead' AND p.action_code IN ('view', 'create', 'edit', 'assign', 'disqualify', 'convert', 'activity'))
    OR (p.resource_code = 'opportunity' AND p.action_code IN ('view', 'create', 'edit', 'transition', 'activity'))
    OR (p.resource_code = 'quotation' AND p.action_code IN ('view', 'create', 'edit', 'send'))
    OR (p.resource_code = 'contract' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'receivable' AND p.action_code IN ('view'))
    OR (p.resource_code = 'invoice' AND p.action_code IN ('view', 'create'))
    OR (p.resource_code = 'dashboard' AND p.action_code IN ('view'))
);

-- 销售经理权限（销售权限 + 审批 + 分配 + 导出）
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code = 'sales_manager' AND (
    (p.resource_code = 'customer' AND p.action_code IN ('view', 'create', 'edit', 'approve', 'delete', 'export'))
    OR (p.resource_code = 'contact' AND p.action_code IN ('view', 'create', 'edit', 'delete'))
    OR (p.resource_code = 'lead' AND p.action_code IN ('view', 'create', 'edit', 'delete', 'assign', 'disqualify', 'convert', 'activity'))
    OR (p.resource_code = 'opportunity' AND p.action_code IN ('view', 'create', 'edit', 'delete', 'transition', 'activity', 'export'))
    OR (p.resource_code = 'quotation' AND p.action_code IN ('view', 'create', 'edit', 'delete', 'approve', 'send'))
    OR (p.resource_code = 'contract' AND p.action_code IN ('view', 'create', 'edit', 'delete', 'approve'))
    OR (p.resource_code = 'receivable' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'invoice' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'dashboard' AND p.action_code IN ('view', 'export', 'view_all'))
);

-- 客户成功权限
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code = 'customer_success' AND (
    (p.resource_code = 'customer' AND p.action_code IN ('view'))
    OR (p.resource_code = 'contract' AND p.action_code IN ('view'))
    OR (p.resource_code = 'maintenance_contract' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'service_entitlement' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'service_ticket' AND p.action_code IN ('view', 'create', 'edit', 'close'))
    OR (p.resource_code = 'renewal_opportunity' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'dashboard' AND p.action_code IN ('view'))
);

-- 财务人员权限
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code = 'finance' AND (
    (p.resource_code = 'customer' AND p.action_code IN ('view'))
    OR (p.resource_code = 'contract' AND p.action_code IN ('view'))
    OR (p.resource_code = 'maintenance_contract' AND p.action_code IN ('view'))
    OR (p.resource_code = 'renewal_opportunity' AND p.action_code IN ('view'))
    OR (p.resource_code = 'receivable' AND p.action_code IN ('view', 'create', 'edit', 'confirm'))
    OR (p.resource_code = 'invoice' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'dashboard' AND p.action_code IN ('view'))
);

-- 管理层权限（全部查看 + 关键审批）
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code = 'executive' AND (
    (p.resource_code IN ('customer', 'contact', 'lead', 'opportunity', 'quotation', 'contract', 'receivable', 'invoice', 'maintenance_contract', 'service_entitlement', 'service_ticket', 'renewal_opportunity') AND p.action_code = 'view')
    OR (p.resource_code IN ('customer', 'opportunity') AND p.action_code = 'export')
    OR (p.resource_code IN ('customer', 'quotation', 'contract') AND p.action_code = 'approve')
    OR (p.resource_code = 'dashboard' AND p.action_code IN ('view', 'export', 'view_all'))
);

-- 管理员权限（全部）
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id FROM role r, permission p
WHERE r.code = 'admin';

-- ------------------------------------------------------------
-- 5.12 产品/服务目录种子数据
-- ------------------------------------------------------------
INSERT INTO product (code, name, product_type, specification, unit, standard_price, cost_price, tax_rate) VALUES
('PROD-SW-001', '政务协同办公平台', 'software', '标准版，含OA+公文+会议', '套', 380000.00, 150000.00, 6.00),
('PROD-SW-002', '数据中台基础版', 'software', '数据采集+治理+可视化', '套', 580000.00, 230000.00, 6.00),
('PROD-SW-003', '智慧园区管理系统', 'software', '含安防+能耗+访客管理', '套', 450000.00, 180000.00, 6.00),
('PROD-SVC-001', '系统集成服务', 'implementation', '含需求分析+开发+部署+培训', '人天', 2500.00, 1200.00, 6.00),
('PROD-SVC-002', '项目管理咨询', 'service', 'PMO咨询服务', '人天', 3000.00, 1500.00, 6.00),
('PROD-SVC-003', '数据迁移服务', 'service', '含数据清洗+迁移+校验', '人天', 2800.00, 1400.00, 6.00),
('PROD-MT-001', '标准运维服务(年)', 'maintenance', '7x24小时远程+5x8现场', '年', 120000.00, 48000.00, 6.00),
('PROD-MT-002', '高级运维服务(年)', 'maintenance', '7x24小时远程+7x24现场', '年', 240000.00, 96000.00, 6.00),
('PROD-HW-001', '服务器(标准配置)', 'hardware', '2路CPU/128GB内存/4TB SAS', '台', 85000.00, 62000.00, 13.00),
('PROD-HW-002', '交换机(万兆)', 'hardware', '48口万兆+4口40G上行', '台', 35000.00, 25000.00, 13.00);

-- ------------------------------------------------------------
-- 5.13 销售团队种子数据
-- ------------------------------------------------------------
INSERT INTO sales_team (code, name, team_type, parent_id, description) VALUES
('TEAM-SALES', '销售部', 'sales', NULL, '销售部门总团队'),
('TEAM-SALES-01', '华东销售组', 'sales', 1, '华东区域销售团队'),
('TEAM-SALES-02', '华南销售组', 'sales', 1, '华南区域销售团队'),
('TEAM-BIZ', '商务部', 'business', NULL, '商务与招投标团队'),
('TEAM-PRESALES', '售前支持部', 'presales', NULL, '售前方案与技术支持团队');

-- ------------------------------------------------------------
-- 5.13 业务种子数据（客户、联系人、线索、商机等）
-- ------------------------------------------------------------

-- 客户
INSERT INTO customer (code, name, short_name, customer_type_id, industry_code, region_code, customer_level_id, source_type, status, owner_user_id, address, description) VALUES
('CU-20260300001', '深圳市智慧城市发展有限公司', '深圳智城', 4, NULL, NULL, 1, 'marketing', 'active', 'zhouguangying', '深圳市南山区科技园', '深圳市重点智慧城市建设企业'),
('CU-20260300002', '杭州数字政务科技集团', '杭州数政', 2, NULL, NULL, 1, 'referral', 'active', 'zhouguangying', '杭州市西湖区文三路', '浙江省政务信息化龙头企业'),
('CU-20260300003', '北京中科信息技术有限公司', '中科信息', 1, NULL, NULL, 2, 'visit', 'active', 'zhouguangying', '北京市海淀区中关村', '中科院系软件与解决方案提供商'),
('CU-20260300004', '上海金融数据服务中心', '上海金数', 3, NULL, NULL, 2, 'tender', 'active', 'zhouguangying', '上海市浦东新区陆家嘴', '上海市金融信息化公共服务平台'),
('CU-20260300005', '成都天府软件园管理有限公司', '天府软件园', 4, NULL, NULL, 3, 'partner', 'active', 'zhouguangying', '成都市高新区天府大道', '西南地区最大的软件产业园区'),
('CU-20260300006', '广州教育信息化研究院', '广州教研院', 3, NULL, NULL, 3, 'website', 'active', 'zhouguangying', '广州市天河区华师路', '广东省教育信息化研究与推广机构'),
('CU-20260300007', '武汉光谷网络安全产业集团', '光谷安全', 1, NULL, NULL, 2, 'marketing', 'active', 'zhouguangying', '武汉市东湖新区光谷大道', '华中地区网络安全领军企业'),
('CU-20260300008', '济南政务云计算有限公司', '济南政务云', 2, NULL, NULL, 4, 'referral', 'active', 'zhouguangying', '济南市历下区泉城路', '山东省政务云基础设施运营商');

-- 联系人
INSERT INTO contact (customer_id, name, gender, dept_name, job_title, mobile, email, decision_role, influence_level, is_key_contact, status, owner_user_id) VALUES
(1, '王建国', 1, '信息中心', '主任', '13800001001', 'wangjg@szcity.com', 'decision_maker', 'high', 1, 'active', 'zhouguangying'),
(1, '李芳', 2, '采购部', '经理', '13800001002', 'lifang@szcity.com', 'purchaser', 'medium', 0, 'active', 'zhouguangying'),
(2, '赵明远', 1, '数字政府处', '处长', '13800002001', 'zhaomy@hzgov.cn', 'decision_maker', 'high', 1, 'active', 'zhouguangying'),
(2, '钱学敏', 2, '项目管理办', '副主任', '13800002002', 'qianxm@hzgov.cn', 'tech_influencer', 'medium', 0, 'active', 'zhouguangying'),
(3, '孙伟', 1, '技术部', '总监', '13800003001', 'sunwei@zkinfo.cn', 'tech_influencer', 'high', 1, 'active', 'zhouguangying'),
(4, '周丽华', 2, '信息技术部', '副总经理', '13800004001', 'zhoulh@shfindata.com', 'decision_maker', 'high', 1, 'active', 'zhouguangying'),
(5, '吴强', 1, '招商运营部', '总监', '13800005001', 'wuqiang@tfpark.com', 'user', 'medium', 1, 'active', 'zhouguangying'),
(6, '郑晓彤', 2, '研究室', '副院长', '13800006001', 'zhengxt@gzedu.org', 'decision_maker', 'high', 1, 'active', 'zhouguangying'),
(7, '陈刚', 1, '产品部', '副总裁', '13800007001', 'chengang@ggsec.com', 'decision_maker', 'high', 1, 'active', 'zhouguangying'),
(8, '黄志远', 1, '云计算中心', '主任', '13800008001', 'huangzy@jngov.cn', 'tech_influencer', 'medium', 1, 'active', 'zhouguangying');

-- 线索
INSERT INTO `lead` (code, name, org_name, source_type, source_detail, contact_name, contact_mobile, contact_email, status, owner_user_id, score) VALUES
('LE-20260300001', '南京市智慧交通项目', '南京市交通局', 'tender', '中国政府采购网', '刘主任', '13900001001', 'liu@njtrans.gov.cn', 'new', 'zhouguangying', 75),
('LE-20260300002', '苏州工业园数据中台需求', '苏州工业园管委会', 'referral', '老客户天府软件园推荐', '张科长', '13900001002', 'zhang@sipac.gov.cn', 'following', 'zhouguangying', 82),
('LE-20260300003', '青岛港口物联网平台', '青岛港集团', 'marketing', '2026年数字中国峰会', '马经理', '13900001003', 'ma@qdport.com', 'following', 'zhouguangying', 68),
('LE-20260300004', '长沙医疗健康大数据项目', '长沙市卫健委', 'website', '官网表单提交', '何处长', '13900001004', 'he@cshealth.gov.cn', 'new', 'zhouguangying', 60),
('LE-20260300005', '西安文旅数字化转型', '西安市文旅局', 'visit', '西安出差主动拜访', '秦副局长', '13900001005', 'qin@xatour.gov.cn', 'pending_assign', 'zhouguangying', 55);

-- 商机
INSERT INTO opportunity (code, name, customer_id, stage_id, forecast_category, status, amount_tax_inclusive, amount_tax_exclusive, expected_sign_date, expected_payment_date, win_rate, owner_user_id, next_action, competitor_info) VALUES
('OP-20260300001', '深圳智慧城市运营平台一期', 1, 3, 'best_case', 'active', 3800000.00, 3584905.66, '2026-06-30', '2026-09-30', 50.00, 'zhouguangying', '本周五提交技术方案', '华为、中兴通讯'),
('OP-20260300002', '杭州数字政府一网通办平台', 2, 4, 'commit', 'active', 5800000.00, 5471698.11, '2026-05-15', '2026-08-15', 70.00, 'zhouguangying', '下周一商务谈判', '浙大网新、新华三'),
('OP-20260300003', '中科院数据治理平台升级', 3, 2, 'pipeline', 'active', 1500000.00, 1415094.34, '2026-08-30', '2026-12-31', 25.00, 'zhouguangying', '等待客户确认需求文档', '东软、神州数码'),
('OP-20260300004', '上海金融数据安全合规平台', 4, 3, 'best_case', 'active', 4200000.00, 3962264.15, '2026-07-31', '2026-10-31', 50.00, 'zhouguangying', '准备POC演示环境', '启明星辰、绿盟科技'),
('OP-20260300005', '天府软件园智慧园区二期', 5, 5, 'commit', 'active', 2200000.00, 2075471.70, '2026-04-30', '2026-06-30', 90.00, 'zhouguangying', '合同条款最终确认', '无主要竞争'),
('OP-20260300006', '广州教育信息化3.0试点', 6, 1, 'pipeline', 'active', 800000.00, 754716.98, '2026-10-31', '2027-01-31', 10.00, 'zhouguangying', '本月约客户初步交流', '科大讯飞、好未来'),
('OP-20260300007', '光谷安全态势感知平台', 7, 4, 'commit', 'active', 6500000.00, 6132075.47, '2026-05-31', '2026-09-30', 70.00, 'zhouguangying', '等待招标公告', '奇安信、深信服');

-- 销售活动
INSERT INTO sales_activity (code, activity_type, subject, customer_id, opportunity_id, activity_at, content, result_summary, next_action, next_action_due_at, owner_user_id, status) VALUES
('SA-20260300001', 'visit', '深圳智城需求调研', 1, 1, '2026-03-10 14:00:00', '与王主任团队沟通智慧城市运营平台需求，确认了数据中台、IOC指挥中心、城市治理三大模块方向', '客户对方案框架基本认可，需要细化技术方案', '准备技术方案PPT', '2026-03-22', 'zhouguangying', 'active'),
('SA-20260300002', 'demo', '杭州数政方案演示', 2, 2, '2026-03-15 10:00:00', '向赵处长团队演示了一网通办平台Demo，重点展示了政务服务、数据共享、智能审批等功能', '客户非常满意，提出进入商务谈判阶段', '准备商务报价方案', '2026-03-20', 'zhouguangying', 'active'),
('SA-20260300003', 'call', '中科信息需求跟进', 3, 3, '2026-03-18 16:00:00', '电话与孙总监确认数据治理平台升级需求范围，客户希望增加数据质量监控和数据血缘分析模块', '需求范围基本确认，客户内部在走立项流程', '等待客户立项结果', '2026-04-05', 'zhouguangying', 'active'),
('SA-20260300004', 'meeting', '上海金数POC准备会', 4, 4, '2026-03-20 09:30:00', '内部POC准备会议，确认测试数据、演示场景和环境部署方案', 'POC环境下周一部署完成', '部署POC环境', '2026-03-25', 'zhouguangying', 'active'),
('SA-20260300005', 'meeting', '天府软件园合同评审', 5, 5, '2026-03-21 15:00:00', '内部合同评审会，确认合同条款、付款节点和交付计划', '合同条款已确认，等客户最终签字', '发送合同给客户签署', '2026-03-25', 'zhouguangying', 'active');

-- 招标代理机构
INSERT INTO tender_agency (name, agency_type, address, contact_name, contact_phone, contact_email) VALUES
('深圳市政府采购中心', 'government', '深圳市福田区福中三路', '林小姐', '0755-82108888', 'procurement@szgov.cn'),
('浙江省招标中心', 'government', '杭州市西湖区教工路', '王先生', '0571-87654321', 'bid@zjztb.com'),
('中招国际招标有限公司', 'third_party', '北京市海淀区车公庄西路', '张经理', '010-68585858', 'zhang@cntc.com.cn'),
('广东省机电设备招标中心', 'government', '广州市越秀区东风中路', '陈先生', '020-83549876', 'chen@gdjd.gov.cn');

-- ============================================================
-- 脚本结束
-- ============================================================
