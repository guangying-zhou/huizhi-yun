package finance

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) HandleMutation(ctx context.Context, method string, path string, rawBody map[string]any) (DataResult[map[string]any], string, error) {
	method = strings.ToUpper(method)
	body := jsonBody(rawBody)

	if method == http.MethodPost {
		if spec, ok := createSpecs[path]; ok {
			body = withCreateDefaults(path, body)
			if isExpenseLedgerTable(spec.Table) {
				if err := requireExpenseLedgerCreateAccess(body); err != nil {
					return DataResult[map[string]any]{}, spec.Operation, err
				}
			}
			if spec.Table == "payment_request" {
				if err := requireApplicantRequestCreateAccess(body); err != nil {
					return DataResult[map[string]any]{}, spec.Operation, err
				}
			}
			if isPaymentConfirmationTable(spec.Table) {
				if err := requirePaymentConfirmationCreateDutySeparation(spec.Table, body); err != nil {
					return DataResult[map[string]any]{}, spec.Operation, err
				}
			}
			if isFinanceEmployeePerformanceTable(spec.Table) {
				if err := requireFinanceEmployeePerformanceCreateAccess(body); err != nil {
					return DataResult[map[string]any]{}, spec.Operation, err
				}
			}
			if isPerformanceRuleTable(spec.Table) {
				if err := requireFinancePerformanceGlobalBodyAccess(body); err != nil {
					return DataResult[map[string]any]{}, spec.Operation, err
				}
			}
			if path == "/v1/finance/project-cost-allocations" {
				result, err := a.UpsertProjectCostAllocation(ctx, body)
				return result, "finance.project_cost_allocations.upsert", err
			}
			if path == "/v1/finance/invoice-requests" {
				result, err := a.CreateInvoiceRequest(ctx, body)
				return result, spec.Operation, err
			}
			result, err := a.createBySpec(ctx, spec, body)
			if err == nil && (path == "/v1/finance/invoices" || path == "/v1/finance/receipts") {
				_ = a.recalculateContractSummary(ctx, a.db, bodyValue(body, "contractCode", "contract_code"))
			}
			return result, spec.Operation, err
		}
	}

	if method == http.MethodPost && strings.HasPrefix(path, "/v1/finance/invoices/") && strings.HasSuffix(path, "/red-reverse") {
		code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/invoices/"), "/red-reverse")
		result, err := a.RedReverseInvoice(ctx, code, body)
		return result, "finance.invoices.red_reverse", err
	}

	if method == http.MethodPatch {
		if spec, code, ok := matchUpdateSpec(path); ok {
			result, err := a.updateBySpec(ctx, spec, code, body)
			return result, spec.Operation, err
		}
	}

	if method == http.MethodDelete {
		if table, code, message, recalc, ok := matchSoftDelete(path); ok {
			result, err := a.softDeleteByTable(ctx, table, code, message, recalc, body)
			return result, "finance." + strings.ReplaceAll(table, "_", ".") + ".delete", err
		}
	}

	switch {
	case method == http.MethodPost && path == "/v1/finance/bank-accounts/balances":
		result, err := a.UpsertBankAccountBalance(ctx, "", body)
		return result, "finance.bank_accounts.balance.upsert", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/finance/bank-accounts/") && strings.HasSuffix(path, "/balance-snapshots"):
		code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/bank-accounts/"), "/balance-snapshots")
		result, err := a.UpsertBankAccountBalance(ctx, code, body)
		return result, "finance.bank_accounts.balance_snapshot.create", err
	case method == http.MethodPost && path == "/v1/finance/settings/subject-mappings":
		result, err := a.CreateSubjectMapping(ctx, body)
		return result, "finance.settings.subject_mappings.create", err
	case method == http.MethodPost && path == "/v1/finance/employee-costs":
		if err := requireProjectFinanceGlobalBodyAccess(body); err != nil {
			return DataResult[map[string]any]{}, "finance.employee_costs.upsert", err
		}
		result, err := a.UpsertEmployeeCost(ctx, body)
		return result, "finance.employee_costs.upsert", err
	case method == http.MethodPost && path == "/v1/finance/expense-claims":
		result, err := a.CreateExpenseClaim(ctx, body)
		return result, "finance.expense_claims.create", err
	case method == http.MethodPost && path == "/v1/finance/project-expense-requests":
		result, err := a.CreateProjectExpenseRequest(ctx, body)
		return result, "finance.project_expense_requests.create", err
	case method == http.MethodPost && path == "/v1/finance/reconciliation":
		result, err := a.CreateReconciliation(ctx, body)
		return result, "finance.reconciliation.create", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/finance/reconciliation/") && strings.HasSuffix(path, "/void"):
		code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/reconciliation/"), "/void")
		result, err := a.VoidReconciliation(ctx, code, body)
		return result, "finance.reconciliation.void", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/finance/receipts/") && strings.HasSuffix(path, "/classify"):
		code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/receipts/"), "/classify")
		result, err := a.ClassifyReceipt(ctx, code, body)
		return result, "finance.receipts.classify", err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/finance/invoice-requests/") && strings.HasSuffix(path, "/issue"):
		code := strings.TrimSuffix(strings.TrimPrefix(path, "/v1/finance/invoice-requests/"), "/issue")
		result, err := a.IssueInvoiceRequest(ctx, code, body)
		return result, "finance.invoice_requests.issue", err
	case method == http.MethodPost && strings.HasSuffix(path, "/submit"):
		result, operation, err := a.SubmitApprovalByPath(ctx, path, body)
		return result, operation, err
	case method == http.MethodPost && path == "/v1/finance/workflow/callback":
		result, err := a.WorkflowCallback(ctx, body)
		return result, "finance.workflow.callback", err
	case method == http.MethodPost && path == "/v1/finance/performance/recalculate":
		if err := requireFinancePerformanceGlobalBodyAccess(body); err != nil {
			return DataResult[map[string]any]{}, "finance.performance.recalculate", err
		}
		result, err := a.RecalculateEmployeePerformance(ctx, body)
		return result, "finance.performance.recalculate", err
	case method == http.MethodPost && path == "/v1/finance/project-accounting/recalculate":
		result, err := a.RecalculateProjectFinance(ctx, body)
		return result, "finance.project_accounting.recalculate", err
	case method == http.MethodPost && path == "/v1/finance/migrations/wizbizdb/import":
		return DataResult[map[string]any]{}, "finance.migrations.wizbizdb.import", unsupportedCommand("finance.migrations.wizbizdb.import")
	case method == http.MethodPost && path == "/v1/finance/workflow/actions/sync":
		return DataResult[map[string]any]{Data: map[string]any{"skipped": true, "reason": "workflow action sync does not require finance database runtime"}}, "finance.workflow.actions.sync", nil
	}

	return DataResult[map[string]any]{}, "", httperror.New(http.StatusNotFound, "not_found", "Route not found")
}

