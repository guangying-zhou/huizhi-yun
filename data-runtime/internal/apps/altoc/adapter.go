package altoc

import (
	"context"
	"net/http"
	"net/url"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/apps/finance"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type financeBridge interface {
	ContractSummaries(context.Context, url.Values) (finance.DataResult[[]finance.ContractSummary], error)
	ContractSummary(context.Context, string) (finance.DataResult[finance.ContractSummary], error)
	Invoices(context.Context, url.Values) (finance.ListResult[map[string]any], error)
	Receipts(context.Context, url.Values) (finance.ListResult[map[string]any], error)
	HandleMutation(context.Context, string, string, map[string]any) (finance.DataResult[map[string]any], string, error)
}

type Adapter struct {
	*compat.Adapter
	finance financeBridge
}

var requiredTables = []string{
	"customer",
	"customer_invoice_info",
	"lead",
	"lead_conversion",
	"opportunity",
	"opportunity_contact_role",
	"opportunity_stage_log",
	"quotation",
	"tender",
	"tender_agency",
	"tender_milestone",
	"tender_member",
	"contract",
	"contract_business_template",
	"contract_party",
	"contract_line",
	"contract_obligation",
	"contract_billing_schedule",
	"contract_project_link",
	"contract_project_line_rel",
	"contract_project_obligation_rel",
	"contract_line_cost_allocation",
	"contract_line_profit_summary",
	"contract_orchestration_job",
	"contract_orchestration_step",
	"contract_delivery_asset_plan",
	"service_agreement",
	"service_agreement_asset",
	"service_agreement_coverage",
	"service_agreement_project_rel",
	"service_cost_summary",
	"contract_stage",
	"contract_payment_term",
	"document_link",
	"sales_activity",
	"sales_task",
	"maintenance_contract",
	"service_entitlement",
	"service_ticket",
	"renewal_opportunity",
	"sales_team",
	"sales_team_member",
	"receivable_plan",
	"audit_log",
	"domain_event_outbox",
	"customer_level",
	"customer_type",
	"opportunity_stage",
	"payment_term_template",
}

func altocDashboardCounts() []compat.DashboardCount {
	return []compat.DashboardCount{
		{Key: "customers", Label: "客户", Table: "customer", Where: "deleted_at IS NULL"},
		{Key: "leads", Label: "线索", Table: "lead", Where: "deleted_at IS NULL"},
		{Key: "opportunities", Label: "商机", Table: "opportunity", Where: "deleted_at IS NULL"},
		{Key: "contracts", Label: "合同", Table: "contract", Where: "deleted_at IS NULL"},
		{Key: "maintenance_contracts", Label: "维保", Table: "maintenance_contract", Where: "deleted_at IS NULL"},
		{Key: "service_tickets", Label: "工单", Table: "service_ticket", Where: "deleted_at IS NULL"},
		{Key: "payments", Label: "回款", Table: "receivable_plan", Where: "deleted_at IS NULL"},
	}
}

