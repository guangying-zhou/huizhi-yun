package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseTimeEntryTargetBindsActorProjectAndScope(t *testing.T) {
	input := enterpriseTimeEntryReadInput{ProjectID: "12", Query: map[string]string{
		"startDate": "2026-09-01", "uid": "person-b", "current_user_project_admin_project_codes": "PRJ-1",
	}}
	path, query, err := enterpriseTimeEntryReadTarget("list", input, "person-a")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/v1/aims/projects/12/time-entries" || query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" {
		t.Fatalf("unexpected target: %s %#v", path, query)
	}
	if query.Get("uid") != "person-b" || query.Get("current_user_project_admin_project_codes") != "PRJ-1" {
		t.Fatalf("approved filters were not retained: %#v", query)
	}
	for _, key := range []string{"tenant", "deployment", "current_user", "workItemId"} {
		_, _, err = enterpriseTimeEntryReadTarget("list", enterpriseTimeEntryReadInput{ProjectID: "12", Query: map[string]string{key: "forged"}}, "person-a")
		if err == nil {
			t.Fatalf("expected %s override to fail", key)
		}
	}
}

func TestEnterpriseTimeEntryPermitRejectsTenantActorResourceAndExpiryMismatch(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	verified := enterpriseRequestContext{
		Route:    enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"},
		ActorUID: "person-a",
	}
	valid := enterpriseTimeEntryReadInput{
		Tenant: "tenant-a", Deployment: "enterprise-test",
		Authorization: enterpriseTimeEntryReadPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
			Resource: "timesheet", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
		},
	}
	if err := validateEnterpriseTimeEntryReadPermit(valid, verified, now); err != nil {
		t.Fatal(err)
	}
	invalid := []enterpriseTimeEntryReadInput{valid, valid, valid, valid}
	invalid[0].Tenant = "tenant-b"
	invalid[1].Authorization.ActorUID = "person-b"
	invalid[2].Authorization.Resource = "work_items"
	invalid[3].Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
	for index, input := range invalid {
		if err := validateEnterpriseTimeEntryReadPermit(input, verified, now); err == nil {
			t.Fatalf("expected permit mismatch %d to fail", index)
		}
	}
}

func TestEnterpriseTimeEntryViewRequiresCanonicalProjectAndEntryIDs(t *testing.T) {
	for _, id := range []string{"", "0", "-1", "01", "900000000000000000000"} {
		_, _, err := enterpriseTimeEntryReadTarget("view", enterpriseTimeEntryReadInput{ProjectID: id, TimeEntryID: "42"}, "person-a")
		if err == nil {
			t.Fatalf("expected invalid project id %q to fail", id)
		}
		_, _, err = enterpriseTimeEntryReadTarget("view", enterpriseTimeEntryReadInput{ProjectID: "12", TimeEntryID: id}, "person-a")
		if err == nil {
			t.Fatalf("expected invalid time entry id %q to fail", id)
		}
	}
	path, _, err := enterpriseTimeEntryReadTarget("view", enterpriseTimeEntryReadInput{ProjectID: "12", TimeEntryID: "42"}, "person-a")
	if err != nil || path != "/v1/aims/projects/12/time-entries/42" {
		t.Fatalf("unexpected view target: %s %v", path, err)
	}
}