var createSpecs = map[string]createSpec{
	"/v1/finance/accounting-objects": {
		Operation:    "finance.accounting_objects.create",
		Scope:        "finance.accounting_objects.write",
		Table:        "finance_accounting_object",
		CodeRequired: true,
		Fields: []mutationField{
			requiredField("name"),
			requiredAllowedField("object_type", accountingObjectTypes, "objectType", "object_type"),
			stringField("source_app", "sourceApp", "source_app"),
			stringField("source_code", "sourceCode", "source_code"),
			stringField("legacy_source", "legacySource", "legacy_source"),
			stringField("legacy_id", "legacyId", "legacy_id"),
			stringField("customer_code", "customerCode", "customer_code"),
			stringField("contract_code", "contractCode", "contract_code"),
			stringField("project_code", "projectCode", "project_code"),
			stringField("department_code", "departmentCode", "department_code"),
			stringField("sales_region_code", "salesRegionCode", "sales_region_code"),
			stringField("owner_uid", "ownerUid", "owner_uid"),
			allowedDefaultField("status", []string{"active", "inactive"}, "active", "status"),
			stringField("remark", "remark"),
		},
	},
	"/v1/finance/bank-accounts": {
		Operation:  "finance.bank_accounts.create",
		Scope:      "finance.bank_accounts.write",
		Table:      "finance_bank_account",
		CodePrefix: "BA",
		Fields: []mutationField{
			requiredField("account_name", "accountName", "account_name"),
			stringField("bank_name", "bankName", "bank_name"),
			stringField("account_no_masked", "accountNoMasked", "account_no_masked"),
			stringField("account_no_secret_ref", "accountNoSecretRef", "account_no_secret_ref"),
			defaultStringField("account_type", "bank", "accountType", "account_type"),
			defaultStringField("currency_code", "CNY", "currencyCode", "currency_code"),
			stringField("owner_dept_code", "ownerDeptCode", "owner_dept_code"),
			allowedDefaultField("status", []string{"active", "inactive", "closed"}, "active", "status"),
			dateField("opened_at", "openedAt", "opened_at"),
			dateField("closed_at", "closedAt", "closed_at"),
			stringField("remark", "remark"),
			stringField("created_by", "createdBy", "created_by"),
			stringField("updated_by", "updatedBy", "updated_by"),
		},
	},
	"/v1/finance/settings/subjects": {
		Operation:    "finance.settings.subjects.create",
		Scope:        "finance.settings.write",
		Table:        "finance_subject",
		CodeRequired: true,
		Fields: []mutationField{
			requiredField("name"),
			requiredAllowedField("subject_type", subjectTypes, "subjectType", "subject_type"),
			numberField("parent_id", "parentId", "parent_id"),
			defaultNumberField("sort_no", 0, "sortNo", "sort_no"),
			allowedDefaultField("status", []string{"active", "inactive"}, "active", "status"),
			stringField("remark", "remark"),
		},
	},
	"/v1/finance/settings/income-types": {
		Operation:    "finance.settings.income_types.create",
		Scope:        "finance.settings.write",
		Table:        "finance_income_type",
		CodeRequired: true,
		Fields: []mutationField{
			requiredField("name"),
			numberField("default_subject_id", "defaultSubjectId", "default_subject_id"),
			boolField("is_contract_income", true, "isContractIncome", "is_contract_income"),
			allowedDefaultField("status", []string{"active", "inactive"}, "active", "status"),
			defaultNumberField("sort_no", 0, "sortNo", "sort_no"),
			stringField("remark", "remark"),
		},
	},
	"/v1/finance/settings/expense-types": {
		Operation:    "finance.settings.expense_types.create",
		Scope:        "finance.settings.write",
		Table:        "finance_expense_type",
		CodeRequired: true,
		Fields: []mutationField{
			requiredField("name"),
			numberField("default_subject_id", "defaultSubjectId", "default_subject_id"),
			stringField("cost_category", "costCategory", "cost_category"),
			boolField("reimbursable", true, "reimbursable"),
			allowedDefaultField("status", []string{"active", "inactive"}, "active", "status"),
			defaultNumberField("sort_no", 0, "sortNo", "sort_no"),
			stringField("remark", "remark"),
		},
	},
	"/v1/finance/settings/people-cost-parameters": {
		Operation:    "finance.settings.people_cost_parameters.create",
		Scope:        "finance.settings.write",
		Table:        "finance_people_cost_parameter",
		CodeRequired: true,
		Fields: []mutationField{
			requiredField("name", "name"),
			dateDefaultField("effective_from", "2026-01-01", "effectiveFrom", "effective_from"),
			dateField("effective_to", "effectiveTo", "effective_to"),
			moneyDefaultField("base_salary", "0", "baseSalary", "base_salary"),
			defaultNumberField("welfare_cost_rate", 0, "welfareCostRate", "welfare_cost_rate"),
			defaultNumberField("management_allocation_rate", 0, "managementAllocationRate", "management_allocation_rate"),
			moneyDefaultField("resource_allocation_cost", "0", "resourceAllocationCost", "resource_allocation_cost"),
			defaultStringField("currency_code", "CNY", "currencyCode", "currency_code"),
			allowedDefaultField("status", []string{"active", "inactive"}, "active", "status"),
			stringField("remark", "remark"),
			stringField("created_by", "createdBy", "created_by"),
			stringField("updated_by", "updatedBy", "updated_by"),
		},
	},
	"/v1/finance/invoice-requests": {
		Operation:  "finance.invoice_requests.create",
		Scope:      "finance.invoice_requests.write",
		Table:      "invoice_request",
		CodePrefix: "IR",
		Fields: []mutationField{
			defaultStringField("source_app", "finance", "sourceApp", "source_app"),
			stringField("source_biz_type", "sourceBizType", "source_biz_type"),
			stringField("source_biz_code", "sourceBizCode", "source_biz_code"),
			stringField("customer_code", "customerCode", "customer_code"),
			stringField("customer_name", "customerName", "customer_name"),
			stringField("contract_code", "contractCode", "contract_code"),
			stringField("receivable_plan_code", "receivablePlanCode", "receivable_plan_code"),
			stringField("invoice_type", "invoiceType", "invoice_type"),
			allowedDefaultField("invoice_medium", []string{"electronic", "paper"}, "electronic", "invoiceMedium", "invoice_medium"),
			stringField("invoice_item", "invoiceItem", "invoice_item"),
			requiredMoneyField("requested_amount", true, "requestedAmount", "requested_amount"),
			numberField("tax_rate", "taxRate", "tax_rate"),
			stringField("taxpayer_name", "taxpayerName", "taxpayer_name"),
			stringField("taxpayer_no", "taxpayerNo", "taxpayer_no"),
			jsonField("billing_info_json", "billingInfo", "billing_info_json"),
			allowedDefaultField("status", []string{"draft", "pending_approval", "approved", "rejected", "issued", "canceled"}, "draft", "status"),
			stringField("requested_by", "requestedBy", "requested_by"),
			stringField("remark", "remark"),
			stringField("created_by", "createdBy", "created_by"),
			stringField("updated_by", "updatedBy", "updated_by"),
		},
	},
	"/v1/finance/invoices":         invoiceCreateSpec(),
	"/v1/finance/receipts":         receiptCreateSpec(),
	"/v1/finance/expenses":         expenseCreateSpec(),
	"/v1/finance/payment-requests": paymentRequestCreateSpec(),
	"/v1/finance/performance-rules": {
		Operation:  "finance.performance_rules.create",
		Scope:      "finance.performance_rules.write",
		Table:      "performance_rule",
		CodePrefix: "PR",
		Fields: []mutationField{
			requiredField("name"),
			defaultStringField("rule_type", "commission", "ruleType", "rule_type"),
			defaultStringField("scope_type", "company", "scopeType", "scope_type"),
			stringField("scope_code", "scopeCode", "scope_code"),
			dateField("effective_from", "effectiveFrom", "effective_from"),
			dateField("effective_to", "effectiveTo", "effective_to"),
			jsonDefaultField("rule_json", "{}", "ruleJson", "rule_json"),
			defaultStringField("status", "active", "status"),
			stringField("created_by", "createdBy", "created_by"),
			stringField("updated_by", "updatedBy", "updated_by"),
		},
	},
	"/v1/finance/project-cost-allocations": {
		Operation:  "finance.project_cost_allocations.create",
		Scope:      "finance.project_cost_allocations.write",
		Table:      "project_cost_allocation",
		CodePrefix: "PCA",
		Fields: []mutationField{
			requiredField("project_code", "projectCode", "project_code"),
			{Column: "period_month", Keys: []string{"periodMonth", "period_month"}, Kind: fieldString},
			defaultStringField("allocation_type", "other", "allocationType", "allocation_type"),
			stringField("source_table", "sourceTable", "source_table"),
			numberField("source_id", "sourceId", "source_id"),
			stringField("employee_uid", "employeeUid", "employee_uid"),
			requiredMoneyField("amount", false, "amount"),
			stringField("allocation_basis", "allocationBasis", "allocation_basis"),
			numberField("basis_value", "basisValue", "basis_value"),
			stringField("rule_code", "ruleCode", "rule_code"),
			defaultStringField("status", "active", "status"),
			stringField("created_by", "createdBy", "created_by"),
		},
	},
	"/v1/finance/employee-contributions": employeeContributionCreateSpec(),
}

