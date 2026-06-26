package altoc

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) HandleRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, error) {
	scopedBody := body
	if method != http.MethodGet {
		scopedBody = altocCommandBodyFromRequest(query, body)
	}
	if method == http.MethodGet {
		if err := requireRuntimeViewScope(path, query); err != nil {
			return nil, "", err
		}
	}
	if customerID, _, ok := customerContactPath(path); ok {
		if err := a.requireParentCustomerScope(ctx, customerID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if customerID, _, ok := customerInvoiceInfoPath(path); ok {
		if err := a.requireParentCustomerScope(ctx, customerID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if opportunityID, ok := opportunityActivityGenericResourcePath(method, path); ok {
		if err := a.requireParentOpportunityScope(ctx, opportunityID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if quotationID, _, ok := quotationItemPath(path); ok {
		if err := a.requireParentQuotationScope(ctx, quotationID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if contractID, _, ok := contractLinePath(path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		if method == http.MethodGet {
			return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
		}
	}
	if contractID, ok := contractObligationGenericResourcePath(method, path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if contractID, ok := contractBillingScheduleGenericResourcePath(method, path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if contractID, _, ok := contractProjectLinkPath(path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		_, linkID, _ := contractProjectLinkPath(path)
		return a.handleContractProjectLinkRuntime(ctx, method, contractID, linkID, query, scopedBody)
	}
	if contractID, ok := contractDeliveryAssetPlanGenericResourcePath(method, path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if contractID, ok := contractServiceAgreementGenericResourcePath(method, path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if contractID, ok := contractStageGenericResourcePath(method, path); ok {
		if err := a.requireParentContractScope(ctx, contractID, method, query, scopedBody); err != nil {
			return nil, "", err
		}
		return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
	}
	if method == http.MethodPost && path == "/v1/altoc/leads" {
		if err := altocRequireActionScope(scopedBody, "lead", "create"); err != nil {
			return nil, "", err
		}
		data, err := a.createLead(ctx, scopedBody)
		return runtimeOK(data), "altoc.leads.create", err
	}
	if method == http.MethodPost && path == "/v1/altoc/opportunities" {
		if err := altocRequireActionScope(scopedBody, "opportunity", "create"); err != nil {
			return nil, "", err
		}
		data, err := a.createOpportunity(ctx, scopedBody)
		return runtimeOK(data), "altoc.opportunities.create", err
	}
	if method == http.MethodGet {
		if response, operation, matched, err := a.handleRuntimeGet(ctx, path, query); matched {
			return response, operation, err
		}
	}
	if method == http.MethodPut || method == http.MethodPatch {
		if response, operation, matched, err := a.handleRuntimeUpdate(ctx, path, scopedBody); matched {
			return response, operation, err
		}
	}
	if method == http.MethodPost {
		if response, operation, matched, err := a.handleRuntimePost(ctx, path, scopedBody); matched {
			return response, operation, err
		}
	}
	if method == http.MethodDelete {
		if response, operation, matched, err := a.handleRuntimeDelete(ctx, path, scopedBody); matched {
			return response, operation, err
		}
	}
	if err := requireGenericRuntimeActionScope(method, path, query, scopedBody); err != nil {
		return nil, "", err
	}
	if serviceTicketGenericMutation(method, path) {
		return a.handleServiceTicketGenericMutation(ctx, method, path, query, scopedBody)
	}
	return a.Adapter.HandleRuntime(ctx, method, path, query, scopedBody)
}

func (a *Adapter) handleRuntimeGet(ctx context.Context, path string, query url.Values) (any, string, bool, error) {
	if response, operation, matched, err := a.handleDashboardGet(ctx, path, query); matched {
		return response, operation, true, err
	}
	if path == "/v1/altoc/teams" {
		data, err := a.listSalesTeams(ctx, query)
		return runtimeOK(data), "altoc.teams.list", true, err
	}
	if path == "/v1/altoc/teams/users" {
		data, err := a.listSalesTeamUsers(ctx, query)
		return runtimeOK(data), "altoc.teams.users", true, err
	}
	if teamID, ok := pathParam(path, "/v1/altoc/teams/", ""); ok {
		data, err := a.getSalesTeam(ctx, unescapePathParam(teamID))
		return runtimeOK(data), "altoc.teams.get", true, err
	}
	if customerID, ok := pathParam(path, "/v1/altoc/customers/", ""); ok {
		data, err := a.getCustomerScoped(ctx, unescapePathParam(customerID), query)
		return runtimeOK(data), "altoc.customers.get", true, err
	}
	if path == "/v1/altoc/opportunities" {
		data, err := a.listOpportunities(ctx, query)
		return runtimeOK(data), "altoc.opportunities.list", true, err
	}
	if path == "/v1/altoc/tenders" {
		data, err := a.listTenders(ctx, query)
		return runtimeOK(data), "altoc.tenders.list", true, err
	}
	if path == "/v1/altoc/tenders/agencies" {
		data, err := a.listTenderAgencies(ctx, query)
		return runtimeOK(data), "altoc.tenders.agencies.list", true, err
	}
	if path == "/v1/altoc/documents" {
		data, err := a.listDocumentLinks(ctx, query)
		return runtimeOK(data), "altoc.documents.list", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", "/activities"); ok {
		data, err := a.listOpportunityActivities(ctx, unescapePathParam(opportunityID), query)
		return runtimeOK(data), "altoc.opportunities.activities.list", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", "/contact-roles"); ok {
		data, err := a.listOpportunityContactRoles(ctx, unescapePathParam(opportunityID), query)
		return runtimeOK(data), "altoc.opportunities.contact_roles.list", true, err
	}
	if opportunityID, roleID, ok := opportunityContactRolePath(path); ok {
		data, err := a.getOpportunityContactRole(ctx, opportunityID, roleID, query)
		return runtimeOK(data), "altoc.opportunities.contact_roles.get", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", "/conversion-preview"); ok {
		data, err := a.leadConversionCandidates(ctx, unescapePathParam(leadID), query)
		return runtimeOK(data), "altoc.leads.conversion_preview", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", "/conversion-candidates"); ok {
		data, err := a.leadConversionCandidates(ctx, unescapePathParam(leadID), query)
		return runtimeOK(data), "altoc.leads.conversion_candidates", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", ""); ok {
		data, err := a.getLead(ctx, leadID, query)
		return runtimeOK(data), "altoc.leads.get", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", ""); ok {
		data, err := a.getOpportunity(ctx, opportunityID, query)
		return runtimeOK(data), "altoc.opportunities.get", true, err
	}
	if tenderID, ok := pathParam(path, "/v1/altoc/tenders/", ""); ok {
		data, err := a.getTender(ctx, unescapePathParam(tenderID), query)
		return runtimeOK(data), "altoc.tenders.get", true, err
	}
	if documentLinkID, ok := pathParam(path, "/v1/altoc/documents/", ""); ok {
		data, err := a.getDocumentLink(ctx, unescapePathParam(documentLinkID), query)
		return runtimeOK(data), "altoc.documents.get", true, err
	}
	if path == "/v1/altoc/contracts" {
		data, err := a.listContracts(ctx, query)
		return runtimeOK(data), "altoc.contracts.list", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/invoices"); ok {
		data, err := a.listContractInvoices(ctx, contractID, query)
		return runtimeOK(data), "altoc.contracts.invoices.list", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/activation-plan"); ok {
		data, err := a.contractActivationPlan(ctx, unescapePathParam(contractID), query)
		return runtimeOK(data), "altoc.contracts.activation_plan", true, err
	}
	if contractID, jobID, ok := contractActivationJobPath(path); ok {
		data, err := a.getContractActivationJob(ctx, contractID, jobID, query)
		return runtimeOK(data), "altoc.contracts.activation.jobs.get", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", ""); ok {
		data, err := a.getContractScoped(ctx, contractID, query)
		return runtimeOK(data), "altoc.contracts.get", true, err
	}
	if path == "/v1/altoc/payments" {
		data, err := a.listReceivablePlans(ctx, query)
		return runtimeOK(data), "altoc.payments.list", true, err
	}
	if paymentID, ok := pathParam(path, "/v1/altoc/payments/", ""); ok {
		data, err := a.getReceivablePlanScoped(ctx, paymentID, query)
		return runtimeOK(data), "altoc.payments.get", true, err
	}
	if customerCode, ok := pathParam(path, "/v1/altoc/service/customers/", "/maintenance-summary"); ok {
		data, err := a.customerMaintenanceSummary(ctx, unescapePathParam(customerCode), query)
		return runtimeOK(data), "altoc.service.customers.maintenance_summary", true, err
	}
	if response, operation, matched, err := a.handleServiceAgreementCoverageGet(ctx, path, query); matched {
		return response, operation, true, err
	}
	if response, operation, matched, err := a.handleServiceAgreementProjectGet(ctx, path, query); matched {
		return response, operation, true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) handleDashboardGet(ctx context.Context, path string, query url.Values) (any, string, bool, error) {
	if !isDashboardRuntimePath(path) {
		return nil, "", false, nil
	}
	if err := requireDashboardViewScope(query); err != nil {
		return nil, "", true, err
	}
	if path == "/v1/altoc/dashboard/kpis" {
		data, err := a.dashboardKPIs(ctx, query)
		return runtimeOK(data), "altoc.dashboard.kpis", true, err
	}
	if path == "/v1/altoc/dashboard/funnel" {
		data, err := a.dashboardFunnel(ctx, query)
		return runtimeOK(data), "altoc.dashboard.funnel", true, err
	}
	if path == "/v1/altoc/dashboard/forecast" {
		data, err := a.dashboardForecast(ctx, query)
		return runtimeOK(data), "altoc.dashboard.forecast", true, err
	}
	if path == "/v1/altoc/dashboard/receivables" {
		data, err := a.dashboardReceivables(ctx, query)
		return runtimeOK(data), "altoc.dashboard.receivables", true, err
	}
	if path == "/v1/altoc/dashboard/summary" {
		data, err := a.dashboardSummary(ctx, query)
		return runtimeOK(data), "altoc.dashboard.summary", true, err
	}
	if path == "/v1/altoc/dashboard/sales-insights" {
		data, err := a.dashboardSalesInsights(ctx, query)
		return runtimeOK(data), "altoc.dashboard.sales_insights", true, err
	}
	return nil, "", false, httperror.New(http.StatusNotFound, "record_not_found", "dashboard route not found")
}

func isDashboardRuntimePath(path string) bool {
	switch path {
	case "/v1/altoc/dashboard/kpis",
		"/v1/altoc/dashboard/funnel",
		"/v1/altoc/dashboard/forecast",
		"/v1/altoc/dashboard/receivables",
		"/v1/altoc/dashboard/summary",
		"/v1/altoc/dashboard/sales-insights":
		return true
	default:
		return false
	}
}

func requireDashboardViewScope(query url.Values) error {
	return altocRequireActionScope(altocRuntimeBodyFromQuery(query), "dashboard", "view")
}

func requireRuntimeViewScope(path string, query url.Values) error {
	resource, ok := runtimeViewScopeResource(path)
	if !ok {
		return nil
	}
	return altocRequireActionScope(altocRuntimeBodyFromQuery(query), resource, "view")
}

func runtimeViewScopeResource(path string) (string, bool) {
	const prefix = "/v1/altoc/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) == 0 || parts[0] == "" || parts[0] == "dashboard" || parts[0] == "config" || parts[0] == "documents" {
		return "", false
	}
	if parts[0] == "service" {
		if len(parts) >= 2 && parts[1] == "customers" {
			return "customer", true
		}
		return "", false
	}
	switch parts[0] {
	case "customers":
		return "customer", true
	case "leads":
		return "lead", true
	case "opportunities":
		return "opportunity", true
	case "quotes":
		return "quotation", true
	case "tenders":
		return "quotation", true
	case "contracts":
		return "contract", true
	case "contract-obligations":
		return "contract", true
	case "payments":
		return "receivable", true
	case "maintenance-contracts":
		return "maintenance_contract", true
	case "service-entitlements":
		return "service_entitlement", true
	case "service-tickets":
		return "service_ticket", true
	case "renewal-opportunities":
		return "renewal_opportunity", true
	case "teams", "audit-logs":
		return "admin", true
	default:
		return "", false
	}
}

func (a *Adapter) handleRuntimeUpdate(ctx context.Context, path string, body map[string]any) (any, string, bool, error) {
	if path == "/v1/altoc/config/dict" {
		data, err := a.updateConfigDict(ctx, body)
		return runtimeOK(data), "altoc.config.dict.update", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/draft"); ok {
		data, err := a.updateContractDraft(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.contracts.draft.update", true, err
	}
	if contractID, lineID, ok := contractLinePath(path); ok && lineID != "" {
		data, err := a.updateContractLine(ctx, contractID, lineID, body)
		return runtimeOK(data), "altoc.contracts.lines.update", true, err
	}
	if opportunityID, roleID, ok := opportunityContactRolePath(path); ok {
		data, err := a.updateOpportunityContactRole(ctx, opportunityID, roleID, body)
		return runtimeOK(data), "altoc.opportunities.contact_roles.update", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", ""); ok {
		data, err := a.updateLeadDetails(ctx, unescapePathParam(leadID), body)
		return runtimeOK(data), "altoc.leads.update", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", ""); ok {
		data, err := a.updateOpportunityDetails(ctx, unescapePathParam(opportunityID), body)
		return runtimeOK(data), "altoc.opportunities.update", true, err
	}
	if tenderID, ok := pathParam(path, "/v1/altoc/tenders/", "/milestones"); ok {
		data, err := a.updateTenderMilestone(ctx, unescapePathParam(tenderID), body)
		return runtimeOK(data), "altoc.tenders.milestones.update", true, err
	}
	if tenderID, ok := pathParam(path, "/v1/altoc/tenders/", ""); ok {
		data, err := a.updateTender(ctx, unescapePathParam(tenderID), body)
		return runtimeOK(data), "altoc.tenders.update", true, err
	}
	if paymentID, ok := pathParam(path, "/v1/altoc/payments/", ""); ok {
		data, err := a.updateReceivablePlan(ctx, paymentID, body)
		return runtimeOK(data), "altoc.payments.update", true, err
	}
	if teamID, ok := pathParam(path, "/v1/altoc/teams/", ""); ok {
		data, err := a.updateSalesTeam(ctx, unescapePathParam(teamID), body)
		return runtimeOK(data), "altoc.teams.update", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) handleRuntimePost(ctx context.Context, path string, body map[string]any) (any, string, bool, error) {
	if path == "/v1/altoc/config/dict" {
		data, err := a.createConfigDict(ctx, body)
		return runtimeOK(data), "altoc.config.dict.create", true, err
	}
	if path == "/v1/altoc/contracts/drafts" {
		data, err := a.createContractDraft(ctx, body)
		return runtimeOK(data), "altoc.contracts.drafts.create", true, err
	}
	if path == "/v1/altoc/contracts/from-quotation" {
		data, err := a.createContractFromQuotation(ctx, body)
		return runtimeOK(data), "altoc.contracts.from_quotation", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/validate"); ok {
		data, err := a.validateContractDraft(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.contracts.validate", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/activation-plan/preview"); ok {
		data, err := a.contractActivationPlanFromBody(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.contracts.activation_plan.preview", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/activation/execute"); ok {
		data, err := a.executeContractActivation(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.contracts.activation.execute", true, err
	}
	if contractID, jobID, ok := contractActivationJobCommandPath(path, "retry"); ok {
		data, err := a.retryContractActivationJob(ctx, contractID, jobID, body)
		return runtimeOK(data), "altoc.contracts.activation.jobs.retry", true, err
	}
	if contractID, jobID, ok := contractActivationJobCommandPath(path, "cancel"); ok {
		data, err := a.cancelContractActivationJob(ctx, contractID, jobID, body)
		return runtimeOK(data), "altoc.contracts.activation.jobs.cancel", true, err
	}
	if contractID, jobID, stepKey, ok := contractActivationStepResultPath(path); ok {
		data, err := a.recordContractActivationStepResult(ctx, contractID, jobID, stepKey, body)
		return runtimeOK(data), "altoc.contracts.activation.steps.result", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/submit"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), bodyWithRuntimeAction(body, "submit"))
		return runtimeOK(data), "altoc.contracts.submit", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/withdraw"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), bodyWithRuntimeAction(body, "withdraw"))
		return runtimeOK(data), "altoc.contracts.withdraw", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/mark-signed"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), bodyWithRuntimeAction(body, "mark_signed"))
		return runtimeOK(data), "altoc.contracts.mark_signed", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/fulfillment/close"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), bodyWithRuntimeAction(body, "close_fulfillment"))
		return runtimeOK(data), "altoc.contracts.fulfillment.close", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/suspend"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), bodyWithRuntimeAction(body, "suspend"))
		return runtimeOK(data), "altoc.contracts.suspend", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/terminate"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), bodyWithRuntimeAction(body, "terminate"))
		return runtimeOK(data), "altoc.contracts.terminate", true, err
	}
	if obligationID, action, ok := contractObligationActionPath(path); ok {
		data, err := a.changeContractObligationStatus(ctx, obligationID, bodyWithRuntimeAction(body, action))
		return runtimeOK(data), "altoc.contract_obligations." + strings.ReplaceAll(action, "_", "-"), true, err
	}
	if contractID, lineID, ok := contractLinePath(path); ok && lineID == "" {
		data, err := a.createContractLine(ctx, contractID, body)
		return runtimeOK(data), "altoc.contracts.lines.create", true, err
	}
	if path == "/v1/altoc/documents" {
		data, err := a.createDocumentLink(ctx, body)
		return runtimeOK(data), "altoc.documents.create", true, err
	}
	if path == "/v1/altoc/teams" {
		data, err := a.createSalesTeam(ctx, body)
		return runtimeOK(data), "altoc.teams.create", true, err
	}
	if path == "/v1/altoc/tenders" {
		data, err := a.createTender(ctx, body)
		return runtimeOK(data), "altoc.tenders.create", true, err
	}
	if path == "/v1/altoc/tenders/agencies" {
		data, err := a.createTenderAgency(ctx, body)
		return runtimeOK(data), "altoc.tenders.agencies.create", true, err
	}
	if tenderID, ok := pathParam(path, "/v1/altoc/tenders/", "/milestones"); ok {
		data, err := a.createTenderMilestone(ctx, unescapePathParam(tenderID), body)
		return runtimeOK(data), "altoc.tenders.milestones.create", true, err
	}
	if tenderID, ok := pathParam(path, "/v1/altoc/tenders/", "/members"); ok {
		data, err := a.addTenderMember(ctx, unescapePathParam(tenderID), body)
		return runtimeOK(data), "altoc.tenders.members.create", true, err
	}
	if teamID, ok := pathParam(path, "/v1/altoc/teams/", "/members"); ok {
		data, err := a.addSalesTeamMember(ctx, unescapePathParam(teamID), body)
		return runtimeOK(data), "altoc.teams.members.create", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", "/assign"); ok {
		data, err := a.assignLead(ctx, unescapePathParam(leadID), body)
		return runtimeOK(data), "altoc.leads.assign", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", "/disqualify"); ok {
		data, err := a.disqualifyLead(ctx, unescapePathParam(leadID), body)
		return runtimeOK(data), "altoc.leads.disqualify", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", "/convert"); ok {
		data, err := a.convertLead(ctx, unescapePathParam(leadID), body)
		return runtimeOK(data), "altoc.leads.convert", true, err
	}
	if leadID, ok := pathParam(path, "/v1/altoc/leads/", "/activities"); ok {
		data, err := a.createLeadActivity(ctx, unescapePathParam(leadID), body)
		return runtimeOK(data), "altoc.leads.activities.create", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", "/assign"); ok {
		data, err := a.assignOpportunity(ctx, unescapePathParam(opportunityID), body)
		return runtimeOK(data), "altoc.opportunities.assign", true, err
	}
	if path == "/v1/altoc/opportunities/scan-stale" {
		data, err := a.scanStaleOpportunities(ctx, body)
		return runtimeOK(data), "altoc.opportunities.scan_stale", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", "/transition"); ok {
		data, err := a.transitionOpportunity(ctx, unescapePathParam(opportunityID), body)
		return runtimeOK(data), "altoc.opportunities.transition", true, err
	}
	if opportunityID, action, ok := opportunityTransitionActionPath(path); ok {
		data, err := a.transitionOpportunity(ctx, opportunityID, bodyWithRuntimeAction(body, action))
		return runtimeOK(data), "altoc.opportunities." + strings.ReplaceAll(action, "_", "-"), true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", "/activities"); ok {
		data, err := a.createOpportunityActivity(ctx, unescapePathParam(opportunityID), body)
		return runtimeOK(data), "altoc.opportunities.activities.create", true, err
	}
	if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", "/contact-roles"); ok {
		data, err := a.createOpportunityContactRole(ctx, unescapePathParam(opportunityID), body)
		return runtimeOK(data), "altoc.opportunities.contact_roles.create", true, err
	}
	if quotationID, ok := pathParam(path, "/v1/altoc/quotes/", "/approve"); ok {
		data, err := a.approveQuotation(ctx, unescapePathParam(quotationID), body)
		return runtimeOK(data), "altoc.quotes.approve", true, err
	}
	if quotationID, ok := pathParam(path, "/v1/altoc/quotes/", "/status"); ok {
		data, err := a.changeQuotationStatus(ctx, unescapePathParam(quotationID), body)
		return runtimeOK(data), "altoc.quotes.status", true, err
	}
	if contractID, stageID, ok := contractStagePath(path); ok && stageID == "" {
		data, err := a.completeContractStage(ctx, contractID, body)
		return runtimeOK(data), "altoc.contracts.stages.complete", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/approve"); ok {
		data, err := a.approveContract(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.contracts.approve", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/status"); ok {
		data, err := a.changeContractStatus(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.contracts.status", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/contracts/", "/management"); ok {
		data, err := a.manageContract(ctx, contractID, body)
		return runtimeOK(data), "altoc.contracts.management", true, err
	}
	if paymentID, ok := pathParam(path, "/v1/altoc/payments/", "/confirm"); ok {
		data, err := a.confirmReceivablePayment(ctx, paymentID, body)
		return runtimeOK(data), "altoc.payments.confirm", true, err
	}
	if path == "/v1/altoc/payments/scan-overdue" {
		data, err := a.scanOverdueReceivablePlans(ctx, body)
		return runtimeOK(data), "altoc.payments.scan_overdue", true, err
	}
	if contractCode, ok := pathParam(path, "/v1/altoc/service/contracts/", "/activate-delivery"); ok {
		data, err := a.activateContractDelivery(ctx, unescapePathParam(contractCode), body)
		return runtimeOK(data), "altoc.service.contracts.activate_delivery", true, err
	}
	if contractCode, ok := pathParam(path, "/v1/altoc/service/contracts/", "/finance-summary:sync"); ok {
		data, err := a.syncContractFinanceSummary(ctx, unescapePathParam(contractCode), body)
		return runtimeOK(data), "altoc.service.contracts.finance_summary.sync", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/service/contracts/", "/invoice-request:prepare"); ok {
		data, err := a.prepareContractInvoiceRequest(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.service.contracts.invoice_request.prepare", true, err
	}
	if contractID, ok := pathParam(path, "/v1/altoc/service/contracts/", "/invoice-request:record"); ok {
		data, err := a.recordContractInvoiceRequest(ctx, unescapePathParam(contractID), body)
		return runtimeOK(data), "altoc.service.contracts.invoice_request.record", true, err
	}
	if customerID, ok := pathParam(path, "/v1/altoc/customers/", "/invoice-info:save"); ok {
		data, err := a.saveCustomerInvoiceInfo(ctx, unescapePathParam(customerID), body)
		return runtimeOK(data), "altoc.customers.invoice_info.save", true, err
	}
	if customerID, ok := pathParam(path, "/v1/altoc/service/customers/", "/invoice-info:save"); ok {
		data, err := a.saveCustomerInvoiceInfo(ctx, unescapePathParam(customerID), body)
		return runtimeOK(data), "altoc.service.customers.invoice_info.save", true, err
	}
	if receivablePlanCode, ok := pathParam(path, "/v1/altoc/service/receivable-plans/", "/mark-billable"); ok {
		data, err := a.markReceivablePlanBillable(ctx, unescapePathParam(receivablePlanCode), body)
		return runtimeOK(data), "altoc.service.receivable_plans.mark_billable", true, err
	}
	if receivablePlanCode, ok := pathParam(path, "/v1/altoc/service/receivable-plans/", "/invoice-request:prepare"); ok {
		data, err := a.prepareReceivablePlanInvoiceRequest(ctx, unescapePathParam(receivablePlanCode), body)
		return runtimeOK(data), "altoc.service.receivable_plans.invoice_request.prepare", true, err
	}
	if receivablePlanCode, ok := pathParam(path, "/v1/altoc/service/receivable-plans/", "/invoice-request:record"); ok {
		data, err := a.recordReceivablePlanInvoiceRequest(ctx, unescapePathParam(receivablePlanCode), body)
		return runtimeOK(data), "altoc.service.receivable_plans.invoice_request.record", true, err
	}
	if paymentTermID, ok := pathParam(path, "/v1/altoc/service/payment-terms/", "/receivable-plan:mark-billable"); ok {
		data, err := a.markReceivablePlansBillableByPaymentTerm(ctx, unescapePathParam(paymentTermID), body)
		return runtimeOK(data), "altoc.service.payment_terms.receivable_plan.mark_billable", true, err
	}
	if deliveryAssetCode, ok := pathParam(path, "/v1/altoc/service/customer-delivery-assets/", "/status:sync"); ok {
		data, err := a.syncCustomerDeliveryAssetStatus(ctx, unescapePathParam(deliveryAssetCode), body)
		return runtimeOK(data), "altoc.service.customer_delivery_assets.status.sync", true, err
	}
	if ticketCode, ok := pathParam(path, "/v1/altoc/service/service-tickets/", "/delivery-result:sync"); ok {
		data, err := a.syncServiceTicketDeliveryResult(ctx, unescapePathParam(ticketCode), body)
		return runtimeOK(data), "altoc.service.service_tickets.delivery_result.sync", true, err
	}
	if response, operation, matched, err := a.handleServiceAgreementCoveragePost(ctx, path, body); matched {
		return response, operation, true, err
	}
	if response, operation, matched, err := a.handleServiceAgreementProjectPost(ctx, path, body); matched {
		return response, operation, true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) handleRuntimeDelete(ctx context.Context, path string, body map[string]any) (any, string, bool, error) {
	if path == "/v1/altoc/config/dict" {
		data, err := a.disableConfigDict(ctx, body)
		return runtimeOK(data), "altoc.config.dict.disable", true, err
	}
	if contractID, lineID, ok := contractLinePath(path); ok && lineID != "" {
		data, err := a.deleteContractLine(ctx, contractID, lineID, body)
		return runtimeOK(data), "altoc.contracts.lines.delete", true, err
	}
	if documentLinkID, ok := pathParam(path, "/v1/altoc/documents/", ""); ok {
		data, err := a.deleteDocumentLink(ctx, unescapePathParam(documentLinkID), body)
		return runtimeOK(data), "altoc.documents.delete", true, err
	}
	if teamID, ok := pathParam(path, "/v1/altoc/teams/", "/members"); ok {
		data, err := a.removeSalesTeamMember(ctx, unescapePathParam(teamID), body)
		return runtimeOK(data), "altoc.teams.members.delete", true, err
	}
	if opportunityID, roleID, ok := opportunityContactRolePath(path); ok {
		data, err := a.deleteOpportunityContactRole(ctx, opportunityID, roleID, body)
		return runtimeOK(data), "altoc.opportunities.contact_roles.delete", true, err
	}
	if tenderID, ok := pathParam(path, "/v1/altoc/tenders/", "/members"); ok {
		data, err := a.removeTenderMember(ctx, unescapePathParam(tenderID), body)
		return runtimeOK(data), "altoc.tenders.members.delete", true, err
	}
	return nil, "", false, nil
}

func runtimeOK(data any) map[string]any {
	return map[string]any{"code": 0, "message": "ok", "data": data}
}

func pathParam(path string, prefix string, suffix string) (string, bool) {
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	value := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if value == "" || strings.Contains(value, "/") {
		return "", false
	}
	return value, true
}

func unescapePathParam(value string) string {
	unescaped, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return unescaped
}

func opportunityContactRolePath(path string) (string, string, bool) {
	const prefix = "/v1/altoc/opportunities/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "contact-roles" || parts[2] == "" {
		return "", "", false
	}
	return unescapePathParam(parts[0]), unescapePathParam(parts[2]), true
}

func customerContactPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/customers/", "contacts")
}

func customerInvoiceInfoPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/customers/", "invoice-infos")
}

func opportunityActivityPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/opportunities/", "activities")
}

func opportunityActivityGenericResourcePath(method string, path string) (string, bool) {
	opportunityID, activityID, ok := opportunityActivityPath(path)
	if !ok {
		return "", false
	}
	if activityID != "" || (method != http.MethodGet && method != http.MethodPost) {
		return opportunityID, true
	}
	return "", false
}

func quotationItemPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/quotes/", "items")
}

func contractStagePath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "stages")
}

func contractLinePath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "lines")
}

func contractObligationPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "obligations")
}

func contractBillingSchedulePath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "billing-schedules")
}

func contractProjectLinkPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "project-links")
}

func contractDeliveryAssetPlanPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "delivery-asset-plans")
}

func contractServiceAgreementPath(path string) (string, string, bool) {
	return altocNestedPath(path, "/v1/altoc/contracts/", "service-agreements")
}

func contractObligationGenericResourcePath(method string, path string) (string, bool) {
	contractID, obligationID, ok := contractObligationPath(path)
	if !ok {
		return "", false
	}
	if method == http.MethodGet || obligationID != "" {
		return contractID, true
	}
	return "", false
}

func contractBillingScheduleGenericResourcePath(method string, path string) (string, bool) {
	contractID, scheduleID, ok := contractBillingSchedulePath(path)
	if !ok {
		return "", false
	}
	if method == http.MethodGet || scheduleID != "" {
		return contractID, true
	}
	return "", false
}

func contractDeliveryAssetPlanGenericResourcePath(method string, path string) (string, bool) {
	contractID, assetID, ok := contractDeliveryAssetPlanPath(path)
	if !ok {
		return "", false
	}
	if method == http.MethodGet || assetID != "" {
		return contractID, true
	}
	return "", false
}

func contractServiceAgreementGenericResourcePath(method string, path string) (string, bool) {
	contractID, agreementID, ok := contractServiceAgreementPath(path)
	if !ok {
		return "", false
	}
	if method == http.MethodGet || agreementID != "" {
		return contractID, true
	}
	return "", false
}

func contractObligationActionPath(path string) (string, string, bool) {
	const prefix = "/v1/altoc/contract-obligations/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	switch parts[1] {
	case "start", "submit", "accept", "reject":
		return unescapePathParam(parts[0]), parts[1], true
	default:
		return "", "", false
	}
}

func contractStageGenericResourcePath(method string, path string) (string, bool) {
	contractID, stageID, ok := contractStagePath(path)
	if !ok {
		return "", false
	}
	if method == http.MethodPost && stageID == "" {
		return "", false
	}
	return contractID, true
}

func contractActivationJobPath(path string) (string, string, bool) {
	const prefix = "/v1/altoc/contracts/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) == 4 && parts[0] != "" && parts[1] == "activation" && parts[2] == "jobs" && parts[3] != "" {
		return unescapePathParam(parts[0]), unescapePathParam(parts[3]), true
	}
	return "", "", false
}

func contractActivationJobCommandPath(path string, command string) (string, string, bool) {
	const prefix = "/v1/altoc/contracts/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) == 5 && parts[0] != "" && parts[1] == "activation" && parts[2] == "jobs" && parts[3] != "" && parts[4] == command {
		return unescapePathParam(parts[0]), unescapePathParam(parts[3]), true
	}
	return "", "", false
}

