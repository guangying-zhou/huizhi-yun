package server

import (
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
	"time"
)

func TestProjectOutputPermitAndInputMatrix(t *testing.T) {
	now := time.Now()
	fixture := func() enterpriseProjectOutputInput {
		return enterpriseProjectOutputInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12", Query: map[string]string{"page": "2", "pageSize": "20"}, Authorization: enterpriseDelegatedPermit{Tenant: "tenant-a", Deployment: "enterprise-test", ActorUID: "person-a", Resource: "projects", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, ProjectReadAuthorization: validNestedProjectReadPermit(now, "12")}
	}
	q, err := validateProjectOutputInput(fixture(), delegatedVerified(), now)
	if err != nil || q.Get("current_user") != "person-a" {
		t.Fatal(q, err)
	}
	for name, mutate := range map[string]func(*enterpriseProjectOutputInput){
		"actor": func(p *enterpriseProjectOutputInput) { p.Authorization.ActorUID = "other" }, "tenant": func(p *enterpriseProjectOutputInput) { p.Tenant = "other" }, "deployment": func(p *enterpriseProjectOutputInput) { p.Deployment = "other" }, "edit": func(p *enterpriseProjectOutputInput) { p.Authorization.Action = "edit" }, "expired": func(p *enterpriseProjectOutputInput) { p.Authorization.ExpiresAt = now.UnixMilli() }, "other-parent": func(p *enterpriseProjectOutputInput) { p.ProjectReadAuthorization.ProjectID = "13" }, "missing-scope": func(p *enterpriseProjectOutputInput) { p.ProjectReadAuthorization.Scope = nil }, "type-override": func(p *enterpriseProjectOutputInput) { p.Query["deliverableType"] = "artifact" }, "actor-query": func(p *enterpriseProjectOutputInput) { p.Query["current_user"] = "forged" },
	} {
		t.Run(name, func(t *testing.T) {
			in := fixture()
			mutate(&in)
			if _, err := validateProjectOutputInput(in, delegatedVerified(), now); err == nil {
				t.Fatal("invalid input reached domain")
			}
		})
	}
}
func TestProjectRepoCandidatesRequireScopedEdit(t *testing.T) {
	now := time.Now()
	act := enterpriseProjectRepoSpec.Actions["candidates"]
	in := delegatedInput()
	in.ProjectID = "12"
	if act.Method != "GET" || act.ScopeResource != "projects" || act.PermitAction != "edit" {
		t.Fatal(act)
	}
	err := validateDelegatedProjectWritePermit(in, delegatedVerified(), act, now)
	var h httperror.Error
	if !errors.As(err, &h) || h.Status != 403 {
		t.Fatal("candidate directory without signed edit", err)
	}
}
