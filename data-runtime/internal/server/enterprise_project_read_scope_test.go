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

func TestProjectManagementProjectionFreshnessAndNoClientFacts(t *testing.T) {
	now := time.Now()
	p := validNestedProjectReadPermit(now, "12")
	revision := int64(27)
	p.ManagementAuthorization = &enterpriseProjectManagementPermit{Resource: "projects", Action: "edit", Scope: &projectscope.Projection{Version: 1, Masks: []int{0}}, ExpiresAt: now.Add(10 * time.Second).UnixMilli(), BundleVersion: "v27", BundleHash: "hash", PolicyRevision: &revision}
	check := func() error {
		return validateNestedProjectReadPermit("tenant-a", "enterprise-test", "12", p, delegatedVerified(), now)
	}
	if err := check(); err != nil {
		t.Fatal(err)
	}
	p.ManagementAuthorization.Action = "view"
	if err := check(); err == nil {
		t.Fatal("view elevated to management")
	}
	p.ManagementAuthorization.Action = "edit"
	p.ManagementAuthorization.ExpiresAt = now.UnixMilli()
	if err := check(); err == nil {
		t.Fatal("expired management projection accepted")
	}
	p.ManagementAuthorization.ExpiresAt = now.Add(16 * time.Second).UnixMilli()
	if err := check(); err == nil {
		t.Fatal("long-lived management projection accepted")
	}
	for _, body := range []map[string]any{
		{"projectReadAuthorization": map[string]any{"manager": true}},
		{"projectReadAuthorization": map[string]any{"managementAuthorization": map[string]any{"allowed": true}}},
	} {
		if _, err := decodeEnterpriseTimeEntryReadInput(body); err == nil {
			t.Fatal("client relationship fact accepted on timesheet")
		}
		if _, err := decodeEnterpriseWeeklyReportReadInput(body); err == nil {
			t.Fatal("client relationship fact accepted on weekly reports")
		}
	}
}
