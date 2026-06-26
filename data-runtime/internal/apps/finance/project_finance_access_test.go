package finance

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestProjectFinanceListAccessFiltersProjectCodes(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")

	where := []string{}
	args := []any{}
	applyProjectFinanceListAccess(&where, &args, query)

	if got := strings.Join(where, " AND "); got != "project_code IN (?, ?)" {
		t.Fatalf("where = %q, want project_code IN (?, ?)", got)
	}
	if len(args) != 2 || args[0] != "P1" || args[1] != "P2" {
		t.Fatalf("args = %#v, want P1/P2", args)
	}
}

func TestProjectFinanceListAccessWithoutCodesReturnsEmptySet(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")

	where := []string{}
	args := []any{}
	applyProjectFinanceListAccess(&where, &args, query)

	if got := strings.Join(where, " AND "); got != "1 = 0" {
		t.Fatalf("where = %q, want empty-set predicate", got)
	}
	if len(args) != 0 {
		t.Fatalf("args = %#v, want none", args)
	}
}

func TestProjectFinanceQueryAccessAllowsAuthorizedProject(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")

	if err := requireProjectFinanceQueryAccess(query, "P2"); err != nil {
		t.Fatalf("requireProjectFinanceQueryAccess returned error: %v", err)
	}
}

func TestProjectFinanceQueryAccessRejectsUnauthorizedProject(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")

	err := requireProjectFinanceQueryAccess(query, "P3")
	if err == nil {
		t.Fatal("requireProjectFinanceQueryAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceAccessAllowsServiceContext(t *testing.T) {
	if err := requireProjectFinanceQueryAccess(url.Values{}, "P1"); err != nil {
		t.Fatalf("service context should allow project finance access, got %v", err)
	}
}

func TestProjectFinanceGlobalQueryAccessRejectsProjectScopedUser(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")

	err := requireProjectFinanceGlobalQueryAccess(query)
	if err == nil {
		t.Fatal("requireProjectFinanceGlobalQueryAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceGlobalQueryAccessRejectsMissingUserScope(t *testing.T) {
	query := url.Values{}
	query.Set("current_user", "u1")

	err := requireProjectFinanceGlobalQueryAccess(query)
	if err == nil {
		t.Fatal("requireProjectFinanceGlobalQueryAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceGlobalQueryAccessAllowsAllAndServiceContext(t *testing.T) {
	allQuery := url.Values{}
	allQuery.Set("current_user_project_finance_access", "all")
	if err := requireProjectFinanceGlobalQueryAccess(allQuery); err != nil {
		t.Fatalf("all access should allow global project finance access, got %v", err)
	}
	if err := requireProjectFinanceGlobalQueryAccess(url.Values{}); err != nil {
		t.Fatalf("service context should allow global project finance access, got %v", err)
	}
}

func TestProjectFinanceBodyAccessRejectsUnauthorizedProject(t *testing.T) {
	body := jsonBody{
		"current_user_project_finance_access":        "projects",
		"current_user_project_finance_project_codes": "P1,P2",
	}

	err := requireProjectFinanceBodyAccess(body, "P3")
	if err == nil {
		t.Fatal("requireProjectFinanceBodyAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceBodyAccessAllowsAuthorizedProject(t *testing.T) {
	body := jsonBody{
		"current_user_project_finance_access":        "projects",
		"current_user_project_finance_project_codes": "P1,P2",
	}

	if err := requireProjectFinanceBodyAccess(body, "P2"); err != nil {
		t.Fatalf("requireProjectFinanceBodyAccess returned error: %v", err)
	}
}

func TestProjectFinanceGlobalBodyAccessRejectsProjectScopedUser(t *testing.T) {
	body := jsonBody{
		"current_user_project_finance_access":        "projects",
		"current_user_project_finance_project_codes": "P1,P2",
	}

	err := requireProjectFinanceGlobalBodyAccess(body)
	if err == nil {
		t.Fatal("requireProjectFinanceGlobalBodyAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceGlobalBodyAccessRejectsMissingUserScope(t *testing.T) {
	body := jsonBody{
		"current_user": "u1",
	}

	err := requireProjectFinanceGlobalBodyAccess(body)
	if err == nil {
		t.Fatal("requireProjectFinanceGlobalBodyAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceGlobalBodyAccessAllowsAllAndServiceContext(t *testing.T) {
	if err := requireProjectFinanceGlobalBodyAccess(jsonBody{"current_user_project_finance_access": "all"}); err != nil {
		t.Fatalf("all access should allow global project finance write, got %v", err)
	}
	if err := requireProjectFinanceGlobalBodyAccess(jsonBody{}); err != nil {
		t.Fatalf("service context should allow global project finance write, got %v", err)
	}
}

func TestProjectFinanceBodyProjectCodeAccessFiltersProjectCodes(t *testing.T) {
	body := jsonBody{
		"current_user_project_finance_access":        "projects",
		"current_user_project_finance_project_codes": "P1,P2",
	}
	where := []string{}
	args := []any{}

	if err := applyProjectFinanceBodyProjectCodeAccess(&where, &args, body, "metric.project_code"); err != nil {
		t.Fatalf("applyProjectFinanceBodyProjectCodeAccess returned error: %v", err)
	}

	if got := strings.Join(where, " AND "); got != "metric.project_code IN (?, ?)" {
		t.Fatalf("where = %q, want metric.project_code IN (?, ?)", got)
	}
	if len(args) != 2 || args[0] != "P1" || args[1] != "P2" {
		t.Fatalf("args = %#v, want P1/P2", args)
	}
}

func TestProjectFinanceBodyProjectCodeAccessRejectsMissingProjectCodes(t *testing.T) {
	body := jsonBody{
		"current_user_project_finance_access": "projects",
	}
	where := []string{}
	args := []any{}

	err := applyProjectFinanceBodyProjectCodeAccess(&where, &args, body, "metric.project_code")
	if err == nil {
		t.Fatal("applyProjectFinanceBodyProjectCodeAccess returned nil, want forbidden")
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("err = %T, want httperror.Error", err)
	}
	if httpErr.Status != http.StatusForbidden || httpErr.Code != "finance_project_access_denied" {
		t.Fatalf("httperror = %#v, want finance_project_access_denied forbidden", httpErr)
	}
}

func TestProjectFinanceReportProjectCodesUsesRequestedCodesForGlobalAccess(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "all")
	query.Set("project_codes", "P3,P4")

	codes, scoped := projectFinanceReportProjectCodesFromQuery(query)

	if !scoped {
		t.Fatal("expected requested project report to be scoped")
	}
	if len(codes) != 2 || codes[0] != "P3" || codes[1] != "P4" {
		t.Fatalf("codes = %#v, want P3/P4", codes)
	}
}

func TestProjectFinanceReportProjectCodesIntersectsRequestedWithAuthorizedCodes(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")
	query.Set("project_codes", "P2,P3")

	codes, scoped := projectFinanceReportProjectCodesFromQuery(query)

	if !scoped {
		t.Fatal("expected project-scoped report to be scoped")
	}
	if len(codes) != 1 || codes[0] != "P2" {
		t.Fatalf("codes = %#v, want P2", codes)
	}
}

func TestProjectFinanceReportProjectCodesKeepsServiceContextUnscoped(t *testing.T) {
	codes, scoped := projectFinanceReportProjectCodesFromQuery(url.Values{})

	if scoped {
		t.Fatalf("service context should not scope reports, got codes %#v", codes)
	}
	if len(codes) != 0 {
		t.Fatalf("codes = %#v, want none", codes)
	}
}

func TestMonthlyReportSQLAppliesProjectFilterToAllProjectSources(t *testing.T) {
	sql := monthlyReportSQL(false, 2)

	if count := strings.Count(sql, "project_code IN (?, ?)"); count != 5 {
		t.Fatalf("project_code filter count = %d, want 5\n%s", count, sql)
	}
}

func TestDashboardSummarySQLAppliesProjectFilterToProjectScopedMetrics(t *testing.T) {
	sql := dashboardSummarySQL(2, true)

	if count := strings.Count(sql, "project_code IN (?, ?)"); count != 7 {
		t.Fatalf("project_code filter count = %d, want 7\n%s", count, sql)
	}
	if !strings.Contains(sql, "0 AS bankAccountCount") {
		t.Fatalf("project-scoped dashboard should not expose global bank account count\n%s", sql)
	}
}

func TestDashboardSummarySQLKeepsGlobalBankCountForUnscopedMetrics(t *testing.T) {
	sql := dashboardSummarySQL(0, false)

	if strings.Contains(sql, "project_code IN") {
		t.Fatalf("unscoped dashboard should not include project filter\n%s", sql)
	}
	if !strings.Contains(sql, "finance_bank_account") {
		t.Fatalf("unscoped dashboard should keep bank account count query\n%s", sql)
	}
}

func TestContractSummariesSQLAppliesProjectFilterToAllFinanceSources(t *testing.T) {
	sql := contractSummariesSQL(2, 2)

	if count := strings.Count(sql, "project_code IN (?, ?)"); count != 4 {
		t.Fatalf("project_code filter count = %d, want 4\n%s", count, sql)
	}
	if !strings.Contains(sql, "summary.project_code IN (?, ?)") {
		t.Fatalf("contract summary table should be project-scoped\n%s", sql)
	}
}

func TestContractSummariesSQLPrefersLiveFinanceAggregates(t *testing.T) {
	sql := contractSummariesSQL(1, 0)

	for _, want := range []string{
		"COALESCE(invoice.invoice_amount, summary.invoice_amount, 0) AS invoice_amount",
		"COALESCE(receipt.received_amount, summary.received_amount, 0) AS received_amount",
		"COALESCE(receipt.receipt_count, summary.receipt_count, 0) AS receipt_count",
	} {
		if !strings.Contains(sql, want) {
			t.Fatalf("contract summary SQL should prefer live finance aggregate %q\n%s", want, sql)
		}
	}
}

func TestMaintenanceProjectScopedWhereUsesAuthorizedProjectsAsAndConstraint(t *testing.T) {
	query := url.Values{}
	query.Set("current_user_project_finance_access", "projects")
	query.Set("current_user_project_finance_project_codes", "P1,P2")
	query.Set("contract_codes", "C1")
	query.Set("project_codes", "P2,P3")

	scope, err := maintenanceFinancialScopeFromQuery("CUSTOMER-1", query)
	if err != nil {
		t.Fatalf("maintenanceFinancialScopeFromQuery returned error: %v", err)
	}
	where := maintenanceFinanceWhere(scope, "customer_code", "contract_code", "project_code", "period_month")

	if !scope.ProjectScoped {
		t.Fatal("expected maintenance scope to be project-scoped")
	}
	if len(scope.ProjectCodes) != 1 || scope.ProjectCodes[0] != "P2" {
		t.Fatalf("project codes = %#v, want P2", scope.ProjectCodes)
	}
	if strings.Contains(where, " OR ") {
		t.Fatalf("project-scoped maintenance where should not use OR: %s", where)
	}
	if want := "customer_code = ? AND contract_code IN (?) AND project_code IN (?)"; where != want {
		t.Fatalf("where = %q, want %q", where, want)
	}
}

func TestMaintenanceServiceScopedWhereKeepsRequestedContractOrProjectScope(t *testing.T) {
	query := url.Values{}
	query.Set("contract_codes", "C1")
	query.Set("project_codes", "P2")

	scope, err := maintenanceFinancialScopeFromQuery("CUSTOMER-1", query)
	if err != nil {
		t.Fatalf("maintenanceFinancialScopeFromQuery returned error: %v", err)
	}
	where := maintenanceFinanceWhere(scope, "customer_code", "contract_code", "project_code", "period_month")

	if scope.ProjectScoped {
		t.Fatal("service/request-only maintenance scope should not be treated as authorization scope")
	}
	if want := "customer_code = ? AND (contract_code IN (?) OR project_code IN (?))"; where != want {
		t.Fatalf("where = %q, want %q", where, want)
	}
}
