-- Console SQL Seed v1.61: Finance tenant-runtime transport grants.
-- Date: 2026-07-13
--
-- Finance uses route-specific read scopes plus a small set of mutation and
-- orchestration scopes. Install both supported runtime audience prefixes.

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `service_client_grants` (
  `service_client_id`,
  `resource_code`,
  `action`,
  `scope_json`,
  `status`,
  `created_at`,
  `updated_at`
)
SELECT
  sc.`id`,
  LEFT(
    CONCAT(audiences.`audience`, ':', scopes.`token_suffix`),
    LENGTH(CONCAT(audiences.`audience`, ':', scopes.`token_suffix`))
      - LENGTH(SUBSTRING_INDEX(CONCAT(audiences.`audience`, ':', scopes.`token_suffix`), ':', -1)) - 1
  ) AS `resource_code`,
  SUBSTRING_INDEX(CONCAT(audiences.`audience`, ':', scopes.`token_suffix`), ':', -1) AS `action`,
  JSON_OBJECT(
    'source', 'seed:v1.61',
    'semanticScope', scopes.`semantic_scope`,
    'purpose', 'finance-tenant-runtime'
  ),
  'active',
  UTC_TIMESTAMP(),
  UTC_TIMESTAMP()
FROM `service_clients` sc
CROSS JOIN (
  SELECT 'data-runtime' AS `audience`
  UNION ALL SELECT 'tenant-runtime'
) audiences
CROSS JOIN (
  SELECT 'finance:accounting_objects.read' AS `token_suffix`, 'finance.accounting_objects.read' AS `semantic_scope`
  UNION ALL SELECT 'finance:audit_logs.read', 'finance.audit_logs.read'
  UNION ALL SELECT 'finance:bank_accounts.read', 'finance.bank_accounts.read'
  UNION ALL SELECT 'finance:contracts.read', 'finance.contracts.read'
  UNION ALL SELECT 'finance:dashboard.read', 'finance.dashboard.read'
  UNION ALL SELECT 'finance:employee_contributions.read', 'finance.employee_contributions.read'
  UNION ALL SELECT 'finance:employee_costs.read', 'finance.employee_costs.read'
  UNION ALL SELECT 'finance:expense_claims.read', 'finance.expense_claims.read'
  UNION ALL SELECT 'finance:expenses.read', 'finance.expenses.read'
  UNION ALL SELECT 'finance:approval_instances.read', 'finance.approval_instances.read'
  UNION ALL SELECT 'finance:invoice_requests.read', 'finance.invoice_requests.read'
  UNION ALL SELECT 'finance:invoices.read', 'finance.invoices.read'
  UNION ALL SELECT 'finance:migrations.read', 'finance.migrations.read'
  UNION ALL SELECT 'finance:payment_requests.read', 'finance.payment_requests.read'
  UNION ALL SELECT 'finance:performance.read', 'finance.performance.read'
  UNION ALL SELECT 'finance:performance_rules.read', 'finance.performance_rules.read'
  UNION ALL SELECT 'finance:performance_snapshots.read', 'finance.performance_snapshots.read'
  UNION ALL SELECT 'finance:project_accounting.read', 'finance.project_accounting.read'
  UNION ALL SELECT 'finance:project_cost_allocations.read', 'finance.project_cost_allocations.read'
  UNION ALL SELECT 'finance:project_expense_requests.read', 'finance.project_expense_requests.read'
  UNION ALL SELECT 'finance:receipts.read', 'finance.receipts.read'
  UNION ALL SELECT 'finance:reconciliation.read', 'finance.reconciliation.read'
  UNION ALL SELECT 'finance:reports.read', 'finance.reports.read'
  UNION ALL SELECT 'finance:settings.read', 'finance.settings.read'
  UNION ALL SELECT 'finance:read', 'finance.read'
  UNION ALL SELECT 'finance:write', 'finance.write'
  UNION ALL SELECT 'finance:invoice-request:create', 'finance:invoice-request:create'
  UNION ALL SELECT 'finance:integration_operation:execute', 'finance:integration_operation:execute'
  UNION ALL SELECT 'finance:notifications_due.execute', 'finance.notifications_due.execute'
) scopes
WHERE sc.`status` = 'active'
  AND (sc.`app_code` = 'finance' OR sc.`client_code` IN ('finance', 'finance.runtime'))
ON DUPLICATE KEY UPDATE
  `scope_json` = VALUES(`scope_json`),
  `status` = 'active',
  `updated_at` = UTC_TIMESTAMP();