func withCreateDefaults(path string, body jsonBody) jsonBody {
	if path == "/v1/finance/project-cost-allocations" || path == "/v1/finance/employee-contributions" {
		if cleanStringValue(bodyValue(body, "periodMonth", "period_month")) == "" {
			body["periodMonth"] = currentMonth()
		}
	}
	if path == "/v1/finance/receipts" {
		if cleanStringValue(bodyValue(body, "receiptSourceType", "receipt_source_type")) == "" {
			if cleanStringValue(bodyValue(body, "contractCode", "contract_code")) != "" {
				body["receiptSourceType"] = "contract"
			} else {
				body["receiptSourceType"] = "no_contract"
			}
		}
		if cleanStringValue(bodyValue(body, "unreconciledAmount", "unreconciled_amount")) == "" {
			receivedAmount, _ := moneyStringValue(bodyValue(body, "receivedAmount", "received_amount"), "receivedAmount", false, false)
			reconciledAmount, _ := moneyStringValue(bodyValue(body, "reconciledAmount", "reconciled_amount"), "reconciledAmount", false, false)
			body["unreconciledAmount"] = fmt.Sprintf("%.2f", amountAsFloat(receivedAmount)-amountAsFloat(firstNonEmpty(cleanStringValue(reconciledAmount), "0.00")))
		}
	}
	return body
}

