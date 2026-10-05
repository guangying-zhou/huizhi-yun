package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestEnterpriseRequirementCommandPermitMatrix(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	verified := enterpriseRequestContext{ActorUID: "actor", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T"}, HostDeployment: "host"}}
	for _, action := range enterpriseProjectRequirementWritePaths {
		object := ""
		if action == "review-sync" || action == "review-create-tasks" || action == "change-create" || action == "task-create" || action == "review-append" || action == "review-withdraw" || action == "update" || action == "delete" || action == "content-update" || action == "content-delete" || action == "content-restore" {
			object = "4"
		}

		p := enterpriseDelegatedProjectWritePermit{ObjectID: object}
		p.ActorUID = "actor"
		p.Tenant = "T"
		p.Deployment = "host"
		p.Resource = "requirements"
		p.Action = "edit"
		p.ProjectID = "263"
		p.Allowed = true
		p.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
		p.Scope = &projectscope.Projection{Version: 1, ProjectCodes: []string{"P263"}, Masks: []int{0, 65535}}
		p.BundleVersion = "v27"
		p.BundleHash = "hash"
		p.PolicyRevision = &revision

		input := enterpriseRequirementWriteInput{Tenant: "T", Deployment: "host", ProjectID: "263", ObjectID: object, Authorization: p}
		if err := validateEnterpriseRequirementWritePermit(input, verified, action, now); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		for _, mutate := range []func(*enterpriseRequirementWriteInput){func(i *enterpriseRequirementWriteInput) { i.Authorization.ActorUID = "other" }, func(i *enterpriseRequirementWriteInput) { i.Authorization.Resource = "projects" }, func(i *enterpriseRequirementWriteInput) { i.Authorization.Action = "view" }, func(i *enterpriseRequirementWriteInput) { i.Authorization.ProjectID = "264" }, func(i *enterpriseRequirementWriteInput) { i.Authorization.Allowed = false }, func(i *enterpriseRequirementWriteInput) { i.Authorization.ExpiresAt = now.UnixMilli() }, func(i *enterpriseRequirementWriteInput) { i.Authorization.Scope = nil }, func(i *enterpriseRequirementWriteInput) { i.Authorization.WorkItemID = "9" }, func(i *enterpriseRequirementWriteInput) { i.Authorization.SubID = "9" }, func(i *enterpriseRequirementWriteInput) { i.Authorization.PolicyRevision = nil }} {
			bad := input
			mutate(&bad)
			if validateEnterpriseRequirementWritePermit(bad, verified, action, now) == nil {
				t.Fatalf("%s accepted invalid permit", action)
			}
		}
	}
}
func TestEnterpriseRequirementSpecificationQueriesAreSeparated(t *testing.T) {
	for _, action := range []string{"spec", "targets"} {
		input := enterpriseProjectRequirementReadInput{ProjectID: "263"}
		if action == "spec" {
			input.Query = map[string]string{"include_deleted": "1"}
		}
		_, q, e := enterpriseProjectRequirementReadTarget(action, input, "actor")
		if e != nil || q.Get("current_user") != "actor" {
			t.Fatalf("%s %v", action, e)
		}
		input.Query = map[string]string{"include_deleted": "true"}
		if _, _, e = enterpriseProjectRequirementReadTarget(action, input, "actor"); e == nil {
			t.Fatal("invalid spec query accepted")
		}
	}
}