func contractActivationStepResultPath(path string) (string, string, string, bool) {
	const prefix = "/v1/altoc/contracts/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) == 7 && parts[0] != "" && parts[1] == "activation" && parts[2] == "jobs" && parts[3] != "" && parts[4] == "steps" && parts[5] != "" && parts[6] == "result" {
		return unescapePathParam(parts[0]), unescapePathParam(parts[3]), unescapePathParam(parts[5]), true
	}
	return "", "", "", false
}

func opportunityTransitionActionPath(path string) (string, string, bool) {
	for _, item := range []struct {
		suffix string
		action string
	}{
		{suffix: "/close-won", action: "close_won"},
		{suffix: "/close-lost", action: "close_lost"},
		{suffix: "/pause", action: "pause"},
		{suffix: "/reopen", action: "reopen"},
	} {
		if opportunityID, ok := pathParam(path, "/v1/altoc/opportunities/", item.suffix); ok {
			return unescapePathParam(opportunityID), item.action, true
		}
	}
	return "", "", false
}

func bodyWithRuntimeAction(body map[string]any, action string) map[string]any {
	next := make(map[string]any, len(body)+1)
	for key, value := range body {
		next[key] = value
	}
	next["action"] = action
	return next
}

func altocNestedPath(path string, prefix string, resource string) (string, string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) == 2 && parts[0] != "" && parts[1] == resource {
		return unescapePathParam(parts[0]), "", true
	}
	if len(parts) == 3 && parts[0] != "" && parts[1] == resource && parts[2] != "" {
		return unescapePathParam(parts[0]), unescapePathParam(parts[2]), true
	}
	return "", "", false
}

