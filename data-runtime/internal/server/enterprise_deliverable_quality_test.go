package server

import (
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestEnterpriseQualityPermitMatrix(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	verified := enterpriseRequestContext{ActorUID: "actor", Route: enterpriseRouteContext{Binding: enterprise.BindingKey{Tenant: "T"}, HostDeployment: "host"}}
	for _, action := range enterpriseQualityPaths {
		object := "4"

		p := enterpriseDelegatedProjectWritePermit{ObjectID: object}
		p.ActorUID = "actor"
		p.Tenant = "T"
		p.Deployment = "host"
		p.Resource = "projects"
		p.Action = "view"
		if action == "waiver" {
			p.Resource = "quality_reviews"
			p.Action = "waive"
		}
		p.ProjectID = "263"
		p.Allowed = true
		p.ExpiresAt = now.Add(10 * time.Second).UnixMilli()
		p.Scope = &projectscope.Projection{Version: 1, ProjectCodes: []string{"P263"}, Masks: []int{0, 65535}}
		p.BundleVersion = "v27"
		p.BundleHash = "hash"
		p.PolicyRevision = &revision

		input := enterpriseQualityInput{Tenant: "T", Deployment: "host", ProjectID: "263", ObjectID: object, Authorization: p}
		if err := validateEnterpriseQualityPermit(input, verified, action, now); err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		for _, mutate := range []func(*enterpriseQualityInput){func(i *enterpriseQualityInput) { i.Authorization.ActorUID = "other" }, func(i *enterpriseQualityInput) { i.Authorization.Resource = "wrong" }, func(i *enterpriseQualityInput) { i.Authorization.Action = "edit" }, func(i *enterpriseQualityInput) { i.Authorization.ProjectID = "264" }, func(i *enterpriseQualityInput) { i.Authorization.Allowed = false }, func(i *enterpriseQualityInput) { i.Authorization.ExpiresAt = now.UnixMilli() }, func(i *enterpriseQualityInput) { i.Authorization.Scope = nil }, func(i *enterpriseQualityInput) { i.Authorization.WorkItemID = "9" }, func(i *enterpriseQualityInput) { i.Authorization.SubID = "9" }, func(i *enterpriseQualityInput) { i.Authorization.PolicyRevision = nil }} {
			bad := input
			mutate(&bad)
			if validateEnterpriseQualityPermit(bad, verified, action, now) == nil {
				t.Fatalf("%s accepted invalid permit", action)
			}
		}
	}
}