func invoiceCreateSpec() createSpec {
	return createSpec{Operation: "finance.invoices.create", Scope: "finance.invoices.write", Table: "finance_invoice", CodePrefix: "INV", Fields: []mutationField{
		stringField("invoice_no", "invoiceNo", "invoice_no"),
		stringField("customer_code", "customerCode", "customer_code"),
		stringField("customer_name", "customerName", "customer_name"),
		stringField("contract_code", "contractCode", "contract_code"),
		stringField("project_code", "projectCode", "project_code"),
		stringField("receivable_plan_code", "receivablePlanCode", "receivable_plan_code"),
		stringField("invoice_type", "invoiceType", "invoice_type"),
		allowedDefaultField("invoice_medium", []string{"electronic", "paper"}, "electronic", "invoiceMedium", "invoice_medium"),
		stringField("invoice_item", "invoiceItem", "invoice_item"),
		requiredMoneyField("invoice_amount", true, "invoiceAmount", "invoice_amount"),
		numberField("tax_rate", "taxRate", "tax_rate"),
		moneyField("tax_amount", false, "taxAmount", "tax_amount"),
		moneyField("amount_tax_exclusive", false, "amountTaxExclusive", "amount_tax_exclusive"),
		dateField("invoice_date", "invoiceDate", "invoice_date"),
		allowedDefaultField("status", []string{"draft", "issued", "red_reversed", "canceled"}, "issued", "status"),
		stringField("taxpayer_name", "taxpayerName", "taxpayer_name"),
		stringField("taxpayer_no", "taxpayerNo", "taxpayer_no"),
		stringField("receiver_name", "receiverName", "receiver_name"),
		stringField("invoice_file_url", "invoiceFileUrl", "invoice_file_url"),
		stringField("invoice_file_name", "invoiceFileName", "invoice_file_name"),
		stringField("invoice_file_mime_type", "invoiceFileMimeType", "invoice_file_mime_type"),
		numberField("invoice_file_size", "invoiceFileSize", "invoice_file_size"),
		jsonField("source_refs_json", "sourceRefs", "source_refs_json"),
		stringField("remark", "remark"),
		stringField("created_by", "createdBy", "created_by"),
		stringField("updated_by", "updatedBy", "updated_by"),
	}}
}

func receiptCreateSpec() createSpec {
	return createSpec{Operation: "finance.receipts.create", Scope: "finance.receipts.write", Table: "finance_receipt", CodePrefix: "RCV", Fields: []mutationField{
		stringField("receipt_no", "receiptNo", "receipt_no"),
		stringField("customer_code", "customerCode", "customer_code"),
		stringField("customer_name", "customerName", "customer_name"),
		stringField("contract_code", "contractCode", "contract_code"),
		stringField("project_code", "projectCode", "project_code"),
		stringField("receivable_plan_code", "receivablePlanCode", "receivable_plan_code"),
		allowedDefaultField("receipt_source_type", receiptSourceTypes, "no_contract", "receiptSourceType", "receipt_source_type"),
		allowedField("accounting_object_type", accountingObjectTypes, "accountingObjectType", "accounting_object_type"),
		stringField("accounting_object_code", "accountingObjectCode", "accounting_object_code"),
		numberField("bank_account_id", "bankAccountId", "bank_account_id"),
		numberField("income_type_id", "incomeTypeId", "income_type_id"),
		requiredMoneyField("received_amount", true, "receivedAmount", "received_amount"),
		moneyDefaultField("reconciled_amount", "0.00", "reconciledAmount", "reconciled_amount"),
		moneyField("unreconciled_amount", false, "unreconciledAmount", "unreconciled_amount"),
		dateDefaultField("received_at", todayDate(), "receivedAt", "received_at"),
		stringField("channel", "channel"),
		stringField("payer_name", "payerName", "payer_name"),
		stringField("handler_user_id", "handlerUserId", "handler_user_id"),
		allowedDefaultField("status", []string{"draft", "confirmed", "partially_reconciled", "reconciled", "canceled"}, "confirmed", "status"),
		jsonField("source_refs_json", "sourceRefs", "source_refs_json"),
		stringField("note", "note"),
		stringField("confirmed_by", "confirmedBy", "confirmed_by"),
		dateTimeField("confirmed_at", "confirmedAt", "confirmed_at"),
		stringField("created_by", "createdBy", "created_by"),
		stringField("updated_by", "updatedBy", "updated_by"),
	}}
}