func altocResources() []compat.ResourceSpec {
	return []compat.ResourceSpec{
		{
			Path:             "customers",
			Table:            "customer",
			CodeColumn:       "code",
			CodePrefix:       "CU",
			SearchColumns:    []string{"code", "name", "short_name", "owner_user_id", "owner_dept_code", "industry_code", "region_code"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
		},
		{Path: "customers/{customer_id}/contacts", Table: "contact", PathParamColumns: map[string]string{"customer_id": "customer_id"}, SearchColumns: []string{"name", "mobile", "email", "owner_user_id"}, DefaultOrderBy: "`id` DESC", SoftDeleteColumn: "deleted_at"},
		{Path: "customers/{customer_id}/invoice-infos", Table: "customer_invoice_info", PathParamColumns: map[string]string{"customer_id": "customer_id"}, SearchColumns: []string{"taxpayer_name", "taxpayer_no", "bank_name", "invoice_email"}, DefaultOrderBy: "`is_default` DESC, `id` DESC", SoftDeleteColumn: "deleted_at"},
		{
			Path:             "leads",
			Table:            "lead",
			CodeColumn:       "code",
			CodePrefix:       "LE",
			SearchColumns:    []string{"code", "name", "org_name", "contact_name", "contact_mobile", "owner_user_id", "owner_dept_code"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
			WriteDenyColumns: []string{"status", "score", "last_follow_up_at", "owner_user_id", "owner_dept_code", "invalid_reason_code", "invalid_reason", "qualification_result", "qualification_reason_code", "converted_customer_id", "converted_opportunity_id", "converted_at"},
		},
		{
			Path:             "opportunities",
			Table:            "opportunity",
			CodeColumn:       "code",
			CodePrefix:       "OP",
			SearchColumns:    []string{"code", "name", "owner_user_id", "owner_dept_code", "risk_reason"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
			WriteDenyColumns: []string{"lead_id", "stage_id", "forecast_category", "status", "win_rate", "last_follow_up_at", "owner_user_id", "owner_dept_code", "won_at", "won_reason_code", "won_reason", "lost_at", "lost_reason_code", "lost_reason", "pause_reason_code", "pause_reason", "version_no", "last_status_changed_at", "last_status_changed_by"},
		},
		{
			Path:             "opportunities/{opportunity_id}/activities",
			Table:            "sales_activity",
			PathParamColumns: map[string]string{"opportunity_id": "opportunity_id"},
			SearchColumns:    []string{"subject", "activity_type", "owner_user_id"},
			DefaultOrderBy:   "`id` DESC",
			SoftDeleteColumn: "deleted_at",
			WriteDenyColumns: []string{"code", "lead_id", "customer_id", "contact_id", "opportunity_id", "owner_user_id", "status", "next_action", "next_action_due_at"},
		},
		{Path: "opportunities/{opportunity_id}/contact-roles", Table: "opportunity_contact_role", PathParamColumns: map[string]string{"opportunity_id": "opportunity_id"}, SearchColumns: []string{"role", "influence_level", "attitude", "remark"}, DefaultOrderBy: "`is_primary` DESC, `id` ASC", SoftDeleteColumn: "deleted_at"},
		{
			Path:           "teams",
			Table:          "sales_team",
			CodeColumn:     "code",
			SearchColumns:  []string{"code", "name", "team_type", "leader_user_id", "status"},
			DefaultOrderBy: "`team_type` ASC, `id` ASC",
		},
		{
			Path:             "teams/{team_id}/members",
			Table:            "sales_team_member",
			PathParamColumns: map[string]string{"team_id": "team_id"},
			SearchColumns:    []string{"user_id", "role", "status"},
			DefaultOrderBy:   "FIELD(`role`, 'senior_manager', 'manager', 'assistant', 'member'), `joined_at` ASC, `id` ASC",
		},
		{
			Path:             "quotes",
			Table:            "quotation",
			CodeColumn:       "code",
			CodePrefix:       "QU",
			SearchColumns:    []string{"code", "quotation_no", "owner_user_id", "owner_dept_code", "remark"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
			WriteDenyColumns: []string{"status", "approved_at", "approved_by", "rejected_at", "rejected_by", "reject_reason", "sent_at", "accepted_at", "expired_at", "last_status_changed_at", "last_status_changed_by"},
		},
		{Path: "quotes/{quotation_id}/items", Table: "quotation_item", PathParamColumns: map[string]string{"quotation_id": "quotation_id"}, SearchColumns: []string{"item_name", "specification"}, DefaultOrderBy: "`sort_no` ASC, `id` ASC"},
		{
			Path:             "tenders",
			Table:            "tender",
			CodeColumn:       "code",
			CodePrefix:       "TD",
			SearchColumns:    []string{"code", "name", "project_code", "owner_user_id", "tenderer_name"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
			WriteDenyColumns: []string{"status", "winning_amount", "lost_to", "lost_to_amount", "lost_reason_type", "lost_reason_detail", "improvement_suggestion", "review_by", "review_at"},
		},
		{Path: "tenders/agencies", Table: "tender_agency", SearchColumns: []string{"name", "agency_type", "contact_name", "contact_phone"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
		{Path: "tenders/{tender_id}/milestones", Table: "tender_milestone", PathParamColumns: map[string]string{"tender_id": "tender_id"}, SearchColumns: []string{"name", "status", "assignee_user_id"}, DefaultOrderBy: "`sort_no` ASC, `due_date` ASC, `id` ASC"},
		{Path: "tenders/{tender_id}/members", Table: "tender_member", PathParamColumns: map[string]string{"tender_id": "tender_id"}, SearchColumns: []string{"user_id", "role"}, DefaultOrderBy: "FIELD(`role`, 'pm', 'business', 'presales', 'technical', 'finance', 'member'), `id` ASC"},
		{
			Path:             "contracts",
			Table:            "contract",
			CodeColumn:       "code",
			CodePrefix:       "CT",
			SearchColumns:    []string{"code", "contract_no", "name", "owner_user_id", "owner_dept_code", "primary_type", "template_code", "source_code"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
			DepartmentColumn: "owner_dept_code",
			WriteDenyColumns: []string{"status", "legal_status", "fulfillment_status", "financial_status", "activation_status", "effective_date", "approved_at", "approved_by", "rejected_at", "rejected_by", "reject_reason", "terminated_at", "completed_at", "version_no", "lock_version", "last_status_changed_at", "last_status_changed_by"},
		},
		{Path: "contracts/{contract_id}/lines", Table: "contract_line", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"code", "name", "line_type", "product_code", "catalog_item_code"}, DefaultOrderBy: "`sort_no` ASC, `line_no` ASC, `id` ASC", SoftDeleteColumn: "deleted_at"},
		{Path: "contracts/{contract_id}/obligations", Table: "contract_obligation", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"code", "name", "obligation_type", "status", "owner_user_id"}, DefaultOrderBy: "`sort_no` ASC, `id` ASC", SoftDeleteColumn: "deleted_at", ReadOnly: true},
		{Path: "contracts/{contract_id}/billing-schedules", Table: "contract_billing_schedule", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"code", "name", "trigger_type", "status", "finance_plan_code"}, DefaultOrderBy: "`expected_date` ASC, `id` ASC", SoftDeleteColumn: "deleted_at", ReadOnly: true},
		{Path: "contracts/{contract_id}/project-links", Table: "contract_project_link", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"project_code", "project_name_snapshot", "project_role", "plan_key", "status"}, DefaultOrderBy: "`project_role` ASC, `id` ASC", SoftDeleteColumn: "deleted_at"},
		{Path: "contracts/{contract_id}/delivery-asset-plans", Table: "contract_delivery_asset_plan", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"code", "name", "product_code", "external_asset_code", "status"}, DefaultOrderBy: "`status` ASC, `id` ASC", SoftDeleteColumn: "deleted_at", ReadOnly: true},
		{Path: "contracts/{contract_id}/service-agreements", Table: "service_agreement", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"code", "name", "service_level", "status", "owner_user_id"}, DefaultOrderBy: "`service_end_date` ASC, `id` ASC", SoftDeleteColumn: "deleted_at", ReadOnly: true},
		{Path: "contracts/{contract_id}/stages", Table: "contract_stage", PathParamColumns: map[string]string{"contract_id": "contract_id"}, SearchColumns: []string{"stage_name", "status"}, DefaultOrderBy: "`id` ASC", ReadOnly: true},
		{
			Path:             "maintenance-contracts",
			Table:            "maintenance_contract",
			CodeColumn:       "code",
			CodePrefix:       "MC",
			SearchColumns:    []string{"code", "name", "delivery_code", "project_code", "product_code", "owner_user_id", "status"},
			DefaultOrderBy:   "`service_end_date` ASC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
		},
		{
			Path:           "service-entitlements",
			Table:          "service_entitlement",
			CodeColumn:     "code",
			CodePrefix:     "SE",
			SearchColumns:  []string{"code", "name", "entitlement_type", "service_window", "priority", "status"},
			DefaultOrderBy: "`id` DESC",
			ParentScope: &compat.ParentScopeSpec{
				Table:            "maintenance_contract",
				LocalColumn:      "maintenance_contract_id",
				Resource:         "maintenance_contract",
				OwnerColumn:      "owner_user_id",
				SoftDeleteColumn: "deleted_at",
			},
		},
		{
			Path:             "service-tickets",
			Table:            "service_ticket",
			CodeColumn:       "code",
			CodePrefix:       "ST",
			SearchColumns:    []string{"code", "title", "ticket_type", "priority", "status", "sla_status", "entitlement_status", "delivery_code", "delivery_asset_code", "service_agreement_code", "project_code", "aims_work_item_key", "owner_user_id", "handler_user_id"},
			DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
		},
		{
			Path:             "renewal-opportunities",
			Table:            "renewal_opportunity",
			CodeColumn:       "code",
			CodePrefix:       "RO",
			SearchColumns:    []string{"code", "name", "renewal_type", "stage", "status", "owner_user_id", "risk_level"},
			DefaultOrderBy:   "`expected_sign_date` ASC, `id` DESC",
			SoftDeleteColumn: "deleted_at",
			OwnerColumn:      "owner_user_id",
		},
		{
			Path:           "payments",
			Table:          "receivable_plan",
			CodeColumn:     "code",
			CodePrefix:     "RP",
			SearchColumns:  []string{"code", "plan_name", "plan_type", "status", "owner_user_id", "remark"},
			DefaultOrderBy: "`updated_at` DESC, `id` DESC",
			OwnerColumn:    "owner_user_id",
		},
		{Path: "audit-logs", Table: "audit_log", SearchColumns: []string{"entity_type", "action", "operator_id", "operator_name"}, DefaultOrderBy: "`created_at` DESC, `id` DESC", ReadOnly: true},
		{Path: "config/customer-levels", Table: "customer_level", SearchColumns: []string{"code", "name"}, DefaultOrderBy: "`sort_no` ASC, `id` ASC", ReadOnly: true},
		{Path: "config/customer-types", Table: "customer_type", SearchColumns: []string{"code", "name"}, DefaultOrderBy: "`id` ASC", ReadOnly: true},
		{Path: "config/opportunity-stages", Table: "opportunity_stage", SearchColumns: []string{"code", "name", "pipeline_code", "stage_kind"}, DefaultOrderBy: "`sort_no` ASC, `id` ASC", ReadOnly: true},
		{Path: "config/payment-term-templates", Table: "payment_term_template", SearchColumns: []string{"code", "name"}, DefaultOrderBy: "`id` ASC", ReadOnly: true},
		{Path: "config/contract-business-templates", Table: "contract_business_template", SearchColumns: []string{"code", "name", "direction", "primary_type"}, DefaultOrderBy: "`direction` ASC, `id` ASC", SoftDeleteColumn: "deleted_at", ReadOnly: true},
	}
}

func New(cfg config.AltocConfig) (*Adapter, error) {
	adapter, err := compat.New(compat.Config{
		AppCode:         "altoc",
		DB:              cfg.DB,
		ResponseMode:    compat.ResponseCodeMessageData,
		RequiredTables:  requiredTables,
		DashboardCounts: altocDashboardCounts(),
		Resources:       altocResources(),
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter}, nil
}

func (a *Adapter) SetFinanceBridge(finance financeBridge) {
	a.finance = finance
}

func (a *Adapter) requireFinanceBridge() (financeBridge, error) {
	if a.finance == nil {
		return nil, httperror.New(http.StatusServiceUnavailable, "finance_bridge_unavailable", "Finance bridge is required for invoice data")
	}
	return a.finance, nil
}
