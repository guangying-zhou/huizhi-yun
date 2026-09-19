package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseWeeklyReportOverviewQueryBindsActorScopeAndFlag(t *testing.T) {
	input := enterpriseWeeklyReportOverviewInput{Query: map[string]string{"year": "2026", "week": "37", "current_user_project_admin_project_codes": "PRJ-1"}}
	q, err := enterpriseWeeklyReportOverviewQuery(input, "person-a")
	if err != nil || q.Get("current_user") != "person-a" || q.Get("current_user_can_view_weekly_report_summary") != "1" || q.Get("current_user_project_admin_project_codes") != "PRJ-1" {
		t.Fatalf("unexpected query %v %v", q, err)
	}
	if _, err := enterpriseWeeklyReportOverviewQuery(enterpriseWeeklyReportOverviewInput{Query: map[string]string{"uid": "person-b"}}, "person-a"); err == nil {
		t.Fatal("accepted uid filter")
	}
}
func TestEnterpriseWeeklyReportOverviewPermitRejectsTenantAndActorMismatch(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseWeeklyReportOverviewInput{Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseWeeklyReportOverviewPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "weekly_reports", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if validateEnterpriseWeeklyReportOverviewPermit(valid, verified, now) != nil {
		t.Fatal("valid rejected")
	}
	valid.Tenant = "tenant-b"
	if validateEnterpriseWeeklyReportOverviewPermit(valid, verified, now) == nil {
		t.Fatal("tenant mismatch accepted")
	}
}
