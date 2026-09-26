package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseWeeklyReportTargetBindsActorProjectAndScope(t *testing.T) {
	input := enterpriseWeeklyReportReadInput{ProjectID: "12", Query: map[string]string{
		"year": "2026", "current_user_project_admin_project_codes": "PRJ-1",
	}}
	path, query, err := enterpriseWeeklyReportReadTarget("list", input, "person-a")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/v1/aims/projects/12/weekly-reports" || query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" {
		t.Fatalf("unexpected target: %s %#v", path, query)
	}
	if query.Get("year") != "2026" || query.Get("current_user_project_admin_project_codes") != "PRJ-1" {
		t.Fatalf("approved filters were not retained: %#v", query)
	}
	for _, key := range []string{"tenant", "deployment", "current_user", "includeEntries", "projectId"} {
		_, _, err = enterpriseWeeklyReportReadTarget("list", enterpriseWeeklyReportReadInput{ProjectID: "12", Query: map[string]string{key: "forged"}}, "person-a")
		if err == nil {
			t.Fatalf("expected %s override to fail", key)
		}
	}
}

func TestEnterpriseWeeklyReportPermitRejectsTenantActorResourceAndExpiryMismatch(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	verified := enterpriseRequestContext{
		Route:    enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"},
		ActorUID: "person-a",
	}
	valid := enterpriseWeeklyReportReadInput{
		Tenant: "tenant-a", Deployment: "enterprise-test",
		Authorization: enterpriseWeeklyReportReadPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
			Resource: "weekly_reports", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
		},
	}
	if err := validateEnterpriseWeeklyReportReadPermit(valid, verified, now); err != nil {
		t.Fatal(err)
	}
	invalid := []enterpriseWeeklyReportReadInput{valid, valid, valid, valid}
	invalid[0].Tenant = "tenant-b"
	invalid[1].Authorization.ActorUID = "person-b"
	invalid[2].Authorization.Resource = "timesheet"
	invalid[3].Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
	for index, input := range invalid {
		if err := validateEnterpriseWeeklyReportReadPermit(input, verified, now); err == nil {
			t.Fatalf("expected permit mismatch %d to fail", index)
		}
	}
}

func TestEnterpriseWeeklyReportViewRequiresCanonicalProjectAndPeriod(t *testing.T) {
	for _, projectID := range []string{"", "0", "-1", "01", "900000000000000000000"} {
		_, _, err := enterpriseWeeklyReportReadTarget("view", enterpriseWeeklyReportReadInput{ProjectID: projectID, PeriodKey: "2026-W37"}, "person-a")
		if err == nil {
			t.Fatalf("expected invalid project id %q to fail", projectID)
		}
	}
	for _, period := range []string{"", "2026-W0", "2026-W1", "2026-W54", "2026-W37/draft", "2026-W37:submit"} {
		_, _, err := enterpriseWeeklyReportReadTarget("view", enterpriseWeeklyReportReadInput{ProjectID: "12", PeriodKey: period}, "person-a")
		if err == nil {
			t.Fatalf("expected invalid period %q to fail", period)
		}
	}
	path, _, err := enterpriseWeeklyReportReadTarget("view", enterpriseWeeklyReportReadInput{ProjectID: "12", PeriodKey: "2026-W37"}, "person-a")
	if err != nil || path != "/v1/aims/projects/12/weekly-reports/2026-W37" {
		t.Fatalf("unexpected view target: %s %v", path, err)
	}
}
