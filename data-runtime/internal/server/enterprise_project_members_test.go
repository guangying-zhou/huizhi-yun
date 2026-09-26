package server

import (
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func TestEnterpriseProjectMemberTargetBindsActorProjectAndScope(t *testing.T) {
	input := enterpriseProjectMemberReadInput{ProjectID: "12", Query: map[string]string{
		"search": "person", "current_user_project_admin_project_codes": "PRJ-1",
	}}
	path, query, err := enterpriseProjectMemberReadTarget(input, "person-a")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/v1/aims/projects/12/members" || query.Get("current_user") != "person-a" || query.Get("operator_uid") != "person-a" {
		t.Fatalf("unexpected target: %s %#v", path, query)
	}
	if query.Get("search") != "person" || query.Get("current_user_project_admin_project_codes") != "PRJ-1" {
		t.Fatalf("approved filters were not retained: %#v", query)
	}
	for _, key := range []string{"tenant", "deployment", "current_user", "uid", "projectId"} {
		_, _, err = enterpriseProjectMemberReadTarget(enterpriseProjectMemberReadInput{ProjectID: "12", Query: map[string]string{key: "forged"}}, "person-a")
		if err == nil {
			t.Fatalf("expected %s override to fail", key)
		}
	}
}

func TestEnterpriseProjectMemberPermitRejectsTenantActorResourceAndExpiryMismatch(t *testing.T) {
	now := time.UnixMilli(1_800_000_000_000)
	verified := enterpriseRequestContext{
		Route:    enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "tenant-a"}, HostDeployment: "enterprise-test"},
		ActorUID: "person-a",
	}
	valid := enterpriseProjectMemberReadInput{
		Tenant: "tenant-a", Deployment: "enterprise-test",
		Authorization: enterpriseProjectMemberReadPermit{
			ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test",
			Resource: "projects", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli(),
		},
	}
	if err := validateEnterpriseProjectMemberReadPermit(valid, verified, now); err != nil {
		t.Fatal(err)
	}
	invalid := []enterpriseProjectMemberReadInput{valid, valid, valid, valid}
	invalid[0].Tenant = "tenant-b"
	invalid[1].Authorization.ActorUID = "person-b"
	invalid[2].Authorization.Resource = "project-members"
	invalid[3].Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
	for index, input := range invalid {
		if err := validateEnterpriseProjectMemberReadPermit(input, verified, now); err == nil {
			t.Fatalf("expected permit mismatch %d to fail", index)
		}
	}
}

func TestEnterpriseProjectMemberListRequiresCanonicalProjectID(t *testing.T) {
	for _, projectID := range []string{"", "0", "-1", "01", "900000000000000000000"} {
		_, _, err := enterpriseProjectMemberReadTarget(enterpriseProjectMemberReadInput{ProjectID: projectID}, "person-a")
		if err == nil {
			t.Fatalf("expected invalid project id %q to fail", projectID)
		}
	}
}
