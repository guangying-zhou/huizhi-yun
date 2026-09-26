package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseProjectRequirementReadTargetBindsProjectObjectAndScope(t *testing.T) {
	input := enterpriseProjectRequirementReadInput{ProjectID: "12", RequirementID: "34", Query: map[string]string{"search": "login", "current_user_project_admin_project_codes": "PRJ-12"}}
	path, query, err := enterpriseProjectRequirementReadTarget("view", input, "person-a")
	if err != nil || path != "/v1/aims/projects/12/requirements/34" {
		t.Fatalf("unexpected target: %q %v", path, err)
	}
	if query.Get("current_user") != "person-a" || query.Get("current_user_project_admin_project_codes") != "PRJ-12" {
		t.Fatalf("actor or project scope was not retained: %v", query)
	}
	for _, invalid := range []enterpriseProjectRequirementReadInput{{ProjectID: "0"}, {ProjectID: "12", RequirementID: "99", Query: map[string]string{"tenant": "other"}}} {
		if _, _, err := enterpriseProjectRequirementReadTarget("list", invalid, "person-a"); err == nil {
			t.Fatalf("accepted invalid input: %#v", invalid)
		}
	}
}

func TestEnterpriseProjectRequirementPermitRejectsTenantAndActorMismatch(t *testing.T) {
	now := time.Now()
	verified := enterpriseRequestContext{ActorUID: "person-a", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"}}
	valid := enterpriseProjectRequirementReadInput{Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseProjectRequirementReadPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "requirements", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}}
	if err := validateEnterpriseProjectRequirementReadPermit(valid, verified, now); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*enterpriseProjectRequirementReadInput){func(v *enterpriseProjectRequirementReadInput) { v.Tenant = "tenant-b" }, func(v *enterpriseProjectRequirementReadInput) { v.Authorization.ActorUID = "person-b" }, func(v *enterpriseProjectRequirementReadInput) { v.Authorization.Resource = "projects" }} {
		candidate := valid
		mutate(&candidate)
		if validateEnterpriseProjectRequirementReadPermit(candidate, verified, now) == nil {
			t.Fatal("accepted mismatched permit")
		}
	}
}
