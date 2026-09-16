-- ============================================================
-- Migration 002: wizbizdb 营销数据迁移兼容字段
-- ============================================================
USE hzy_altoc;

-- 背景：
--   源库 wizbizdb 的营销数据包含客户上下级组织、源系统主键、合同挂接项目/系统/联系人、
--   发票和到账记录的源业务编码等信息。Altoc 主模型已覆盖核心业务对象，但缺少可追溯字段。
--   本迁移只做结构增补，不执行数据搬迁。

ALTER TABLE customer
  ADD COLUMN telephone VARCHAR(30) DEFAULT NULL COMMENT '联系电话' AFTER website,
  ADD COLUMN province VARCHAR(50) DEFAULT NULL COMMENT '省/直辖市' AFTER telephone,
  ADD COLUMN city VARCHAR(50) DEFAULT NULL COMMENT '地市' AFTER province,
  ADD COLUMN wechat_official_account VARCHAR(100) DEFAULT NULL COMMENT '微信公众号' AFTER city,
  ADD COLUMN started_at DATE DEFAULT NULL COMMENT '源系统起始日期' AFTER wechat_official_account,
  ADD COLUMN parent_customer_id BIGINT DEFAULT NULL COMMENT '上级客户ID' AFTER started_at,
  ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统' AFTER last_follow_up_at,
  ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键' AFTER legacy_source,
  ADD COLUMN legacy_stats_json JSON DEFAULT NULL COMMENT '源系统历史统计快照' AFTER legacy_id,
  ADD INDEX idx_parent_customer_id (parent_customer_id),
  ADD UNIQUE KEY uk_customer_legacy (legacy_source, legacy_id);

ALTER TABLE contact
  ADD COLUMN alternate_mobile VARCHAR(30) DEFAULT NULL COMMENT '备用手机号' AFTER mobile,
  ADD COLUMN mailing_address VARCHAR(500) DEFAULT NULL COMMENT '快递/联系地址' AFTER wechat,
  ADD COLUMN star_level INT DEFAULT NULL COMMENT '源系统星级编码' AFTER mailing_address,
  ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统' AFTER owner_user_id,
  ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键' AFTER legacy_source,
  ADD UNIQUE KEY uk_contact_legacy (legacy_source, legacy_id);

ALTER TABLE product
  ADD COLUMN parent_product_id BIGINT DEFAULT NULL COMMENT '上级产品ID' AFTER product_type,
  ADD COLUMN started_at DATE DEFAULT NULL COMMENT '源系统启动日期' AFTER status,
  ADD COLUMN completeness INT DEFAULT NULL COMMENT '源系统完成度' AFTER started_at,
  ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统' AFTER completeness,
  ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键' AFTER legacy_source,
  ADD COLUMN legacy_refs_json JSON DEFAULT NULL COMMENT '源系统归口部门/产品经理/解决方案等引用' AFTER legacy_id,
  ADD UNIQUE KEY uk_product_legacy (legacy_source, legacy_id),
  ADD INDEX idx_parent_product_id (parent_product_id);

ALTER TABLE contract
  ADD COLUMN contact_id BIGINT DEFAULT NULL COMMENT '客户联系人ID' AFTER customer_id,
  ADD COLUMN parent_contract_id BIGINT DEFAULT NULL COMMENT '父合同ID' AFTER contact_id,
  ADD COLUMN prime_amount DECIMAL(18,2) DEFAULT NULL COMMENT '源系统有效金额' AFTER amount_tax_exclusive,
  ADD COLUMN invoiced_amount DECIMAL(18,2) DEFAULT NULL COMMENT '源系统已开票金额' AFTER prime_amount,
  ADD COLUMN executed_amount DECIMAL(18,2) DEFAULT NULL COMMENT '源系统已执行/已回款金额' AFTER invoiced_amount,
  ADD COLUMN source_contract_type VARCHAR(20) DEFAULT NULL COMMENT '源系统合同类型编码' AFTER retention_rate,
  ADD COLUMN is_third_party TINYINT DEFAULT 0 COMMENT '是否三方合同：1是 0否' AFTER source_contract_type,
  ADD COLUMN third_party_customer_id BIGINT DEFAULT NULL COMMENT '第三方客户ID' AFTER is_third_party,
  ADD COLUMN service_period_months INT DEFAULT NULL COMMENT '服务周期(月)' AFTER third_party_customer_id,
  ADD COLUMN contract_period_months INT DEFAULT NULL COMMENT '合同周期(月)' AFTER service_period_months,
  ADD COLUMN content_summary VARCHAR(1000) DEFAULT NULL COMMENT '源系统主要内容' AFTER contract_period_months,
  ADD COLUMN service_terms VARCHAR(1000) DEFAULT NULL COMMENT '源系统服务条款' AFTER content_summary,
  ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统' AFTER version_no,
  ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键' AFTER legacy_source,
  ADD COLUMN legacy_refs_json JSON DEFAULT NULL COMMENT '源系统项目/公司/银行账户/系统等引用' AFTER legacy_id,
  ADD UNIQUE KEY uk_contract_legacy (legacy_source, legacy_id),
  ADD INDEX idx_contact_id (contact_id),
  ADD INDEX idx_parent_contract_id (parent_contract_id),
  ADD CONSTRAINT fk_ct_contact FOREIGN KEY (contact_id) REFERENCES contact(id);

ALTER TABLE invoice
  ADD COLUMN receiver_name VARCHAR(200) DEFAULT NULL COMMENT '源系统接收方' AFTER status,
  ADD COLUMN invoice_item VARCHAR(500) DEFAULT NULL COMMENT '源系统开票内容' AFTER receiver_name,
  ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统' AFTER taxpayer_no,
  ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键' AFTER legacy_source,
  ADD COLUMN legacy_refs_json JSON DEFAULT NULL COMMENT '源系统项目/公司/档案页/旧合同等引用' AFTER legacy_id,
  ADD UNIQUE KEY uk_invoice_legacy (legacy_source, legacy_id);

ALTER TABLE payment_record
  ADD COLUMN source_income_type VARCHAR(20) DEFAULT NULL COMMENT '源系统收入类型编码' AFTER bank_account,
  ADD COLUMN channel VARCHAR(20) DEFAULT NULL COMMENT '源系统收款渠道编码' AFTER source_income_type,
  ADD COLUMN handler_user_id VARCHAR(50) DEFAULT NULL COMMENT '源系统经办人' AFTER channel,
  ADD COLUMN legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统' AFTER handler_user_id,
  ADD COLUMN legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键' AFTER legacy_source,
  ADD COLUMN legacy_refs_json JSON DEFAULT NULL COMMENT '源系统项目/账户/对应支出等引用' AFTER legacy_id,
  ADD UNIQUE KEY uk_payment_legacy (legacy_source, legacy_id);

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
