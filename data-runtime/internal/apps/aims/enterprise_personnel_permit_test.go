package aims

import (
	"testing"
	"time"
)

func TestEnterprisePersonnelPermitBindsConsoleObservationToCommand(t *testing.T) {
	now := time.Now()
	p := EnterprisePersonnelPermit{Tenant: "T1", Deployment: "enterprise-test", ActorUID: "U1", Resource: "work_items", ObjectID: "7", Action: "edit", Field: "assigneeUid", UID: "U2", Status: "active", ExpiresAt: now.Add(10 * time.Second).UnixMilli()}
	identity := EnterpriseProjectCreateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", ActorUID: "U1", Personnel: []EnterprisePersonnelPermit{p}}
	check := func(v EnterpriseProjectCreateIdentity) error {
		return validateEnterprisePersonnel(v, map[string]string{"assigneeUid": "U2"}, "work_items", "7", "edit", now)
	}
	if err := check(identity); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*EnterprisePersonnelPermit){func(p *EnterprisePersonnelPermit) { p.Tenant = "T2" }, func(p *EnterprisePersonnelPermit) { p.Deployment = "prod" }, func(p *EnterprisePersonnelPermit) { p.ActorUID = "U3" }, func(p *EnterprisePersonnelPermit) { p.Resource = "projects" }, func(p *EnterprisePersonnelPermit) { p.ObjectID = "8" }, func(p *EnterprisePersonnelPermit) { p.Action = "create" }, func(p *EnterprisePersonnelPermit) { p.Field = "leaderUid" }, func(p *EnterprisePersonnelPermit) { p.UID = "U3" }, func(p *EnterprisePersonnelPermit) { p.Status = "inactive" }, func(p *EnterprisePersonnelPermit) { p.ExpiresAt = now.UnixMilli() }, func(p *EnterprisePersonnelPermit) { p.ExpiresAt = now.Add(16 * time.Second).UnixMilli() }} {
		bad := p
		change(&bad)
		v := identity
		v.Personnel = []EnterprisePersonnelPermit{bad}
		if check(v) == nil {
			t.Fatal("invalid personnel permit accepted", bad)
		}
	}
	identity.Personnel = nil
	if check(identity) == nil {
		t.Fatal("missing personnel observation accepted")
	}
	identity.Personnel = []EnterprisePersonnelPermit{p, p}
	if check(identity) == nil {
		t.Fatal("duplicate personnel observation accepted")
	}
}