func expenseCreateSpec() createSpec {
	return createSpec{Operation: "finance.expenses.create", Scope: "finance.expenses.write", Table: "finance_expense", CodePrefix: "EXP", Fields: []mutationField{
		numberField("expense_type_id", "expenseTypeId", "expense_type_id"),
		numberField("subject_id", "subjectId", "subject_id"),
		dateDefaultField("expense_date", todayDate(), "expenseDate", "expense_date"),
		requiredMoneyField("expense_amount", true, "expenseAmount", "expense_amount"),
		moneyDefaultField("fee_amount", "0.00", "feeAmount", "fee_amount"),
		defaultStringField("currency_code", "CNY", "currencyCode", "currency_code"),
		numberField("bank_account_id", "bankAccountId", "bank_account_id"),
		stringField("project_code", "projectCode", "project_code"),
		stringField("contract_code", "contractCode", "contract_code"),
		stringField("customer_code", "customerCode", "customer_code"),
		stringField("department_code", "departmentCode", "department_code"),
		allowedField("accounting_object_type", accountingObjectTypes, "accountingObjectType", "accounting_object_type"),
		stringField("accounting_object_code", "accountingObjectCode", "accounting_object_code"),
		allowedField("sales_scope_type", salesScopeTypes, "salesScopeType", "sales_scope_type"),
		stringField("sales_scope_code", "salesScopeCode", "sales_scope_code"),
		stringField("sales_region_code", "salesRegionCode", "sales_region_code"),
		stringField("sales_owner_uid", "salesOwnerUid", "sales_owner_uid"),
		stringField("handler_user_id", "handlerUserId", "handler_user_id"),
		stringField("payee_name", "payeeName", "payee_name"),
		stringField("payee_account_masked", "payeeAccountMasked", "payee_account_masked"),
		stringField("payee_bank", "payeeBank", "payee_bank"),
		stringField("payment_channel", "paymentChannel", "payment_channel"),
		stringField("source_request_type", "sourceRequestType", "source_request_type"),
		stringField("source_request_code", "sourceRequestCode", "source_request_code"),
		allowedDefaultField("status", []string{"draft", "pending_payment", "paid", "confirmed", "canceled"}, "confirmed", "status"),
		stringField("description", "description"),
		jsonField("source_refs_json", "sourceRefs", "source_refs_json"),
		stringField("created_by", "createdBy", "created_by"),
		stringField("updated_by", "updatedBy", "updated_by"),
	}}
}

func paymentRequestCreateSpec() createSpec {
	return createSpec{Operation: "finance.payment_requests.create", Scope: "finance.payment_requests.write", Table: "payment_request", CodePrefix: "PAY", Fields: []mutationField{
		defaultStringField("title", "付款申请", "title"),
		defaultStringField("payment_type", "other", "paymentType", "payment_type"),
		defaultStringField("applicant_user_id", "unknown", "applicantUserId", "applicant_user_id"),
		stringField("applicant_dept_code", "applicantDeptCode", "applicant_dept_code"),
		stringField("project_code", "projectCode", "project_code"),
		stringField("contract_code", "contractCode", "contract_code"),
		stringField("customer_code", "customerCode", "customer_code"),
		stringField("supplier_code", "supplierCode", "supplier_code"),
		defaultStringField("payee_name", "未填写收款方", "payeeName", "payee_name"),
		stringField("payee_account_masked", "payeeAccountMasked", "payee_account_masked"),
		stringField("payee_account_secret_ref", "payeeAccountSecretRef", "payee_account_secret_ref"),
		stringField("payee_bank", "payeeBank", "payee_bank"),
		requiredMoneyField("requested_amount", true, "requestedAmount", "requested_amount"),
		dateField("planned_pay_date", "plannedPayDate", "planned_pay_date"),
		numberField("bank_account_id", "bankAccountId", "bank_account_id"),
		allowedDefaultField("status", []string{"draft", "pending_approval", "approved", "rejected", "paid", "canceled"}, "draft", "status"),
		stringField("remark", "remark"),
		stringField("created_by", "createdBy", "created_by"),
		stringField("updated_by", "updatedBy", "updated_by"),
	}}
}

func employeeContributionCreateSpec() createSpec {
	return createSpec{Operation: "finance.employee_contributions.create", Scope: "finance.employee_contributions.write", Table: "employee_finance_contribution", CodePrefix: "EFC", Fields: []mutationField{
		requiredField("employee_uid", "employeeUid", "employee_uid"),
		stringField("employee_name", "employeeName", "employee_name"),
		stringField("dept_code", "deptCode", "dept_code"),
		stringField("project_code", "projectCode", "project_code"),
		stringField("contract_code", "contractCode", "contract_code"),
		{Column: "period_month", Keys: []string{"periodMonth", "period_month"}, Kind: fieldString},
		defaultStringField("contribution_type", "other", "contributionType", "contribution_type"),
		moneyField("contribution_amount", false, "contributionAmount", "contribution_amount"),
		numberField("contribution_ratio", "contributionRatio", "contribution_ratio"),
		defaultStringField("source_type", "manual", "sourceType", "source_type"),
		jsonField("source_refs_json", "sourceRefs", "source_refs_json"),
		defaultStringField("status", "active", "status"),
		stringField("created_by", "createdBy", "created_by"),
	}}
}

func stringField(column string, keys ...string) mutationField {
	if len(keys) == 0 {
		keys = []string{column}
	}
	return mutationField{Column: column, Keys: keys, Kind: fieldString}
}

func requiredField(column string, keys ...string) mutationField {
	if len(keys) == 0 {
		keys = []string{column}
	}
	return mutationField{Column: column, Keys: keys, Kind: fieldRequiredString}
}

func defaultStringField(column string, fallback string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldString, Default: fallback}
}

func allowedField(column string, allowed []string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldAllowed, Allowed: allowed}
}

func requiredAllowedField(column string, allowed []string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldRequiredAllowed, Allowed: allowed}
}

func allowedDefaultField(column string, allowed []string, fallback string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldAllowed, Allowed: allowed, Default: fallback}
}

func moneyField(column string, positive bool, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldMoney, Positive: positive}
}

func moneyDefaultField(column string, fallback string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldMoney, Default: fallback}
}

func requiredMoneyField(column string, positive bool, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldRequiredMoney, Positive: positive}
}

func numberField(column string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldNumber}
}

func defaultNumberField(column string, fallback int64, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldNumber, Default: fallback}
}

func dateField(column string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldDate}
}

