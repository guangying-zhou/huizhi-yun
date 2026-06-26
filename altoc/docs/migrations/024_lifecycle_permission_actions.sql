-- ============================================================
-- Migration 024: lifecycle command permission actions
-- ============================================================
-- Run in hzy_altoc or the target Altoc tenant database.
--
-- Keeps legacy in-app permission seeds aligned with the executable
-- tenant-runtime capability model and app.manifest.json.

INSERT IGNORE INTO permission (resource_code, action_code, description) VALUES
  ('dashboard', 'export', '导出经营看板'),
  ('customer', 'approve', '审批客户'),
  ('customer', 'admin', '管理客户'),
  ('lead', 'assign', '分配线索'),
  ('lead', 'disqualify', '关闭无效线索'),
  ('lead', 'convert', '转化线索'),
  ('lead', 'activity', '记录线索跟进'),
  ('lead', 'admin', '管理线索'),
  ('opportunity', 'transition', '推进商机阶段'),
  ('opportunity', 'activity', '记录商机活动'),
  ('opportunity', 'admin', '管理商机'),
  ('quotation', 'admin', '管理报价'),
  ('contract', 'finance-summary:sync', '同步合同财务摘要'),
  ('contract', 'admin', '管理合同'),
  ('receivable', 'mark-billable', '标记回款可开票'),
  ('receivable', 'admin', '管理回款'),
  ('maintenance_contract', 'admin', '管理维保合同'),
  ('service_entitlement', 'admin', '管理服务权益'),
  ('service_ticket', 'delivery-result:sync', '同步服务工单交付结果'),
  ('service_ticket', 'admin', '管理服务工单'),
  ('renewal_opportunity', 'admin', '管理续约机会'),
  ('settings', 'admin', '管理系统设置'),
  ('admin', 'view', '查看系统管理'),
  ('admin', 'edit', '编辑系统管理'),
  ('admin', 'admin', '应用管理员');

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'sales'
  AND (
    (p.resource_code = 'lead' AND p.action_code IN ('assign', 'disqualify', 'convert', 'activity'))
    OR (p.resource_code = 'opportunity' AND p.action_code IN ('transition', 'activity'))
  );

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'sales_manager'
  AND (
    (p.resource_code = 'customer' AND p.action_code = 'approve')
    OR (p.resource_code = 'lead' AND p.action_code IN ('assign', 'disqualify', 'convert', 'activity'))
    OR (p.resource_code = 'opportunity' AND p.action_code IN ('transition', 'activity'))
    OR (p.resource_code = 'dashboard' AND p.action_code = 'export')
  );

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'executive'
  AND (
    (p.resource_code = 'customer' AND p.action_code = 'approve')
    OR (p.resource_code = 'dashboard' AND p.action_code = 'export')
  );

INSERT IGNORE INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r, permission p
WHERE r.code = 'admin'
  AND (
    (p.resource_code IN (
      'dashboard',
      'customer',
      'lead',
      'opportunity',
      'quotation',
      'contract',
      'receivable',
      'maintenance_contract',
      'service_entitlement',
      'service_ticket',
      'renewal_opportunity',
      'settings',
      'admin'
    ))
  );