func (a *Adapter) requireParentCustomerScope(ctx context.Context, rawCustomerID string, method string, query url.Values, body map[string]any) error {
	customerID, err := altocIdentifierID(rawCustomerID, "customer_id")
	if err != nil {
		return err
	}
	customer, err := a.parentScopedRecord(ctx, "customer", "cu", customerID, "customer", query, body)
	if err != nil {
		return err
	}
	if altocIsReadMethod(method) {
		return nil
	}
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	if err := altocRequireActionScope(scopeBody, "customer", "edit"); err != nil {
		return err
	}
	return altocRequireRecordWrite(scopeBody, "customer", customer, "owner_user_id", "owner_dept_code")
}

func (a *Adapter) requireParentOpportunityScope(ctx context.Context, rawOpportunityID string, method string, query url.Values, body map[string]any) error {
	opportunityID, err := altocIdentifierID(rawOpportunityID, "opportunity_id")
	if err != nil {
		return err
	}
	opportunity, err := a.parentScopedRecord(ctx, "opportunity", "op", opportunityID, "opportunity", query, body)
	if err != nil {
		return err
	}
	if altocIsReadMethod(method) {
		return nil
	}
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	if err := altocRequireActionScope(scopeBody, "opportunity", "edit"); err != nil {
		return err
	}
	return altocRequireRecordWrite(scopeBody, "opportunity", opportunity, "owner_user_id", "owner_dept_code")
}

