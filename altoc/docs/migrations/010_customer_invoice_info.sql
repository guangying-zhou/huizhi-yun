-- ============================================================
-- Migration 010: Customer invoice billing information
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

CREATE TABLE IF NOT EXISTS customer_invoice_info (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  customer_id BIGINT NOT NULL COMMENT '所属客户ID',
  taxpayer_name VARCHAR(200) DEFAULT NULL COMMENT '发票抬头/购方名称',
  taxpayer_no VARCHAR(50) DEFAULT NULL COMMENT '纳税人识别号/统一社会信用代码',
  registered_address VARCHAR(500) DEFAULT NULL COMMENT '注册地址',
  registered_phone VARCHAR(50) DEFAULT NULL COMMENT '注册电话',
  bank_name VARCHAR(200) DEFAULT NULL COMMENT '开户行',
  bank_account VARCHAR(100) DEFAULT NULL COMMENT '银行账号',
  invoice_type VARCHAR(30) DEFAULT 'special_vat' COMMENT '默认发票类型：special_vat/general_vat/electronic',
  invoice_email VARCHAR(100) DEFAULT NULL COMMENT '收票邮箱',
  receiver_name VARCHAR(100) DEFAULT NULL COMMENT '收票人',
  receiver_phone VARCHAR(50) DEFAULT NULL COMMENT '收票电话',
  receiver_address VARCHAR(500) DEFAULT NULL COMMENT '收票地址',
  is_default TINYINT DEFAULT 1 COMMENT '是否默认开票信息：1是 0否',
  status VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
  legacy_source VARCHAR(50) DEFAULT NULL COMMENT '迁移来源系统',
  legacy_id BIGINT DEFAULT NULL COMMENT '迁移来源主键',
  remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_customer_invoice_info_customer (customer_id),
  UNIQUE KEY uk_customer_invoice_info_legacy (legacy_source, legacy_id),
  INDEX idx_taxpayer_no (taxpayer_no),
  INDEX idx_status (status),
  INDEX idx_deleted_at (deleted_at),
  CONSTRAINT fk_customer_invoice_info_customer FOREIGN KEY (customer_id) REFERENCES customer(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='客户开票信息表';
