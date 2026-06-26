package finance

import "strings"

type ListResourceSpec struct {
	Operation      string
	Scope          string
	Table          string
	Select         []string
	SearchColumns  []string
	DateColumn     string
	StatusColumn   string
	DefaultOrderBy string
}

type DetailResourceSpec struct {
	Operation       string
	Scope           string
	Table           string
	NotFoundMessage string
	SoftDelete      bool
	PathPrefix      string
}

var listResourceSpecs = map[string]ListResourceSpec{
	"/v1/finance/accounting-objects": {
		Operation:      "finance.accounting_objects.list",
		Scope:          "finance.accounting_objects.read",
		Table:          "finance_accounting_object",
		Select:         []string{"id", "code", "name", "object_type", "source_app", "source_code", "customer_code", "contract_code", "project_code", "department_code", "sales_region_code", "owner_uid", "status", "remark", "created_at"},
		SearchColumns:  []string{"code", "name", "object_type", "customer_code", "contract_code", "project_code", "department_code", "sales_region_code", "owner_uid"},
		StatusColumn:   "status",
		DefaultOrderBy: "object_type ASC, name ASC, id ASC",
	},
	"/v1/finance/audit-logs": {
		Operation:      "finance.audit_logs.list",
		Scope:          "finance.audit_logs.read",
		Table:          "finance_audit_log",
		Select:         []string{"id", "entity_type", "entity_id", "entity_code", "action", "operator_id", "operator_ip", "source_app", "request_id", "created_at"},
		SearchColumns:  []string{"entity_type", "entity_code", "action", "operator_id", "request_id"},
		DefaultOrderBy: "created_at DESC, id DESC",
	},
	"/v1/finance/employee-contributions": {
		Operation:      "finance.employee_contributions.list",
		Scope:          "finance.employee_contributions.read",
		Table:          "employee_finance_contribution",
		Select:         []string{"id", "code", "employee_uid", "employee_name", "dept_code", "project_code", "contract_code", "period_month", "contribution_type", "contribution_amount", "contribution_ratio", "source_type", "status", "created_at"},
		SearchColumns:  []string{"code", "employee_uid", "employee_name", "dept_code", "project_code", "contract_code", "period_month", "contribution_type"},
		StatusColumn:   "status",
		DefaultOrderBy: "period_month DESC, employee_uid ASC, id DESC",
	},
	"/v1/finance/employee-costs": {
		Operation:      "finance.employee_costs.list",
		Scope:          "finance.employee_costs.read",
		Table:          "employee_cost_snapshot",
		Select:         []string{"id", "employee_uid", "employee_name", "dept_code", "position_code", "rank_code", "period_month", "standard_cost_amount", "actual_cost_amount", "cost_source", "created_at"},
		SearchColumns:  []string{"employee_uid", "employee_name", "dept_code", "position_code", "rank_code", "period_month"},
		DefaultOrderBy: "period_month DESC, employee_uid ASC",
	},
	"/v1/finance/expense-claims": {
		Operation:      "finance.expense_claims.list",
		Scope:          "finance.expense_claims.read",
		Table:          "expense_claim",
		Select:         []string{"id", "code", "title", "applicant_user_id", "applicant_dept_code", "project_code", "contract_code", "customer_code", "total_amount", "approved_amount", "paid_amount", "status", "workflow_instance_id", "submitted_at", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "title", "applicant_user_id", "project_code", "contract_code", "customer_code"},
		StatusColumn:   "status",
		DefaultOrderBy: "created_at DESC, id DESC",
	},
	"/v1/finance/expenses": {
		Operation:      "finance.expenses.list",
		Scope:          "finance.expenses.read",
		Table:          "finance_expense",
		Select:         []string{"id", "code", "expense_date", "expense_amount", "fee_amount", "currency_code", "project_code", "contract_code", "customer_code", "department_code", "accounting_object_type", "accounting_object_code", "sales_scope_type", "sales_scope_code", "sales_region_code", "sales_owner_uid", "handler_user_id", "payee_name", "payment_channel", "source_request_type", "source_request_code", "status", "description", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "project_code", "contract_code", "customer_code", "department_code", "accounting_object_code", "sales_scope_code", "sales_region_code", "sales_owner_uid", "handler_user_id", "payee_name", "description"},
		DateColumn:     "expense_date",
		StatusColumn:   "status",
		DefaultOrderBy: "expense_date DESC, id DESC",
	},
	"/v1/finance/integrations/approval-instances": {
		Operation:      "finance.approval_instances.list",
		Scope:          "finance.approval_instances.read",
		Table:          "external_approval_instance",
		Select:         []string{"id", "biz_type", "biz_code", "workflow_instance_id", "external_platform", "external_instance_id", "status", "submitted_by", "submitted_at", "completed_at", "last_synced_at", "error_message", "created_at"},
		SearchColumns:  []string{"biz_type", "biz_code", "workflow_instance_id", "external_platform", "external_instance_id", "submitted_by"},
		StatusColumn:   "status",
		DefaultOrderBy: "updated_at DESC, id DESC",
	},
	"/v1/finance/invoice-requests": {
		Operation:      "finance.invoice_requests.list",
		Scope:          "finance.invoice_requests.read",
		Table:          "invoice_request",
		Select:         []string{"id", "code", "source_app", "source_biz_type", "source_biz_code", "customer_code", "customer_name", "contract_code", "receivable_plan_code", "invoice_type", "invoice_medium", "invoice_item", "requested_amount", "tax_rate", "taxpayer_name", "taxpayer_no", "billing_info_json", "status", "workflow_instance_id", "requested_by", "submitted_at", "approved_at", "issued_invoice_id", "remark", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "customer_name", "contract_code", "receivable_plan_code", "invoice_item"},
		StatusColumn:   "status",
		DefaultOrderBy: "created_at DESC, id DESC",
	},
	"/v1/finance/invoices": {
		Operation:      "finance.invoices.list",
		Scope:          "finance.invoices.read",
		Table:          "finance_invoice",
		Select:         []string{"id", "code", "invoice_no", "customer_code", "customer_name", "contract_code", "project_code", "receivable_plan_code", "invoice_type", "invoice_medium", "invoice_item", "invoice_amount", "tax_amount", "invoice_date", "status", "invoice_file_url", "invoice_file_name", "invoice_file_mime_type", "invoice_file_size", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "invoice_no", "customer_name", "contract_code", "project_code"},
		DateColumn:     "invoice_date",
		StatusColumn:   "status",
		DefaultOrderBy: "COALESCE(invoice_date, created_at) DESC, id DESC",
	},
	"/v1/finance/payment-requests": {
		Operation:      "finance.payment_requests.list",
		Scope:          "finance.payment_requests.read",
		Table:          "payment_request",
		Select:         []string{"id", "code", "title", "payment_type", "applicant_user_id", "applicant_dept_code", "project_code", "contract_code", "customer_code", "supplier_code", "payee_name", "requested_amount", "approved_amount", "paid_amount", "planned_pay_date", "status", "workflow_instance_id", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "title", "applicant_user_id", "project_code", "contract_code", "customer_code", "supplier_code", "payee_name"},
		DateColumn:     "planned_pay_date",
		StatusColumn:   "status",
		DefaultOrderBy: "created_at DESC, id DESC",
	},
	"/v1/finance/performance-rules": {
		Operation:      "finance.performance_rules.list",
		Scope:          "finance.performance_rules.read",
		Table:          "performance_rule",
		Select:         []string{"id", "code", "name", "rule_type", "scope_type", "scope_code", "effective_from", "effective_to", "status", "created_at"},
		SearchColumns:  []string{"code", "name", "rule_type", "scope_type", "scope_code"},
		StatusColumn:   "status",
		DefaultOrderBy: "status ASC, id DESC",
	},
	"/v1/finance/performance": {
		Operation:      "finance.performance.list",
		Scope:          "finance.performance.read",
		Table:          "employee_finance_performance",
		Select:         []string{"id", "code", "employee_uid", "employee_name", "dept_code", "period_month", "performance_type", "base_amount", "performance_amount", "performance_score", "status", "calculated_at", "created_at"},
		SearchColumns:  []string{"code", "employee_uid", "employee_name", "dept_code", "period_month", "performance_type"},
		StatusColumn:   "status",
		DefaultOrderBy: "period_month DESC, employee_uid ASC",
	},
	"/v1/finance/performance/snapshots": {
		Operation:      "finance.performance_snapshots.list",
		Scope:          "finance.performance_snapshots.read",
		Table:          "performance_calculation_snapshot",
		Select:         []string{"id", "code", "period_month", "calculation_type", "target_type", "target_code", "rule_id", "calculated_by", "calculated_at"},
		SearchColumns:  []string{"code", "period_month", "calculation_type", "target_type", "target_code"},
		DefaultOrderBy: "calculated_at DESC, id DESC",
	},
	"/v1/finance/project-accounting": {
		Operation:      "finance.project_accounting.list",
		Scope:          "finance.project_accounting.read",
		Table:          "project_finance_summary",
		Select:         []string{"id", "project_code", "project_name", "customer_code", "contract_code", "period_month", "contract_amount", "invoice_amount", "received_amount", "direct_expense_amount", "labor_cost_amount", "allocated_cost_amount", "gross_profit_amount", "gross_margin_rate", "calculated_at", "created_at"},
		SearchColumns:  []string{"project_code", "project_name", "customer_code", "contract_code", "period_month"},
		DefaultOrderBy: "period_month DESC, project_code ASC",
	},
	"/v1/finance/project-cost-allocations": {
		Operation:      "finance.project_cost_allocations.list",
		Scope:          "finance.project_cost_allocations.read",
		Table:          "project_cost_allocation",
		Select:         []string{"id", "code", "project_code", "period_month", "allocation_type", "employee_uid", "amount", "allocation_basis", "basis_value", "rule_code", "status", "created_at"},
		SearchColumns:  []string{"code", "project_code", "period_month", "allocation_type", "employee_uid", "rule_code"},
		StatusColumn:   "status",
		DefaultOrderBy: "period_month DESC, project_code ASC, id DESC",
	},
	"/v1/finance/project-expense-requests": {
		Operation:      "finance.project_expense_requests.list",
		Scope:          "finance.project_expense_requests.read",
		Table:          "project_expense_request",
		Select:         []string{"id", "code", "title", "applicant_user_id", "applicant_dept_code", "project_code", "contract_code", "customer_code", "supplier_code", "total_amount", "approved_amount", "status", "workflow_instance_id", "submitted_at", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "title", "applicant_user_id", "project_code", "contract_code", "customer_code", "supplier_code"},
		StatusColumn:   "status",
		DefaultOrderBy: "created_at DESC, id DESC",
	},
	"/v1/finance/receipts": {
		Operation:      "finance.receipts.list",
		Scope:          "finance.receipts.read",
		Table:          "finance_receipt",
		Select:         []string{"id", "code", "receipt_no", "customer_code", "customer_name", "contract_code", "project_code", "receivable_plan_code", "receipt_source_type", "accounting_object_type", "accounting_object_code", "received_amount", "reconciled_amount", "unreconciled_amount", "received_at", "channel", "payer_name", "status", "created_at", "deleted_at"},
		SearchColumns:  []string{"code", "receipt_no", "customer_name", "contract_code", "project_code", "accounting_object_code", "payer_name"},
		DateColumn:     "received_at",
		StatusColumn:   "status",
		DefaultOrderBy: "received_at DESC, id DESC",
	},
	"/v1/finance/reconciliation": {
		Operation:      "finance.reconciliation.list",
		Scope:          "finance.reconciliation.read",
		Table:          "finance_reconciliation",
		Select:         []string{"id", "code", "receipt_id", "invoice_id", "customer_code", "contract_code", "project_code", "receivable_plan_code", "reconciled_amount", "reconciled_at", "reconciliation_type", "status", "created_at"},
		SearchColumns:  []string{"code", "customer_code", "contract_code", "project_code", "receivable_plan_code"},
		DateColumn:     "reconciled_at",
		StatusColumn:   "status",
		DefaultOrderBy: "reconciled_at DESC, id DESC",
	},
	"/v1/finance/settings/expense-types": {
		Operation:      "finance.settings.expense_types.list",
		Scope:          "finance.settings.read",
		Table:          "finance_expense_type",
		Select:         []string{"id", "code", "name", "default_subject_id", "cost_category", "reimbursable", "sort_no", "status", "created_at"},
		SearchColumns:  []string{"code", "name", "cost_category"},
		StatusColumn:   "status",
		DefaultOrderBy: "sort_no ASC, id ASC",
	},
	"/v1/finance/settings/people-cost-parameters": {
		Operation:      "finance.settings.people_cost_parameters.list",
		Scope:          "finance.settings.read",
		Table:          "finance_people_cost_parameter",
		Select:         []string{"id", "code", "name", "effective_from", "effective_to", "base_salary", "welfare_cost_rate", "management_allocation_rate", "resource_allocation_cost", "currency_code", "status", "remark", "created_at"},
		SearchColumns:  []string{"code", "name", "remark"},
		DateColumn:     "effective_from",
		StatusColumn:   "status",
		DefaultOrderBy: "effective_from DESC, id DESC",
	},
	"/v1/finance/settings/income-types": {
		Operation:      "finance.settings.income_types.list",
		Scope:          "finance.settings.read",
		Table:          "finance_income_type",
		Select:         []string{"id", "code", "name", "default_subject_id", "is_contract_income", "sort_no", "status", "remark", "created_at"},
		SearchColumns:  []string{"code", "name"},
		StatusColumn:   "status",
		DefaultOrderBy: "sort_no ASC, id ASC",
	},
	"/v1/finance/settings/subject-mappings": {
		Operation:      "finance.settings.subject_mappings.list",
		Scope:          "finance.settings.read",
		Table:          "finance_subject_mapping",
		Select:         []string{"id", "biz_type", "biz_subtype", "income_type_code", "expense_type_code", "default_subject_code", "object_strategy", "required_dimensions_json", "sort_no", "status", "remark", "created_at"},
		SearchColumns:  []string{"biz_type", "biz_subtype", "income_type_code", "expense_type_code", "default_subject_code", "object_strategy"},
		StatusColumn:   "status",
		DefaultOrderBy: "sort_no ASC, id ASC",
	},
	"/v1/finance/settings/subjects": {
		Operation:      "finance.settings.subjects.list",
		Scope:          "finance.settings.read",
		Table:          "finance_subject",
		Select:         []string{"id", "code", "name", "subject_type", "parent_id", "sort_no", "status", "remark", "created_at"},
		SearchColumns:  []string{"code", "name", "subject_type"},
		StatusColumn:   "status",
		DefaultOrderBy: "status ASC, sort_no ASC, id ASC",
	},
}

