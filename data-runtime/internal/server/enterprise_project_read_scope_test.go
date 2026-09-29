package server

import (
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestEnterpriseProjectReadScopePermitBindingAndFreshness(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	input := enterpriseProjectReadInput{Tenant: "tenant-a", Deployment: "enterprise-test", Authorization: enterpriseProjectReadPermit{CanManagePortfolios: true, ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli(), HasViewPermission: true, Scope: &projectscope.Projection{Version: 1, Masks: []int{65280}}, BundleVersion: "v27", BundleHash: "hash", PolicyRevision: &revision}}
	if err := validateEnterpriseProjectReadPermit(input, delegatedVerified(), now); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*enterpriseProjectReadInput){
		func(i *enterpriseProjectReadInput) { i.Authorization.ActorUID = "other" },
		func(i *enterpriseProjectReadInput) { i.Authorization.Tenant = "other" },
		func(i *enterpriseProjectReadInput) { i.Authorization.Deployment = "other" },
		func(i *enterpriseProjectReadInput) { i.Authorization.Action = "edit" },
		func(i *enterpriseProjectReadInput) { i.Authorization.Scope = nil },
		func(i *enterpriseProjectReadInput) { i.Authorization.HasViewPermission = false },
		func(i *enterpriseProjectReadInput) { i.Authorization.BundleHash = "" },
		func(i *enterpriseProjectReadInput) { i.Authorization.PolicyRevision = nil },
		func(i *enterpriseProjectReadInput) {
			i.Authorization.Scope = &projectscope.Projection{Version: 1, Masks: []int{65536}}
		},
		func(i *enterpriseProjectReadInput) { i.Authorization.ExpiresAt = now.UnixMilli() },
		func(i *enterpriseProjectReadInput) { i.Authorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli() },
	} {
		bad := input
		change(&bad)
		if err := validateEnterpriseProjectReadPermit(bad, delegatedVerified(), now); err == nil {
			t.Fatal("invalid scope permit accepted")
		}
	}
	if _, err := decodeEnterpriseProjectReadInput(map[string]any{"tenant": "tenant-a", "authorization": map[string]any{"participant": true}}); err == nil {
		t.Fatal("client relationship fact accepted")
	}
}