func (a *Adapter) requireParentQuotationScope(ctx context.Context, rawQuotationID string, method string, query url.Values, body map[string]any) error {
	quotationID, err := altocIdentifierID(rawQuotationID, "quotation_id")
	if err != nil {
		return err
	}
	quotation, err := a.parentScopedRecord(ctx, "quotation", "q", quotationID, "quotation", query, body)
	if err != nil {
		return err
	}
	if altocIsReadMethod(method) {
		return nil
	}
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	if err := altocRequireActionScope(scopeBody, "quotation", "edit"); err != nil {
		return err
	}
	return altocRequireRecordWrite(scopeBody, "quotation", quotation, "owner_user_id", "owner_dept_code")
}

func (a *Adapter) requireParentContractScope(ctx context.Context, rawContractID string, method string, query url.Values, body map[string]any) error {
	contractID, err := altocIdentifierID(rawContractID, "contract_id")
	if err != nil {
		return err
	}
	contract, err := a.parentScopedRecord(ctx, "contract", "ct", contractID, "contract", query, body)
	if err != nil {
		return err
	}
	if altocIsReadMethod(method) {
		return nil
	}
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	if err := altocRequireActionScope(scopeBody, "contract", "edit"); err != nil {
		return err
	}
	return altocRequireRecordWrite(scopeBody, "contract", contract, "owner_user_id", "owner_dept_code")
}