func dateDefaultField(column string, fallback string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldDate, Default: fallback}
}

func dateTimeField(column string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldDateTime}
}

func jsonField(column string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldJSON}
}

func jsonDefaultField(column string, fallback string, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldJSON, Default: fallback}
}

func boolField(column string, fallback bool, keys ...string) mutationField {
	return mutationField{Column: column, Keys: keys, Kind: fieldBool, Default: fallback}
}

func updateFieldsForCreate(spec createSpec) []mutationField {
	return spec.Fields
}

func matchUpdateSpec(path string) (updateSpec, string, bool) {
	for prefix, spec := range updateSpecs {
		if strings.HasPrefix(path, prefix+"/") {
			code := strings.TrimPrefix(path, prefix+"/")
			if code != "" && !strings.Contains(code, "/") {
				return spec, code, true
			}
		}
	}
	return updateSpec{}, "", false
}

func matchSoftDelete(path string) (string, string, string, bool, bool) {
	specs := map[string]struct {
		table   string
		message string
		recalc  bool
	}{
		"/v1/finance/bank-accounts": {"finance_bank_account", "bank account not found", false},
		"/v1/finance/invoices":      {"finance_invoice", "invoice not found", true},
		"/v1/finance/receipts":      {"finance_receipt", "receipt not found", true},
		"/v1/finance/expenses":      {"finance_expense", "expense not found", false},
	}
	for prefix, spec := range specs {
		if strings.HasPrefix(path, prefix+"/") {
			code := strings.TrimPrefix(path, prefix+"/")
			if code != "" && !strings.Contains(code, "/") {
				return spec.table, code, spec.message, spec.recalc, true
			}
		}
	}
	return "", "", "", false, false
}

var updateSpecs = map[string]updateSpec{
	"/v1/finance/accounting-objects": {
		Operation: "finance.accounting_objects.update", Scope: "finance.accounting_objects.write", Table: "finance_accounting_object", NotFoundMessage: "accounting object not found",
		Fields: []mutationField{
			stringField("name"), allowedField("object_type", accountingObjectTypes, "objectType", "object_type"), stringField("source_app", "sourceApp", "source_app"), stringField("source_code", "sourceCode", "source_code"), stringField("customer_code", "customerCode", "customer_code"), stringField("contract_code", "contractCode", "contract_code"), stringField("project_code", "projectCode", "project_code"), stringField("department_code", "departmentCode", "department_code"), stringField("sales_region_code", "salesRegionCode", "sales_region_code"), stringField("owner_uid", "ownerUid", "owner_uid"), allowedField("status", []string{"active", "inactive"}, "status"), stringField("remark", "remark"),
		},
	},
	"/v1/finance/bank-accounts": {
		Operation: "finance.bank_accounts.update", Scope: "finance.bank_accounts.write", Table: "finance_bank_account", SoftDelete: true, NotFoundMessage: "bank account not found",
		Fields: []mutationField{
			stringField("account_name", "accountName", "account_name"), stringField("bank_name", "bankName", "bank_name"), stringField("account_no_masked", "accountNoMasked", "account_no_masked"), stringField("account_no_secret_ref", "accountNoSecretRef", "account_no_secret_ref"), stringField("account_type", "accountType", "account_type"), stringField("currency_code", "currencyCode", "currency_code"), stringField("owner_dept_code", "ownerDeptCode", "owner_dept_code"), allowedField("status", []string{"active", "inactive", "closed"}, "status"), dateField("opened_at", "openedAt", "opened_at"), dateField("closed_at", "closedAt", "closed_at"), stringField("remark", "remark"), stringField("updated_by", "updatedBy", "updated_by"),
		},
	},
	"/v1/finance/settings/subjects": {
		Operation: "finance.settings.subjects.update", Scope: "finance.settings.write", Table: "finance_subject", NotFoundMessage: "subject not found",
		Fields: []mutationField{stringField("name"), allowedField("subject_type", subjectTypes, "subjectType", "subject_type"), numberField("parent_id", "parentId", "parent_id"), numberField("sort_no", "sortNo", "sort_no"), allowedField("status", []string{"active", "inactive"}, "status"), stringField("remark", "remark")},
	},
	"/v1/finance/settings/income-types": {
		Operation: "finance.settings.income_types.update", Scope: "finance.settings.write", Table: "finance_income_type", NotFoundMessage: "income type not found",
		Fields: []mutationField{stringField("name"), numberField("default_subject_id", "defaultSubjectId", "default_subject_id"), boolField("is_contract_income", true, "isContractIncome", "is_contract_income"), allowedField("status", []string{"active", "inactive"}, "status"), numberField("sort_no", "sortNo", "sort_no"), stringField("remark", "remark")},
	},
	"/v1/finance/settings/expense-types": {
		Operation: "finance.settings.expense_types.update", Scope: "finance.settings.write", Table: "finance_expense_type", NotFoundMessage: "expense type not found",
		Fields: []mutationField{stringField("name"), numberField("default_subject_id", "defaultSubjectId", "default_subject_id"), stringField("cost_category", "costCategory", "cost_category"), boolField("reimbursable", true, "reimbursable"), allowedField("status", []string{"active", "inactive"}, "status"), numberField("sort_no", "sortNo", "sort_no"), stringField("remark", "remark")},
	},
	"/v1/finance/settings/people-cost-parameters": {
		Operation: "finance.settings.people_cost_parameters.update", Scope: "finance.settings.write", Table: "finance_people_cost_parameter", NotFoundMessage: "people cost parameter not found",
		Fields: []mutationField{stringField("name"), dateField("effective_from", "effectiveFrom", "effective_from"), dateField("effective_to", "effectiveTo", "effective_to"), moneyField("base_salary", false, "baseSalary", "base_salary"), numberField("welfare_cost_rate", "welfareCostRate", "welfare_cost_rate"), numberField("management_allocation_rate", "managementAllocationRate", "management_allocation_rate"), moneyField("resource_allocation_cost", false, "resourceAllocationCost", "resource_allocation_cost"), stringField("currency_code", "currencyCode", "currency_code"), allowedField("status", []string{"active", "inactive"}, "status"), stringField("remark", "remark"), stringField("updated_by", "updatedBy", "updated_by")},
	},
	"/v1/finance/invoice-requests": {
		Operation: "finance.invoice_requests.update", Scope: "finance.invoice_requests.write", Table: "invoice_request", SoftDelete: true, Editable: true, EditableMessage: "only draft or rejected invoice requests can be edited", NotFoundMessage: "invoice request not found",
		Fields: []mutationField{stringField("customer_code", "customerCode", "customer_code"), stringField("customer_name", "customerName", "customer_name"), stringField("contract_code", "contractCode", "contract_code"), stringField("receivable_plan_code", "receivablePlanCode", "receivable_plan_code"), stringField("invoice_type", "invoiceType", "invoice_type"), allowedField("invoice_medium", []string{"electronic", "paper"}, "invoiceMedium", "invoice_medium"), stringField("invoice_item", "invoiceItem", "invoice_item"), moneyField("requested_amount", true, "requestedAmount", "requested_amount"), numberField("tax_rate", "taxRate", "tax_rate"), stringField("taxpayer_name", "taxpayerName", "taxpayer_name"), stringField("taxpayer_no", "taxpayerNo", "taxpayer_no"), jsonField("billing_info_json", "billingInfo", "billing_info_json"), allowedField("status", []string{"draft", "canceled"}, "status"), stringField("requested_by", "requestedBy", "requested_by"), stringField("remark", "remark"), stringField("updated_by", "updatedBy", "updated_by")},
	},
	"/v1/finance/invoices":                 invoiceUpdateSpec(),
	"/v1/finance/receipts":                 receiptUpdateSpec(),
	"/v1/finance/expenses":                 expenseUpdateSpec(),
	"/v1/finance/expense-claims":           requestUpdateSpec("finance.expense_claims.update", "finance.expense_claims.write", "expense_claim", "expense claim not found", "only draft or rejected expense claims can be edited", true),
	"/v1/finance/project-expense-requests": requestUpdateSpec("finance.project_expense_requests.update", "finance.project_expense_requests.write", "project_expense_request", "project expense request not found", "only draft or rejected project expense requests can be edited", false),
	"/v1/finance/payment-requests":         paymentRequestUpdateSpec(),
}

