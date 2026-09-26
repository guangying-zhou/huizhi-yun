package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseWorkItemTargetBindsActorAndRejectsOverrides(t *testing.T) {
	input := enterpriseWorkItemReadInput{Query: map[string]string{
		"page": "2", "search": "release", "current_user_project_admin_project_codes": "PRJ-1",
	}}
	path, query, err := enterpriseWorkItemReadTarget("list", input, "person-a")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/v1/aims/work-items" || query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" {
		t.Fatalf("unexpected target: %s %#v", path, query)
	}
	if query.Get("page") != "2" || query.Get("current_user_project_admin_project_codes") != "PRJ-1" {
		t.Fatalf("approved filters were not retained: %#v", query)
	}
	for _, key := range []string{"uid", "tenant", "deployment", "current_user"} {
		_, _, err = enterpriseWorkItemReadTarget("list", enterpriseWorkItemReadInput{Query: map[string]string{key: "forged"}}, "person-a")
		if err == nil {
			t.Fatalf("expected %s override to fail", key)
		}
	}
}

func TestEnterpriseWorkItemPermitRejectsTenantActorAndExpiryMismatch(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	verified := enterpriseRequestContext{
		Route: enterpriseRouteContext{
			Binding:        enterprise.BindingKey{Tenant: "tenant-a"},
			HostDeployment: "enterprise-test",
		},
		ActorUID: "person-a",
	}
	valid := enterpriseWorkItemReadInput{
		Tenant: "tenant-a", Deployment: "enterprise-test",
		Authorization: enterpriseWorkItemReadPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
			Resource: "work_items", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
		},
	}
	if err := validateEnterpriseWorkItemReadPermit(valid, verified, now); err != nil {
		t.Fatal(err)
	}

	invalid := []enterpriseWorkItemReadInput{valid, valid, valid, valid}
	invalid[0].Tenant = "tenant-b"
	invalid[1].Authorization.ActorUID = "person-b"
	invalid[2].Authorization.Resource = "projects"
	invalid[3].Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
	for index, input := range invalid {
		if err := validateEnterpriseWorkItemReadPermit(input, verified, now); err == nil {
			t.Fatalf("expected permit mismatch %d to fail", index)
		}
	}
}

func TestEnterpriseWorkItemViewRequiresCanonicalID(t *testing.T) {
	for _, id := range []string{"", "0", "-1", "01", "900000000000000000000"} {
		_, _, err := enterpriseWorkItemReadTarget("view", enterpriseWorkItemReadInput{WorkItemID: id}, "person-a")
		if err == nil {
			t.Fatalf("expected invalid id %q to fail", id)
		}
	}
	path, _, err := enterpriseWorkItemReadTarget("view", enterpriseWorkItemReadInput{WorkItemID: "42"}, "person-a")
	if err != nil || path != "/v1/aims/work-items/42" {
		t.Fatalf("unexpected view target: %s %v", path, err)
	}
}

// The distribution page reads its context through the unified work item read
// route: same view permit, trusted project scope and actor, fixed target path.
func TestEnterpriseWorkItemBreakdownContextReadTarget(t *testing.T) {
	if enterpriseWorkItemReadActions["/v1/enterprise/aims/work-items:breakdown-context"] != "breakdown-context" {
		t.Fatal("breakdown-context read is not routed")
	}
	input := enterpriseWorkItemReadInput{WorkItemID: "42", Query: map[string]string{"current_user_is_project_admin": "1"}}
	path, query, err := enterpriseWorkItemReadTarget("breakdown-context", input, "person-a")
	if err != nil || path != "/v1/aims/work-items/42/breakdown-context" {
		t.Fatalf("unexpected target %q: %v", path, err)
	}
	if query.Get("current_user") != "person-a" || query.Get("current_user_is_project_admin") != "1" {
		t.Fatalf("actor or trusted scope not carried: %v", query)
	}
	for _, bad := range []enterpriseWorkItemReadInput{{WorkItemID: "0"}, {WorkItemID: "42/../1"}, {WorkItemID: "42", Query: map[string]string{"current_user": "forged"}}} {
		if _, _, err := enterpriseWorkItemReadTarget("breakdown-context", bad, "person-a"); err == nil {
			t.Fatalf("invalid breakdown-context input accepted: %+v", bad)
		}
	}
}