var detailResourceSpecs = []DetailResourceSpec{
	{Operation: "finance.bank_accounts.get", Scope: "finance.bank_accounts.read", Table: "finance_bank_account", NotFoundMessage: "bank account not found", SoftDelete: true, PathPrefix: "/v1/finance/bank-accounts"},
	{Operation: "finance.invoice_requests.get", Scope: "finance.invoice_requests.read", Table: "invoice_request", NotFoundMessage: "invoice request not found", SoftDelete: true, PathPrefix: "/v1/finance/invoice-requests"},
	{Operation: "finance.invoices.get", Scope: "finance.invoices.read", Table: "finance_invoice", NotFoundMessage: "invoice not found", SoftDelete: true, PathPrefix: "/v1/finance/invoices"},
	{Operation: "finance.receipts.get", Scope: "finance.receipts.read", Table: "finance_receipt", NotFoundMessage: "receipt not found", SoftDelete: true, PathPrefix: "/v1/finance/receipts"},
	{Operation: "finance.expenses.get", Scope: "finance.expenses.read", Table: "finance_expense", NotFoundMessage: "expense not found", SoftDelete: true, PathPrefix: "/v1/finance/expenses"},
	{Operation: "finance.expense_claims.get", Scope: "finance.expense_claims.read", Table: "expense_claim", NotFoundMessage: "expense claim not found", SoftDelete: true, PathPrefix: "/v1/finance/expense-claims"},
	{Operation: "finance.project_expense_requests.get", Scope: "finance.project_expense_requests.read", Table: "project_expense_request", NotFoundMessage: "project expense request not found", SoftDelete: true, PathPrefix: "/v1/finance/project-expense-requests"},
	{Operation: "finance.payment_requests.get", Scope: "finance.payment_requests.read", Table: "payment_request", NotFoundMessage: "payment request not found", SoftDelete: true, PathPrefix: "/v1/finance/payment-requests"},
}

func ListResourceSpecForPath(path string) (ListResourceSpec, bool) {
	spec, ok := listResourceSpecs[path]
	return spec, ok
}

func MatchDetailResource(path string) (DetailResourceSpec, string, bool) {
	for _, spec := range detailResourceSpecs {
		prefix := spec.PathPrefix + "/"
		if !strings.HasPrefix(path, prefix) {
			continue
		}
		code := strings.TrimSpace(strings.TrimPrefix(path, prefix))
		if code == "" || strings.Contains(code, "/") {
			continue
		}
		return spec, code, true
	}
	return DetailResourceSpec{}, "", false
}
