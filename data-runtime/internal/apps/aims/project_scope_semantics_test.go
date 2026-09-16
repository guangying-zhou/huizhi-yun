package aims

import (
	"net/url"
	"strings"
	"testing"
)

func TestProjectScopedAdminWhereBindsValuedMemberScopeToProjectCodes(t *testing.T) {
	query := url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_member_project_codes": {"PRJ-1,PRJ-2"},
	}
	where, args := projectScopedAdminWhere(query, "p")

	memberAndCode := "(EXISTS (SELECT 1 FROM aims_project_members pam WHERE pam.project_id = p.id AND pam.uid = ? AND pam.status = 'active') AND p.project_code IN (?,?))"
	if !strings.Contains(where, memberAndCode) {
		t.Fatalf("valued member scope must bind relation and project code in one branch: %s", where)
	}
	if len(args) != 3 || args[0] != "u1" || args[1] != "PRJ-1" || args[2] != "PRJ-2" {
		t.Fatalf("valued member scope args = %#v, want actor then exact project codes", args)
	}
}

func TestProjectScopedAdminWhereBindsValuedOwnerScopeToProjectCodes(t *testing.T) {
	query := url.Values{
		"current_user": {"owner-1"},
		"current_user_project_admin_owner_project_codes": {"PRJ-9"},
	}
	where, args := projectScopedAdminWhere(query, "p")

	if !strings.Contains(where, "(p.leader_uid = ? AND p.project_code IN (?))") {
		t.Fatalf("valued owner scope must bind owner and project code in one branch: %s", where)
	}
	if len(args) != 2 || args[0] != "owner-1" || args[1] != "PRJ-9" {
		t.Fatalf("valued owner scope args = %#v, want actor then exact project code", args)
	}
}

func TestProjectScopedAdminWhereRejectsValuedRelationsWithoutTrustedActor(t *testing.T) {
	for _, key := range []string{
		"current_user_project_admin_member_project_codes",
		"current_user_project_admin_owner_project_codes",
	} {
		where, args := projectScopedAdminWhere(url.Values{key: {"PRJ-1"}}, "p")
		if where != "1 = 0" || len(args) != 0 {
			t.Fatalf("%s without actor must fail closed, where=%q args=%#v", key, where, args)
		}
	}
}

func TestProjectScopedAdminWhereKeepsExplicitCodeScopeCodeOnly(t *testing.T) {
	where, args := projectScopedAdminWhere(url.Values{
		"current_user_project_admin_project_codes": {"PRJ-CODE"},
	}, "p")

	if where != "(p.project_code IN (?))" {
		t.Fatalf("explicit project code scope must remain code-only, got %s", where)
	}
	if strings.Contains(where, "aims_project_members") || strings.Contains(where, "leader_uid") {
		t.Fatalf("explicit project code scope unexpectedly borrowed a relation: %s", where)
	}
	if len(args) != 1 || args[0] != "PRJ-CODE" {
		t.Fatalf("explicit code args = %#v", args)
	}
}

func TestProjectScopedAdminWhereDoesNotCrossPairRelationAndCodeBranches(t *testing.T) {
	where, args := projectScopedAdminWhere(url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_member_project_codes": {"PRJ-MEMBER"},
		"current_user_project_admin_project_codes":        {"PRJ-CODE"},
	}, "p")

	memberAndCode := "(EXISTS (SELECT 1 FROM aims_project_members pam WHERE pam.project_id = p.id AND pam.uid = ? AND pam.status = 'active') AND p.project_code IN (?))"
	if !strings.Contains(where, memberAndCode) || !strings.Contains(where, "p.project_code IN (?)") {
		t.Fatalf("expected independent member+code and code-only branches: %s", where)
	}
	if len(args) != 3 || args[0] != "u1" || args[1] != "PRJ-MEMBER" || args[2] != "PRJ-CODE" {
		t.Fatalf("branch args must stay ordered and unpaired, got %#v", args)
	}
}

func TestProjectVisibilityWhereBindsValuedMemberScopeAndArguments(t *testing.T) {
	where, args := projectVisibilityWhere(url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_member_project_codes": {"PRJ-1,PRJ-2"},
	}, "p", "u1")

	memberAndCode := "(EXISTS (SELECT 1 FROM aims_project_members pam WHERE pam.project_id = p.id AND pam.uid = ? AND pam.status = 'active') AND p.project_code IN (?,?))"
	if !strings.Contains(where, memberAndCode) {
		t.Fatalf("list visibility must bind member relation and exact project codes: %s", where)
	}
	if len(args) < 3 || args[len(args)-3] != "u1" || args[len(args)-2] != "PRJ-1" || args[len(args)-1] != "PRJ-2" {
		t.Fatalf("valued visibility args must end with actor then exact project codes, got %#v", args)
	}
}