func invoiceUpdateSpec() updateSpec {
	spec := updateSpec{Operation: "finance.invoices.update", Scope: "finance.invoices.write", Table: "finance_invoice", SoftDelete: true, NotFoundMessage: "invoice not found"}
	spec.Fields = []mutationField{stringField("invoice_no", "invoiceNo", "invoice_no"), stringField("customer_code", "customerCode", "customer_code"), stringField("customer_name", "customerName", "customer_name"), stringField("contract_code", "contractCode", "contract_code"), stringField("project_code", "projectCode", "project_code"), stringField("receivable_plan_code", "receivablePlanCode", "receivable_plan_code"), stringField("invoice_type", "invoiceType", "invoice_type"), allowedField("invoice_medium", []string{"electronic", "paper"}, "invoiceMedium", "invoice_medium"), stringField("invoice_item", "invoiceItem", "invoice_item"), moneyField("invoice_amount", true, "invoiceAmount", "invoice_amount"), numberField("tax_rate", "taxRate", "tax_rate"), moneyField("tax_amount", false, "taxAmount", "tax_amount"), moneyField("amount_tax_exclusive", false, "amountTaxExclusive", "amount_tax_exclusive"), dateField("invoice_date", "invoiceDate", "invoice_date"), allowedField("status", []string{"draft", "issued", "red_reversed", "canceled"}, "status"), stringField("taxpayer_name", "taxpayerName", "taxpayer_name"), stringField("taxpayer_no", "taxpayerNo", "taxpayer_no"), stringField("receiver_name", "receiverName", "receiver_name"), stringField("invoice_file_url", "invoiceFileUrl", "invoice_file_url"), stringField("invoice_file_name", "invoiceFileName", "invoice_file_name"), stringField("invoice_file_mime_type", "invoiceFileMimeType", "invoice_file_mime_type"), numberField("invoice_file_size", "invoiceFileSize", "invoice_file_size"), jsonField("source_refs_json", "sourceRefs", "source_refs_json"), stringField("remark", "remark"), stringField("updated_by", "updatedBy", "updated_by")}
	spec.After = func(ctx context.Context, conn execQueryer, before map[string]any, body jsonBody) error {
		if err := (&Adapter{}).recalculateContractSummary(ctx, conn, before["contract_code"]); err != nil {
			return err
		}
		return (&Adapter{}).recalculateContractSummary(ctx, conn, bodyValue(body, "contractCode", "contract_code"))
	}
	return spec
}

