package server

import (
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestDelegatedProjectWriteScopePermitBindsActionActorAndObjects(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	for _, act := range []enterpriseDelegatedAction{enterpriseProjectDeliverableSpec.Actions["update"], enterpriseProjectDeliverableSpec.Actions["delete"], enterpriseProjectDeliverableSpec.Actions["batch-create"], enterpriseWorkItemDeliverableSpec.Actions["update"], enterpriseWorkItemDecompositionSpec.Actions["submit"], enterpriseWorkItemDecompositionSpec.Actions["clone-from-template"], enterpriseProjectMilestoneSpec.Actions["create"], enterpriseProjectMilestoneSpec.Actions["update"], enterpriseProjectMilestoneSpec.Actions["delete"], enterpriseMilestoneRolloverSpec.Actions["execute"], enterpriseRequirementTargetSpec.Actions["create"], enterpriseTimesheetWeekSpec.Actions["submit"], enterpriseProjectTimeEntrySpec.Actions["create"], enterpriseProjectTimeEntrySpec.Actions["update"], enterpriseProjectTimeEntrySpec.Actions["delete"], enterpriseWorkItemTimeEntrySpec.Actions["create"], enterpriseWorkItemTimeEntrySpec.Actions["update"], enterpriseWorkItemTimeEntrySpec.Actions["delete"], enterpriseProjectWeeklyReportSpec.Actions["save-draft"], enterpriseProjectWeeklyReportSpec.Actions["submit"], enterpriseWorkItemBatchSpec.Actions["update"]} {
		input := delegatedInput()
		input.SubID = "18"
		if act.NeedsProject {
			input.ProjectID = "7"
		}
		scopeAction := act.ScopeAction
		if scopeAction == "" {
			scopeAction = "edit"
		}
		makePermit := func() *enterpriseDelegatedProjectWritePermit {
			return &enterpriseDelegatedProjectWritePermit{enterpriseWorkItemWritePermit: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "person-a", ProjectID: input.ProjectID, Tenant: input.Tenant, Deployment: input.Deployment, Resource: act.ScopeResource, Action: scopeAction, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v27", BundleHash: "hash27", PolicyRevision: &revision}, ObjectID: input.ObjectID, SubID: input.SubID}
		}
		input.ProjectWriteAuthorization = makePermit()
		if err := validateDelegatedProjectWritePermit(input, delegatedVerified(), act, now); err != nil {
			t.Fatal(err)
		}
		for _, change := range []func(*enterpriseDelegatedProjectWritePermit){func(p *enterpriseDelegatedProjectWritePermit) { p.ActorUID = "other" }, func(p *enterpriseDelegatedProjectWritePermit) { p.Scope = nil }, func(p *enterpriseDelegatedProjectWritePermit) { p.ObjectID = "99" }, func(p *enterpriseDelegatedProjectWritePermit) { p.SubID = "99" }, func(p *enterpriseDelegatedProjectWritePermit) { p.ProjectID = "99" }, func(p *enterpriseDelegatedProjectWritePermit) { p.Resource = "projects:view" }, func(p *enterpriseDelegatedProjectWritePermit) { p.Action = "view" }, func(p *enterpriseDelegatedProjectWritePermit) { p.ExpiresAt = now.UnixMilli() - 1 }, func(p *enterpriseDelegatedProjectWritePermit) { p.BundleHash = "" }, func(p *enterpriseDelegatedProjectWritePermit) { p.PolicyRevision = nil }} {
			input.ProjectWriteAuthorization = makePermit()
			change(input.ProjectWriteAuthorization)
			if validateDelegatedProjectWritePermit(input, delegatedVerified(), act, now) == nil {
				t.Fatal("invalid scoped permit accepted")
			}
		}
		if act.ScopeResource == "timesheet" {
			if act.ScopeAction != "submit" {
				t.Fatal("timesheet requires the manifest submit action")
			}
			input.ProjectWriteAuthorization = makePermit()
			input.ProjectWriteAuthorization.Action = "edit"
			if validateDelegatedProjectWritePermit(input, delegatedVerified(), act, now) == nil {
				t.Fatal("undeclared edit action accepted")
			}
		}
		input.ProjectWriteAuthorization = nil
		if validateDelegatedProjectWritePermit(input, delegatedVerified(), act, now) == nil {
			t.Fatal("legacy unscoped write accepted")
		}
	}
}

func TestProjectDeletionScopeUsesOriginalAdminActionAndCannotUseEditPermit(t *testing.T) {
	now := time.Now()
	revision := int64(27)
	act := enterpriseProjectDeleteSpec.Actions["execute"]
	input := delegatedInput()
	input.ProjectID = "7"
	input.ObjectID = ""
	permit := &enterpriseDelegatedProjectWritePermit{enterpriseWorkItemWritePermit: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "person-a", Tenant: input.Tenant, Deployment: input.Deployment, ProjectID: "7", Resource: "admin", Action: "admin", Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v27", BundleHash: "hash27", PolicyRevision: &revision}}
	input.ProjectWriteAuthorization = permit
	if err := validateDelegatedProjectWritePermit(input, delegatedVerified(), act, now); err != nil {
		t.Fatal(err)
	}
	permit.Action = "edit"
	if err := validateDelegatedProjectWritePermit(input, delegatedVerified(), act, now); err == nil {
		t.Fatal("project edit scope authorized destructive admin action")
	}
}
