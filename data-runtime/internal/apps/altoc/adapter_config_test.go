package altoc

import (
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

func TestAltocLeadResourceProtectsLifecycleFieldsAndScope(t *testing.T) {
	spec := mustAltocResource(t, "leads")

	if spec.OwnerColumn != "owner_user_id" {
		t.Fatalf("lead OwnerColumn = %q, want owner_user_id", spec.OwnerColumn)
	}
	if spec.DepartmentColumn != "owner_dept_code" {
		t.Fatalf("lead DepartmentColumn = %q, want owner_dept_code", spec.DepartmentColumn)
	}

	assertWriteDenied(t, spec, []string{
		"status",
		"score",
		"last_follow_up_at",
		"owner_user_id",
		"owner_dept_code",
		"invalid_reason_code",
		"invalid_reason",
		"qualification_result",
		"qualification_reason_code",
		"converted_customer_id",
		"converted_opportunity_id",
		"converted_at",
	})
}

func TestAltocRequiredTablesCoverDomainCommandDependencies(t *testing.T) {
	required := map[string]bool{}
	for _, table := range requiredTables {
		required[table] = true
	}

	for _, table := range []string{
		"lead_conversion",
		"opportunity_contact_role",
		"opportunity_stage_log",
		"contract_stage",
		"sales_activity",
		"sales_task",
		"domain_event_outbox",
		"tender",
		"tender_agency",
		"tender_milestone",
		"tender_member",
		"contract_business_template",
		"contract_party",
		"contract_line",
		"contract_obligation",
		"contract_billing_schedule",
		"contract_project_link",
		"contract_project_line_rel",
		"contract_project_obligation_rel",
		"contract_orchestration_job",
		"contract_orchestration_step",
		"contract_delivery_asset_plan",
		"service_agreement",
		"service_agreement_asset",
		"service_agreement_coverage",
		"service_agreement_project_rel",
	} {
		if !required[table] {
			t.Fatalf("requiredTables missing %q; command paths should fail readiness before runtime mutation", table)
		}
	}
}

func TestAltocCustomerResourceEnforcesDataScope(t *testing.T) {
	spec := mustAltocResource(t, "customers")

	if spec.OwnerColumn != "owner_user_id" {
		t.Fatalf("customer OwnerColumn = %q, want owner_user_id", spec.OwnerColumn)
	}
	if spec.DepartmentColumn != "owner_dept_code" {
		t.Fatalf("customer DepartmentColumn = %q, want owner_dept_code", spec.DepartmentColumn)
	}
}

func TestAltocOpportunityResourceProtectsLifecycleFieldsAndScope(t *testing.T) {
	spec := mustAltocResource(t, "opportunities")

	if spec.OwnerColumn != "owner_user_id" {
		t.Fatalf("opportunity OwnerColumn = %q, want owner_user_id", spec.OwnerColumn)
	}
	if spec.DepartmentColumn != "owner_dept_code" {
		t.Fatalf("opportunity DepartmentColumn = %q, want owner_dept_code", spec.DepartmentColumn)
	}

	assertWriteDenied(t, spec, []string{
		"lead_id",
		"stage_id",
		"forecast_category",
		"status",
		"win_rate",
		"last_follow_up_at",
		"owner_user_id",
		"owner_dept_code",
		"won_at",
		"won_reason_code",
		"won_reason",
		"lost_at",
		"lost_reason_code",
		"lost_reason",
		"pause_reason_code",
		"pause_reason",
		"version_no",
		"last_status_changed_at",
		"last_status_changed_by",
	})
}

func TestAltocFinancialResourcesEnforceDataScope(t *testing.T) {
	quote := mustAltocResource(t, "quotes")
	if quote.OwnerColumn != "owner_user_id" {
		t.Fatalf("quote OwnerColumn = %q, want owner_user_id", quote.OwnerColumn)
	}
	if quote.DepartmentColumn != "owner_dept_code" {
		t.Fatalf("quote DepartmentColumn = %q, want owner_dept_code", quote.DepartmentColumn)
	}
	assertWriteDenied(t, quote, []string{
		"status",
		"approved_at",
		"approved_by",
		"rejected_at",
		"rejected_by",
		"reject_reason",
		"sent_at",
		"accepted_at",
		"expired_at",
		"last_status_changed_at",
		"last_status_changed_by",
	})

	contract := mustAltocResource(t, "contracts")
	if contract.OwnerColumn != "owner_user_id" {
		t.Fatalf("contract OwnerColumn = %q, want owner_user_id", contract.OwnerColumn)
	}
	if contract.DepartmentColumn != "owner_dept_code" {
		t.Fatalf("contract DepartmentColumn = %q, want owner_dept_code", contract.DepartmentColumn)
	}
	assertSearchColumns(t, contract, []string{
		"primary_type",
		"template_code",
		"source_code",
	})
	assertWriteDenied(t, contract, []string{
		"status",
		"legal_status",
		"fulfillment_status",
		"financial_status",
		"activation_status",
		"effective_date",
		"approved_at",
		"approved_by",
		"rejected_at",
		"rejected_by",
		"reject_reason",
		"terminated_at",
		"completed_at",
		"version_no",
		"lock_version",
		"last_status_changed_at",
		"last_status_changed_by",
	})

	payment := mustAltocResource(t, "payments")
	if payment.OwnerColumn != "owner_user_id" {
		t.Fatalf("payment OwnerColumn = %q, want owner_user_id", payment.OwnerColumn)
	}
	if payment.DepartmentColumn != "" {
		t.Fatalf("payment DepartmentColumn = %q, want empty because receivable_plan has no owner_dept_code", payment.DepartmentColumn)
	}
}

func TestAltocTenderResourcesAreRuntimeBacked(t *testing.T) {
	tender := mustAltocResource(t, "tenders")
	if tender.Table != "tender" {
		t.Fatalf("tender table = %q, want tender", tender.Table)
	}
	if tender.OwnerColumn != "owner_user_id" {
		t.Fatalf("tender OwnerColumn = %q, want owner_user_id", tender.OwnerColumn)
	}
	assertSearchColumns(t, tender, []string{
		"code",
		"name",
		"project_code",
		"owner_user_id",
	})
	assertWriteDenied(t, tender, []string{
		"status",
		"winning_amount",
		"lost_to",
		"lost_to_amount",
		"lost_reason_type",
		"lost_reason_detail",
		"improvement_suggestion",
		"review_by",
		"review_at",
	})

	agencies := mustAltocResource(t, "tenders/agencies")
	if agencies.Table != "tender_agency" {
		t.Fatalf("tender agencies table = %q, want tender_agency", agencies.Table)
	}

	milestones := mustAltocResource(t, "tenders/{tender_id}/milestones")
	if milestones.Table != "tender_milestone" {
		t.Fatalf("tender milestones table = %q, want tender_milestone", milestones.Table)
	}
	if milestones.PathParamColumns["tender_id"] != "tender_id" {
		t.Fatalf("tender milestones tender_id mapping = %#v", milestones.PathParamColumns)
	}

	members := mustAltocResource(t, "tenders/{tender_id}/members")
	if members.Table != "tender_member" {
		t.Fatalf("tender members table = %q, want tender_member", members.Table)
	}
	if members.PathParamColumns["tender_id"] != "tender_id" {
		t.Fatalf("tender members tender_id mapping = %#v", members.PathParamColumns)
	}
}

func TestAltocCustomerSuccessResourcesEnforceOwnerScope(t *testing.T) {
	maintenance := mustAltocResource(t, "maintenance-contracts")
	if maintenance.OwnerColumn != "owner_user_id" {
		t.Fatalf("maintenance contract OwnerColumn = %q, want owner_user_id", maintenance.OwnerColumn)
	}

	entitlement := mustAltocResource(t, "service-entitlements")
	if entitlement.ParentScope == nil {
		t.Fatal("service entitlement ParentScope is nil; service_entitlement must inherit maintenance_contract scope")
	}
	if entitlement.ParentScope.Table != "maintenance_contract" {
		t.Fatalf("service entitlement parent table = %q, want maintenance_contract", entitlement.ParentScope.Table)
	}
	if entitlement.ParentScope.LocalColumn != "maintenance_contract_id" {
		t.Fatalf("service entitlement parent local column = %q, want maintenance_contract_id", entitlement.ParentScope.LocalColumn)
	}
	if entitlement.ParentScope.OwnerColumn != "owner_user_id" {
		t.Fatalf("service entitlement parent owner column = %q, want owner_user_id", entitlement.ParentScope.OwnerColumn)
	}

	ticket := mustAltocResource(t, "service-tickets")
	if ticket.OwnerColumn != "owner_user_id" {
		t.Fatalf("service ticket OwnerColumn = %q, want owner_user_id", ticket.OwnerColumn)
	}

	renewal := mustAltocResource(t, "renewal-opportunities")
	if renewal.OwnerColumn != "owner_user_id" {
		t.Fatalf("renewal opportunity OwnerColumn = %q, want owner_user_id", renewal.OwnerColumn)
	}
}

func TestAltocRuntimeResourcesExposeDomainSubresources(t *testing.T) {
	activities := mustAltocResource(t, "opportunities/{opportunity_id}/activities")
	if activities.Table != "sales_activity" {
		t.Fatalf("activities table = %q, want sales_activity", activities.Table)
	}
	if activities.PathParamColumns["opportunity_id"] != "opportunity_id" {
		t.Fatalf("activities opportunity_id path mapping = %#v", activities.PathParamColumns)
	}
	assertWriteDenied(t, activities, []string{
		"code",
		"lead_id",
		"customer_id",
		"contact_id",
		"opportunity_id",
		"owner_user_id",
		"status",
		"next_action",
		"next_action_due_at",
	})

	roles := mustAltocResource(t, "opportunities/{opportunity_id}/contact-roles")
	if roles.Table != "opportunity_contact_role" {
		t.Fatalf("contact roles table = %q, want opportunity_contact_role", roles.Table)
	}
	if roles.PathParamColumns["opportunity_id"] != "opportunity_id" {
		t.Fatalf("contact roles opportunity_id path mapping = %#v", roles.PathParamColumns)
	}

	contractStages := mustAltocResource(t, "contracts/{contract_id}/stages")
	if !contractStages.ReadOnly {
		t.Fatal("contract stages generic resource must be read-only; stage completion is a domain command")
	}
	if contractStages.PathParamColumns["contract_id"] != "contract_id" {
		t.Fatalf("contract stages contract_id path mapping = %#v", contractStages.PathParamColumns)
	}

	contractLines := mustAltocResource(t, "contracts/{contract_id}/lines")
	if contractLines.Table != "contract_line" {
		t.Fatalf("contract lines table = %q, want contract_line", contractLines.Table)
	}
	if contractLines.PathParamColumns["contract_id"] != "contract_id" {
		t.Fatalf("contract lines contract_id path mapping = %#v", contractLines.PathParamColumns)
	}
	if contractLines.ReadOnly {
		t.Fatal("contract lines generic resource must remain writable; domain commands guard parent scope and draft state")
	}
	assertSearchColumns(t, contractLines, []string{
		"name",
		"line_type",
		"product_code",
	})

	contractObligations := mustAltocResource(t, "contracts/{contract_id}/obligations")
	if contractObligations.Table != "contract_obligation" {
		t.Fatalf("contract obligations table = %q, want contract_obligation", contractObligations.Table)
	}
	if contractObligations.PathParamColumns["contract_id"] != "contract_id" {
		t.Fatalf("contract obligations contract_id path mapping = %#v", contractObligations.PathParamColumns)
	}
	if !contractObligations.ReadOnly {
		t.Fatal("contract obligations generic resource must be read-only; obligation changes are domain commands")
	}

	contractBillingSchedules := mustAltocResource(t, "contracts/{contract_id}/billing-schedules")
	if contractBillingSchedules.Table != "contract_billing_schedule" {
		t.Fatalf("contract billing schedules table = %q, want contract_billing_schedule", contractBillingSchedules.Table)
	}
	if contractBillingSchedules.PathParamColumns["contract_id"] != "contract_id" {
		t.Fatalf("contract billing schedules contract_id path mapping = %#v", contractBillingSchedules.PathParamColumns)
	}
	if !contractBillingSchedules.ReadOnly {
		t.Fatal("contract billing schedules generic resource must be read-only; billing changes are domain commands")
	}

	projectLinks := mustAltocResource(t, "contracts/{contract_id}/project-links")
	if projectLinks.Table != "contract_project_link" {
		t.Fatalf("contract project links table = %q, want contract_project_link", projectLinks.Table)
	}
	if projectLinks.PathParamColumns["contract_id"] != "contract_id" {
		t.Fatalf("contract project links contract_id path mapping = %#v", projectLinks.PathParamColumns)
	}
	if projectLinks.ReadOnly {
		t.Fatal("contract project links generic resource must remain writable for linking existing Aims projects")
	}
	assertSearchColumns(t, projectLinks, []string{
		"project_code",
		"project_role",
		"status",
	})

	deliveryAssetPlans := mustAltocResource(t, "contracts/{contract_id}/delivery-asset-plans")
	if deliveryAssetPlans.Table != "contract_delivery_asset_plan" {
		t.Fatalf("contract delivery asset plans table = %q, want contract_delivery_asset_plan", deliveryAssetPlans.Table)
	}
	if !deliveryAssetPlans.ReadOnly {
		t.Fatal("contract delivery asset plans generic resource must be read-only; activation commands generate placeholders")
	}
	assertSearchColumns(t, deliveryAssetPlans, []string{
		"code",
		"product_code",
		"status",
	})

	serviceAgreements := mustAltocResource(t, "contracts/{contract_id}/service-agreements")
	if serviceAgreements.Table != "service_agreement" {
		t.Fatalf("contract service agreements table = %q, want service_agreement", serviceAgreements.Table)
	}
	if !serviceAgreements.ReadOnly {
		t.Fatal("contract service agreements generic resource must be read-only; activation commands generate plans")
	}
	assertSearchColumns(t, serviceAgreements, []string{
		"code",
		"service_level",
		"status",
	})
}

func TestAltocOpportunityStageResourceExposesPipelineTemplateFields(t *testing.T) {
	stages := mustAltocResource(t, "config/opportunity-stages")

	assertSearchColumns(t, stages, []string{
		"pipeline_code",
		"stage_kind",
	})
}

func TestAltocContractBusinessTemplateResourceIsReadOnly(t *testing.T) {
	templates := mustAltocResource(t, "config/contract-business-templates")
	if templates.Table != "contract_business_template" {
		t.Fatalf("contract business templates table = %q, want contract_business_template", templates.Table)
	}
	if !templates.ReadOnly {
		t.Fatal("contract business templates must be read-only runtime config")
	}
	assertSearchColumns(t, templates, []string{
		"direction",
		"primary_type",
	})
}

func TestAltocTeamResourcesAreRuntimeBacked(t *testing.T) {
	team := mustAltocResource(t, "teams")
	if team.Table != "sales_team" {
		t.Fatalf("team table = %q, want sales_team", team.Table)
	}
	assertSearchColumns(t, team, []string{
		"code",
		"name",
		"team_type",
		"leader_user_id",
	})

	members := mustAltocResource(t, "teams/{team_id}/members")
	if members.Table != "sales_team_member" {
		t.Fatalf("team members table = %q, want sales_team_member", members.Table)
	}
	if members.PathParamColumns["team_id"] != "team_id" {
		t.Fatalf("team members team_id path mapping = %#v", members.PathParamColumns)
	}
}

func mustAltocResource(t *testing.T, path string) compat.ResourceSpec {
	t.Helper()
	for _, spec := range altocResources() {
		if spec.Path == path {
			return spec
		}
	}
	t.Fatalf("resource %q not found", path)
	return compat.ResourceSpec{}
}

func assertSearchColumns(t *testing.T, spec compat.ResourceSpec, expected []string) {
	t.Helper()
	actual := make(map[string]bool, len(spec.SearchColumns))
	for _, column := range spec.SearchColumns {
		actual[column] = true
	}

	for _, column := range expected {
		if !actual[column] {
			t.Fatalf("resource %q SearchColumns missing %q; got %#v", spec.Path, column, spec.SearchColumns)
		}
	}
}

func assertWriteDenied(t *testing.T, spec compat.ResourceSpec, expected []string) {
	t.Helper()
	actual := make(map[string]bool, len(spec.WriteDenyColumns))
	for _, column := range spec.WriteDenyColumns {
		actual[column] = true
	}

	for _, column := range expected {
		if !actual[column] {
			t.Fatalf("resource %q WriteDenyColumns missing %q; got %#v", spec.Path, column, spec.WriteDenyColumns)
		}
	}
}
