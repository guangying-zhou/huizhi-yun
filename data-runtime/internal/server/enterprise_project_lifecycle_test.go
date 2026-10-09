package server

import (
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"testing"
	"time"
)

func TestLifecycleScopeCannotBorrowViewOrEditForFinish(t *testing.T) {
	now := time.Now()
	revision := int64(1)
	for _, action := range []string{"edit", "close"} {
		t.Run(action, func(t *testing.T) {
			input := delegatedInput()
			input.ProjectID = "7"
			input.ObjectID = ""
			input.SubID = ""
			makePermit := func() *enterpriseDelegatedProjectWritePermit {
				return &enterpriseDelegatedProjectWritePermit{enterpriseWorkItemWritePermit: enterpriseWorkItemWritePermit{enterpriseProjectMemberPermit: enterpriseProjectMemberPermit{ActorUID: "person-a", Tenant: input.Tenant, Deployment: input.Deployment, ProjectID: "7", Resource: "projects", Action: action, Allowed: true, ExpiresAt: now.Add(10 * time.Second).UnixMilli()}, Scope: &projectscope.Projection{Version: 1, Masks: []int{65535}}, BundleVersion: "v1", BundleHash: "hash1", PolicyRevision: &revision}}
			}
			target := enterpriseDelegatedAction{ScopeResource: "projects", ScopeAction: action}
			input.ProjectWriteAuthorization = makePermit()
			if err := validateDelegatedProjectWritePermit(input, delegatedVerified(), target, now); err != nil {
				t.Fatal(err)
			}
			for _, change := range []func(*enterpriseDelegatedProjectWritePermit){func(p *enterpriseDelegatedProjectWritePermit) { p.Action = "view" }, func(p *enterpriseDelegatedProjectWritePermit) { p.ProjectID = "8" }, func(p *enterpriseDelegatedProjectWritePermit) { p.ActorUID = "other" }, func(p *enterpriseDelegatedProjectWritePermit) { p.Scope = nil }, func(p *enterpriseDelegatedProjectWritePermit) { p.ExpiresAt = now.UnixMilli() - 1 }} {
				input.ProjectWriteAuthorization = makePermit()
				change(input.ProjectWriteAuthorization)
				if validateDelegatedProjectWritePermit(input, delegatedVerified(), target, now) == nil {
					t.Fatal("invalid lifecycle scoped permit accepted")
				}
			}
			if action == "close" {
				input.ProjectWriteAuthorization = makePermit()
				input.ProjectWriteAuthorization.Action = "edit"
				if validateDelegatedProjectWritePermit(input, delegatedVerified(), target, now) == nil {
					t.Fatal("edit grant authorized finish")
				}
			}
		})
	}
}
