-- ============================================================
-- Migration 008: Phase 4 service operations and customer success
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.

CREATE TABLE IF NOT EXISTS maintenance_contract (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(30) NOT NULL COMMENT '维保合同编号(MC-xxxxxx)',
  customer_id BIGINT NOT NULL COMMENT '客户ID',
  contract_id BIGINT DEFAULT NULL COMMENT '原合同ID',
  opportunity_id BIGINT DEFAULT NULL COMMENT '来源商机ID',
  delivery_code VARCHAR(64) DEFAULT NULL COMMENT 'Assets交付视图编号',
  project_code VARCHAR(64) DEFAULT NULL COMMENT 'Aims项目编号',
  product_code VARCHAR(64) DEFAULT NULL COMMENT '产品编号',
  product_version VARCHAR(64) DEFAULT NULL COMMENT '产品版本',
  name VARCHAR(200) NOT NULL COMMENT '维保合同名称',
  service_level VARCHAR(30) DEFAULT 'standard' COMMENT '服务级别：standard/premium/custom',
  service_start_date DATE NOT NULL COMMENT '服务开始日期',
  service_end_date DATE NOT NULL COMMENT '服务结束日期',
  amount DECIMAL(18,2) DEFAULT 0.00 COMMENT '维保金额',
  currency_code VARCHAR(10) DEFAULT 'CNY' COMMENT '币种',
  status VARCHAR(30) DEFAULT 'active' COMMENT '状态：draft/active/expiring/expired/terminated',
  owner_user_id VARCHAR(50) DEFAULT NULL COMMENT '客户成功负责人',
  renewal_remind_at DATE DEFAULT NULL COMMENT '续约提醒日期',
  source_app VARCHAR(50) DEFAULT NULL COMMENT '来源应用',
  source_biz_type VARCHAR(50) DEFAULT NULL COMMENT '来源业务类型',
  source_biz_id VARCHAR(100) DEFAULT NULL COMMENT '来源业务ID',
  remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
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

CREATE TABLE IF NOT EXISTS service_entitlement (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(30) NOT NULL COMMENT '服务权益编号(SE-xxxxxx)',
  maintenance_contract_id BIGINT NOT NULL COMMENT '维保合同ID',
  entitlement_type VARCHAR(30) DEFAULT 'sla' COMMENT '权益类型：sla/quota/onsite/remote',
  name VARCHAR(120) NOT NULL COMMENT '权益名称',
  service_window VARCHAR(50) DEFAULT '5x8' COMMENT '服务窗口：5x8/7x24/custom',
  priority VARCHAR(20) DEFAULT 'normal' COMMENT '适用优先级：low/normal/high/urgent',
  response_minutes INT DEFAULT NULL COMMENT '响应时限(分钟)',
  resolution_minutes INT DEFAULT NULL COMMENT '解决时限(分钟)',
  included_quota DECIMAL(10,2) DEFAULT NULL COMMENT '包含额度',
  quota_unit VARCHAR(30) DEFAULT NULL COMMENT '额度单位：hour/ticket/day',
  billing_mode VARCHAR(30) DEFAULT 'included' COMMENT '计费方式：included/billable/overage',
  status VARCHAR(20) DEFAULT 'active' COMMENT '状态：active/inactive',
  remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY uk_code (code),
  INDEX idx_contract_id (maintenance_contract_id),
  INDEX idx_entitlement_type (entitlement_type),
  INDEX idx_priority (priority),
  INDEX idx_status (status),
  CONSTRAINT fk_se_maintenance_contract FOREIGN KEY (maintenance_contract_id) REFERENCES maintenance_contract(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务权益/SLA表';

CREATE TABLE IF NOT EXISTS service_ticket (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(30) NOT NULL COMMENT '服务工单编号(ST-xxxxxx)',
  customer_id BIGINT NOT NULL COMMENT '客户ID',
  maintenance_contract_id BIGINT DEFAULT NULL COMMENT '维保合同ID',
  contract_id BIGINT DEFAULT NULL COMMENT '合同ID',
  delivery_code VARCHAR(64) DEFAULT NULL COMMENT 'Assets交付视图编号',
  project_code VARCHAR(64) DEFAULT NULL COMMENT 'Aims项目编号',
  product_code VARCHAR(64) DEFAULT NULL COMMENT '产品编号',
  product_version VARCHAR(64) DEFAULT NULL COMMENT '产品版本',
  environment_code VARCHAR(64) DEFAULT NULL COMMENT '环境编号',
  ticket_type VARCHAR(30) NOT NULL COMMENT '类型：incident/consulting/requirement/change',
  title VARCHAR(200) NOT NULL COMMENT '标题',
  description TEXT DEFAULT NULL COMMENT '描述',
  priority VARCHAR(20) DEFAULT 'normal' COMMENT '优先级：low/normal/high/urgent',
  status VARCHAR(30) DEFAULT 'open' COMMENT '状态：open/accepted/processing/waiting_customer/resolved/closed/cancelled',
  sla_status VARCHAR(30) DEFAULT 'not_started' COMMENT 'SLA状态：not_started/on_track/warning/breached/met',
  reported_by_contact VARCHAR(100) DEFAULT NULL COMMENT '报障联系人',
  reported_by_phone VARCHAR(50) DEFAULT NULL COMMENT '联系电话',
  reported_by_email VARCHAR(100) DEFAULT NULL COMMENT '联系邮箱',
  owner_user_id VARCHAR(50) DEFAULT NULL COMMENT '客户成功负责人',
  handler_user_id VARCHAR(50) DEFAULT NULL COMMENT '当前处理人',
  response_due_at DATETIME DEFAULT NULL COMMENT '响应截止时间',
  resolution_due_at DATETIME DEFAULT NULL COMMENT '解决截止时间',
  first_responded_at DATETIME DEFAULT NULL COMMENT '首次响应时间',
  resolved_at DATETIME DEFAULT NULL COMMENT '解决时间',
  closed_at DATETIME DEFAULT NULL COMMENT '关闭时间',
  aims_project_code VARCHAR(64) DEFAULT NULL COMMENT '回流Aims项目编号',
  aims_work_item_key VARCHAR(100) DEFAULT NULL COMMENT '回流Aims工作项键',
  aims_work_item_type VARCHAR(50) DEFAULT NULL COMMENT '回流Aims工作项类型',
  codocs_document_uuid VARCHAR(100) DEFAULT NULL COMMENT '运维知识文档UUID',
  source_app VARCHAR(50) DEFAULT NULL COMMENT '来源应用',
  source_biz_type VARCHAR(50) DEFAULT NULL COMMENT '来源业务类型',
  source_biz_id VARCHAR(100) DEFAULT NULL COMMENT '来源业务ID',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
  UNIQUE KEY uk_code (code),
  INDEX idx_customer_id (customer_id),
  INDEX idx_maintenance_contract_id (maintenance_contract_id),
  INDEX idx_contract_id (contract_id),
  INDEX idx_delivery_code (delivery_code),
  INDEX idx_project_code (project_code),
  INDEX idx_status (status),
  INDEX idx_sla_status (sla_status),
  INDEX idx_priority (priority),
  INDEX idx_aims_work_item_key (aims_work_item_key),
  INDEX idx_deleted_at (deleted_at),
  CONSTRAINT fk_st_customer FOREIGN KEY (customer_id) REFERENCES customer(id),
  CONSTRAINT fk_st_maintenance_contract FOREIGN KEY (maintenance_contract_id) REFERENCES maintenance_contract(id),
  CONSTRAINT fk_st_contract FOREIGN KEY (contract_id) REFERENCES contract(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='服务工单表';

CREATE TABLE IF NOT EXISTS renewal_opportunity (
  id BIGINT PRIMARY KEY AUTO_INCREMENT COMMENT '主键ID',
  code VARCHAR(30) NOT NULL COMMENT '续约机会编号(RO-xxxxxx)',
  customer_id BIGINT NOT NULL COMMENT '客户ID',
  maintenance_contract_id BIGINT DEFAULT NULL COMMENT '维保合同ID',
  contract_id BIGINT DEFAULT NULL COMMENT '合同ID',
  source_ticket_id BIGINT DEFAULT NULL COMMENT '来源服务工单ID',
  opportunity_id BIGINT DEFAULT NULL COMMENT '转化后的Altoc商机ID',
  name VARCHAR(200) NOT NULL COMMENT '续约机会名称',
  renewal_type VARCHAR(30) DEFAULT 'maintenance' COMMENT '类型：maintenance/upsell/cross_sell',
  expected_amount DECIMAL(18,2) DEFAULT NULL COMMENT '预计金额',
  expected_sign_date DATE DEFAULT NULL COMMENT '预计签约日期',
  stage VARCHAR(30) DEFAULT 'identified' COMMENT '阶段：identified/contacted/proposal/negotiation/closed',
  status VARCHAR(30) DEFAULT 'open' COMMENT '状态：open/won/lost/cancelled',
  owner_user_id VARCHAR(50) DEFAULT NULL COMMENT '负责人',
  risk_level VARCHAR(20) DEFAULT NULL COMMENT '风险等级：low/medium/high',
  reason VARCHAR(500) DEFAULT NULL COMMENT '来源原因',
  next_action VARCHAR(500) DEFAULT NULL COMMENT '下一步动作',
  next_action_due_at DATETIME DEFAULT NULL COMMENT '下一步截止时间',
  created_by VARCHAR(50) DEFAULT NULL COMMENT '创建人',
  updated_by VARCHAR(50) DEFAULT NULL COMMENT '更新人',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  deleted_at DATETIME DEFAULT NULL COMMENT '软删除时间',
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

INSERT INTO role (code, name, description, is_system_role)
SELECT 'customer_success', '客户成功', '维护维保合同、SLA、服务工单和续约机会', 1
WHERE NOT EXISTS (SELECT 1 FROM role WHERE code = 'customer_success');

INSERT INTO permission (resource_code, action_code, description)
SELECT 'maintenance_contract', 'view', '查看维保合同'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'maintenance_contract' AND action_code = 'view');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'maintenance_contract', 'create', '创建维保合同'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'maintenance_contract' AND action_code = 'create');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'maintenance_contract', 'edit', '编辑维保合同'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'maintenance_contract' AND action_code = 'edit');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'maintenance_contract', 'delete', '删除维保合同'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'maintenance_contract' AND action_code = 'delete');

INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_entitlement', 'view', '查看服务权益'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_entitlement' AND action_code = 'view');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_entitlement', 'create', '创建服务权益'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_entitlement' AND action_code = 'create');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_entitlement', 'edit', '编辑服务权益'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_entitlement' AND action_code = 'edit');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_entitlement', 'delete', '删除服务权益'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_entitlement' AND action_code = 'delete');

INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_ticket', 'view', '查看服务工单'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_ticket' AND action_code = 'view');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_ticket', 'create', '创建服务工单'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_ticket' AND action_code = 'create');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_ticket', 'edit', '编辑服务工单'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_ticket' AND action_code = 'edit');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_ticket', 'close', '关闭服务工单'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_ticket' AND action_code = 'close');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'service_ticket', 'delete', '删除服务工单'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'service_ticket' AND action_code = 'delete');

INSERT INTO permission (resource_code, action_code, description)
SELECT 'renewal_opportunity', 'view', '查看续约机会'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'renewal_opportunity' AND action_code = 'view');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'renewal_opportunity', 'create', '创建续约机会'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'renewal_opportunity' AND action_code = 'create');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'renewal_opportunity', 'edit', '编辑续约机会'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'renewal_opportunity' AND action_code = 'edit');
INSERT INTO permission (resource_code, action_code, description)
SELECT 'renewal_opportunity', 'delete', '删除续约机会'
WHERE NOT EXISTS (SELECT 1 FROM permission WHERE resource_code = 'renewal_opportunity' AND action_code = 'delete');

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'customer_success'
  AND (
    (p.resource_code = 'customer' AND p.action_code IN ('view'))
    OR (p.resource_code = 'contract' AND p.action_code IN ('view'))
    OR (p.resource_code = 'maintenance_contract' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'service_entitlement' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'service_ticket' AND p.action_code IN ('view', 'create', 'edit', 'close'))
    OR (p.resource_code = 'renewal_opportunity' AND p.action_code IN ('view', 'create', 'edit'))
    OR (p.resource_code = 'dashboard' AND p.action_code IN ('view'))
  );

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'finance'
  AND (
    (p.resource_code = 'maintenance_contract' AND p.action_code = 'view')
    OR (p.resource_code = 'renewal_opportunity' AND p.action_code = 'view')
  );

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'executive'
  AND p.resource_code IN ('maintenance_contract', 'service_entitlement', 'service_ticket', 'renewal_opportunity')
  AND p.action_code = 'view';