func (a *Adapter) parentScopedRecord(ctx context.Context, table string, alias string, id int64, resource string, query url.Values, body map[string]any) (map[string]any, error) {
	where := []string{alias + ".id = ?", alias + ".deleted_at IS NULL"}
	args := []any{id}
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(scopeBody, resource, alias, "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	record, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT `+alias+`.*
		FROM `+table+` `+alias+`
		WHERE `+strings.Join(where, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, httperror.New(http.StatusNotFound, resource+"_not_found", resource+" not found")
	}
	return record, nil
}

func altocIsReadMethod(method string) bool {
	return method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions
}

func requireGenericRuntimeActionScope(method string, path string, query url.Values, body map[string]any) error {
	if altocIsReadMethod(method) {
		return nil
	}
	resource, ok := genericRuntimeActionResource(path)
	if !ok {
		return nil
	}
	scopeBody := altocRuntimeBodyFromRequest(query, body)
	return altocRequireActionScope(scopeBody, resource, genericRuntimeAction(method, resource, body))
}

func genericRuntimeAction(method string, resource string, body map[string]any) string {
	if resource == "service_ticket" && (method == http.MethodPatch || method == http.MethodPut) && serviceTicketGenericCommand(body) == "closed" {
		return "close"
	}
	if method == http.MethodPost {
		return "create"
	}
	if method == http.MethodDelete {
		return "delete"
	}
	return "edit"
}

func serviceTicketGenericCommand(body map[string]any) string {
	status := strings.ToLower(strings.TrimSpace(firstNonEmptyText(
		firstBodyText(body, "action"),
		firstBodyText(body, "status"),
		firstBodyText(body, "ticketStatus", "ticket_status"),
		firstBodyText(body, "deliveryStatus", "delivery_status"),
		firstBodyText(body, "workItemStatus", "work_item_status"),
	)))
	switch status {
	case "close", "closed":
		return "closed"
	default:
		return status
	}
}

func genericRuntimeActionResource(path string) (string, bool) {
	const prefix = "/v1/altoc/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) == 0 || parts[0] == "" || parts[0] == "service" || parts[0] == "config" || parts[0] == "dashboard" {
		return "", false
	}
	if len(parts) > 2 || (len(parts) == 2 && parts[1] == "") {
		return "", false
	}
	if len(parts) == 2 {
		switch parts[0] + "/" + parts[1] {
		case "opportunities/scan-stale",
			"opportunities/close-won",
			"opportunities/close-lost",
			"opportunities/pause",
			"opportunities/reopen",
			"payments/scan-overdue":
			return "", false
		}
	}
	switch parts[0] {
	case "customers":
		return "customer", true
	case "leads":
		return "lead", true
	case "opportunities":
		return "opportunity", true
	case "quotes":
		return "quotation", true
	case "tenders":
		return "quotation", true
	case "contracts":
		return "contract", true
	case "payments":
		return "receivable", true
	case "maintenance-contracts":
		return "maintenance_contract", true
	case "service-entitlements":
		return "service_entitlement", true
	case "service-tickets":
		return "service_ticket", true
	case "renewal-opportunities":
		return "renewal_opportunity", true
	case "teams":
		return "admin", true
	default:
		return "", false
	}
}
