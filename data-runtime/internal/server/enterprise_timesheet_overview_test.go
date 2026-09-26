package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"testing"
	"time"
)

func TestEnterpriseTimesheetOverviewTargetBindsActorAndScope(t *testing.T) {
	input := enterpriseTimesheetOverviewInput{Query: map[string]string{"startDate": "2026-09-01", "endDate": "2026-09-30", "current_user_project_admin_project_codes": "PRJ-1"}}
	path, q, err := enterpriseTimesheetOverviewTarget(input, "person-a")
	if err != nil || path != "/v1/aims/users/person-a/visible-time-entries" || q.Get("current_user") != "person-a" || q.Get("current_user_project_admin_project_codes") != "PRJ-1" {
		t.Fatalf("unexpected target %q %v %v", path, q, err)
	}
	if _, _, err := enterpriseTimesheetOverviewTarget(enterpriseTimesheetOverviewInput{Query: map[string]string{"uid": "person-b"}}, "person-a"); err == nil {
		t.Fatal("accepted another user")
	}
}
func TestEnterpriseTimesheetOverviewPermitRejectsTenantAndActorMismatch(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseTimesheetOverviewInput{Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseTimesheetOverviewPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "timesheet", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if validateEnterpriseTimesheetOverviewPermit(valid, verified, now) != nil {
		t.Fatal("valid rejected")
	}
	valid.Authorization.ActorUID = "person-b"
	if validateEnterpriseTimesheetOverviewPermit(valid, verified, now) == nil {
		t.Fatal("actor mismatch accepted")
	}
}