func receiptUpdateSpec() updateSpec {
	spec := updateSpec{Operation: "finance.receipts.update", Scope: "finance.receipts.write", Table: "finance_receipt", SoftDelete: true, NotFoundMessage: "receipt not found"}
	spec.Fields = []mutationField{stringField("receipt_no", "receiptNo", "receipt_no"), stringField("customer_code", "customerCode", "customer_code"), stringField("customer_name", "customerName", "customer_name"), stringField("contract_code", "contractCode", "contract_code"), stringField("project_code", "projectCode", "project_code"), stringField("receivable_plan_code", "receivablePlanCode", "receivable_plan_code"), numberField("bank_account_id", "bankAccountId", "bank_account_id"), numberField("income_type_id", "incomeTypeId", "income_type_id"), moneyField("received_amount", true, "receivedAmount", "received_amount"), moneyField("unreconciled_amount", false, "unreconciledAmount", "unreconciled_amount"), dateField("received_at", "receivedAt", "received_at"), stringField("channel", "channel"), stringField("payer_name", "payerName", "payer_name"), stringField("handler_user_id", "handlerUserId", "handler_user_id"), allowedField("status", []string{"draft", "confirmed", "partially_reconciled", "reconciled", "canceled"}, "status"), jsonField("source_refs_json", "sourceRefs", "source_refs_json"), stringField("note", "note"), stringField("confirmed_by", "confirmedBy", "confirmed_by"), dateTimeField("confirmed_at", "confirmedAt", "confirmed_at"), stringField("updated_by", "updatedBy", "updated_by")}
	spec.After = func(ctx context.Context, conn execQueryer, before map[string]any, body jsonBody) error {
		if err := (&Adapter{}).recalculateContractSummary(ctx, conn, before["contract_code"]); err != nil {
			return err
		}
		return (&Adapter{}).recalculateContractSummary(ctx, conn, bodyValue(body, "contractCode", "contract_code"))
	}
	return spec
}

func expenseUpdateSpec() updateSpec {
	return updateSpec{Operation: "finance.expenses.update", Scope: "finance.expenses.write", Table: "finance_expense", SoftDelete: true, NotFoundMessage: "expense not found", Fields: []mutationField{numberField("expense_type_id", "expenseTypeId", "expense_type_id"), numberField("subject_id", "subjectId", "subject_id"), dateField("expense_date", "expenseDate", "expense_date"), moneyField("expense_amount", true, "expenseAmount", "expense_amount"), moneyField("fee_amount", false, "feeAmount", "fee_amount"), stringField("currency_code", "currencyCode", "currency_code"), numberField("bank_account_id", "bankAccountId", "bank_account_id"), stringField("project_code", "projectCode", "project_code"), stringField("contract_code", "contractCode", "contract_code"), stringField("customer_code", "customerCode", "customer_code"), stringField("department_code", "departmentCode", "department_code"), stringField("handler_user_id", "handlerUserId", "handler_user_id"), stringField("payee_name", "payeeName", "payee_name"), stringField("payee_account_masked", "payeeAccountMasked", "payee_account_masked"), stringField("payee_bank", "payeeBank", "payee_bank"), stringField("payment_channel", "paymentChannel", "payment_channel"), stringField("source_request_type", "sourceRequestType", "source_request_type"), stringField("source_request_code", "sourceRequestCode", "source_request_code"), allowedField("status", []string{"draft", "pending_payment", "paid", "confirmed", "canceled"}, "status"), stringField("description", "description"), jsonField("source_refs_json", "sourceRefs", "source_refs_json"), stringField("updated_by", "updatedBy", "updated_by")}}
}

func requestUpdateSpec(operation string, scope string, table string, notFoundMessage string, editableMessage string, hasCurrency bool) updateSpec {
	fields := []mutationField{stringField("title", "title"), stringField("applicant_user_id", "applicantUserId", "applicant_user_id"), stringField("applicant_dept_code", "applicantDeptCode", "applicant_dept_code"), stringField("project_code", "projectCode", "project_code"), stringField("contract_code", "contractCode", "contract_code"), stringField("customer_code", "customerCode", "customer_code"), moneyField("total_amount", true, "totalAmount", "total_amount")}
	if hasCurrency {
		fields = append(fields, stringField("currency_code", "currencyCode", "currency_code"), stringField("cost_bearer_type", "costBearerType", "cost_bearer_type"), stringField("cost_bearer_code", "costBearerCode", "cost_bearer_code"))
	} else {
		fields = append(fields, stringField("supplier_code", "supplierCode", "supplier_code"))
	}
	fields = append(fields, allowedField("status", []string{"draft", "canceled"}, "status"), stringField("remark", "remark"), stringField("updated_by", "updatedBy", "updated_by"))
	return updateSpec{Operation: operation, Scope: scope, Table: table, SoftDelete: true, Editable: true, EditableMessage: editableMessage, NotFoundMessage: notFoundMessage, Fields: fields}
}

func paymentRequestUpdateSpec() updateSpec {
	return updateSpec{Operation: "finance.payment_requests.update", Scope: "finance.payment_requests.write", Table: "payment_request", SoftDelete: true, Editable: true, EditableMessage: "only draft or rejected payment requests can be edited", NotFoundMessage: "payment request not found", Fields: []mutationField{stringField("title", "title"), stringField("payment_type", "paymentType", "payment_type"), stringField("applicant_user_id", "applicantUserId", "applicant_user_id"), stringField("applicant_dept_code", "applicantDeptCode", "applicant_dept_code"), stringField("project_code", "projectCode", "project_code"), stringField("contract_code", "contractCode", "contract_code"), stringField("customer_code", "customerCode", "customer_code"), stringField("supplier_code", "supplierCode", "supplier_code"), stringField("payee_name", "payeeName", "payee_name"), stringField("payee_account_masked", "payeeAccountMasked", "payee_account_masked"), stringField("payee_account_secret_ref", "payeeAccountSecretRef", "payee_account_secret_ref"), stringField("payee_bank", "payeeBank", "payee_bank"), moneyField("requested_amount", true, "requestedAmount", "requested_amount"), dateField("planned_pay_date", "plannedPayDate", "planned_pay_date"), numberField("bank_account_id", "bankAccountId", "bank_account_id"), allowedField("status", []string{"draft", "canceled"}, "status"), stringField("remark", "remark"), stringField("updated_by", "updatedBy", "updated_by")}}
}
