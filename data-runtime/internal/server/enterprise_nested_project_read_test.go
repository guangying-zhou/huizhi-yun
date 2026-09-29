package server

import (
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func validNestedProjectReadPermit(now time.Time, projectID string) *enterpriseNestedProjectReadPermit {
	revision := int64(27)
	return &enterpriseNestedProjectReadPermit{ProjectID: projectID, enterpriseProjectReadPermit: enterpriseProjectReadPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: "projects", Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli(), HasViewPermission: true, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v27", BundleHash: "hash", PolicyRevision: &revision}}
}

func TestNestedProjectReadPermitBindsProjectAndPolicy(t *testing.T) {
	now := time.Now()
	check := func(p *enterpriseNestedProjectReadPermit) error {
		return validateNestedProjectReadPermit("tenant-a", "enterprise-test", "12", p, delegatedVerified(), now)
	}
	if err := check(validNestedProjectReadPermit(now, "12")); err != nil {
		t.Fatal(err)
	}
	if err := check(nil); err == nil {
		t.Fatal("legacy permit accepted")
	}
	for name, mutate := range map[string]func(*enterpriseNestedProjectReadPermit){
		"other project":      func(p *enterpriseNestedProjectReadPermit) { p.ProjectID = "13" },
		"other actor":        func(p *enterpriseNestedProjectReadPermit) { p.ActorUID = "other" },
		"other tenant":       func(p *enterpriseNestedProjectReadPermit) { p.Tenant = "other" },
		"other deployment":   func(p *enterpriseNestedProjectReadPermit) { p.Deployment = "other" },
		"write permit":       func(p *enterpriseNestedProjectReadPermit) { p.Action = "edit" },
		"missing projection": func(p *enterpriseNestedProjectReadPermit) { p.Scope = nil },
		"missing view":       func(p *enterpriseNestedProjectReadPermit) { p.HasViewPermission = false },
		"missing hash":       func(p *enterpriseNestedProjectReadPermit) { p.BundleHash = "" },
		"missing revision":   func(p *enterpriseNestedProjectReadPermit) { p.PolicyRevision = nil },
		"expired":            func(p *enterpriseNestedProjectReadPermit) { p.ExpiresAt = now.UnixMilli() },
	} {
		t.Run(name, func(t *testing.T) {
			p := validNestedProjectReadPermit(now, "12")
			mutate(p)
			if err := check(p); err == nil {
				t.Fatal("invalid permit accepted")
			}
		})
	}
}

func TestNestedProjectReadDecodersRejectClientRelationshipFacts(t *testing.T) {
	body := map[string]any{"projectReadAuthorization": map[string]any{"projectId": "12", "participant": true}}
	decoders := map[string]func() error{
		"members":      func() error { _, err := decodeEnterpriseProjectMemberReadInput(body); return err },
		"plan":         func() error { _, err := decodeEnterpriseProjectPlanInput(body); return err },
		"board":        func() error { _, err := decodeEnterpriseProjectBoardInput(body); return err },
		"requirements": func() error { _, err := decodeEnterpriseProjectRequirementReadInput(body); return err },
	}
	for name, decode := range decoders {
		t.Run(name, func(t *testing.T) {
			if err := decode(); err == nil {
				t.Fatal("client fact accepted")
			}
		})
	}
}

func TestNestedProjectReadersRequireCommonPermit(t *testing.T) {
	now := time.Now()
	permit := func(resource string) enterpriseProjectPlanPermit {
		return enterpriseProjectPlanPermit{ActorUID: "person-a", Tenant: "tenant-a", Deployment: "enterprise-test", Resource: resource, Action: "view", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
	}
	tests := map[string]func(*enterpriseNestedProjectReadPermit) error{
		"members": func(p *enterpriseNestedProjectReadPermit) error {
			return validateEnterpriseProjectMemberReadPermit(enterpriseProjectMemberReadInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12", Authorization: enterpriseProjectMemberReadPermit(permit("projects")), ProjectReadAuthorization: p}, delegatedVerified(), now)
		},
		"plan": func(p *enterpriseNestedProjectReadPermit) error {
			return validateEnterpriseProjectPlanPermit(enterpriseProjectPlanInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12", Authorization: permit("project-plan"), ProjectReadAuthorization: p}, delegatedVerified(), now)
		},
		"board": func(p *enterpriseNestedProjectReadPermit) error {
			return validateEnterpriseProjectBoardPermit(enterpriseProjectBoardInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12", Authorization: enterpriseProjectBoardPermit(permit("project-board")), ProjectReadAuthorization: p}, delegatedVerified(), now)
		},
		"requirements": func(p *enterpriseNestedProjectReadPermit) error {
			return validateEnterpriseProjectRequirementReadPermit(enterpriseProjectRequirementReadInput{Tenant: "tenant-a", Deployment: "enterprise-test", ProjectID: "12", Authorization: enterpriseProjectRequirementReadPermit(permit("requirements")), ProjectReadAuthorization: p}, delegatedVerified(), now)
		},
	}
	for name, check := range tests {
		t.Run(name, func(t *testing.T) {
			if err := check(validNestedProjectReadPermit(now, "12")); err != nil {
				t.Fatal(err)
			}
			if err := check(nil); err == nil {
				t.Fatal("legacy nested read accepted")
			}
			if err := check(validNestedProjectReadPermit(now, "13")); err == nil {
				t.Fatal("permit crossed project")
			}
		})
	}
}
