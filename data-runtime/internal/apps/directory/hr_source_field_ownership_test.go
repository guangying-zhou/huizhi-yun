package directory

import (
	"os"
	"strings"
	"testing"
)

func TestDingTalkMappedDepartmentAuthoritativeFieldsAreIdentified(t *testing.T) {
	for _, field := range []string{"deptName", "name", "parentDeptCode", "managerId", "sortOrder", "status", "orgType"} {
		if !consoleDingTalkAuthoritativeDepartmentMutation(map[string]any{field: "changed"}) {
			t.Fatalf("field %s must remain DingTalk-managed", field)
		}
	}
	if consoleDingTalkAuthoritativeDepartmentMutation(map[string]any{
		"leaderId": "leader-1", "description": "local note", "deptCategory": "business",
	}) {
		t.Fatal("HZY-owned department metadata must remain editable")
	}
}

func TestLDAPCannotBackfillBlankPeopleOwnedProfileFields(t *testing.T) {
	source, err := os.ReadFile("sync.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, unsafeFallback := range []string{
		"directory_users.display_name IS NULL",
		"directory_users.real_name IS NULL",
		"directory_users.email IS NULL",
		"directory_users.mobile IS NULL",
		"directory_users.position_title IS NULL",
	} {
		if strings.Contains(text, unsafeFallback) {
			t.Fatalf("LDAP still backfills an authoritative blank field: %s", unsafeFallback)
		}
	}
}

func TestLegacyDepartmentAliasesKeepCompatibilityMembershipProjection(t *testing.T) {
	mappingSource, err := os.ReadFile("console_dingtalk_department_mapping.go")
	if err != nil {
		t.Fatal(err)
	}
	projectionSource, err := os.ReadFile("projection.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(mappingSource), "SET is_primary=0,status='active',left_at=NULL") {
		t.Fatal("mapping must retain a non-primary compatibility membership for legacy department references")
	}
	if !strings.Contains(string(projectionSource), "directory_department_aliases alias") {
		t.Fatal("Platform projection must recognize active legacy department aliases")
	}
	rebuildSource, err := os.ReadFile("console_sync_jobs.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(rebuildSource), "CASE WHEN alias.alias_dept_code IS NOT NULL THEN 'active'") {
		t.Fatal("subject rebuild must retain active compatibility alias subjects")
	}
}

func TestPeopleOwnedEmployeeFieldsRejectOrdinaryConsoleOverwrite(t *testing.T) {
	for _, field := range []string{"displayName", "realName", "nickname", "email", "mobile", "mobileTail4", "positionTitle", "primaryDeptCode", "userType"} {
		if !consolePeopleAuthoritativeUserMutation(map[string]any{field: "changed"}) {
			t.Fatalf("field %s must remain People-managed", field)
		}
	}
	if !consolePeopleAuthoritativeUserMutation(map[string]any{"status": "active"}) {
		t.Fatal("ordinary Console edit must not reactivate a People-managed employee")
	}
	if consolePeopleAuthoritativeUserMutation(map[string]any{"status": "inactive"}) {
		t.Fatal("Console must retain its emergency account-disable action")
	}
	if consolePeopleAuthoritativeUserMutation(map[string]any{"username": "login", "avatarUrl": "avatar", "remark": "note"}) {
		t.Fatal("authentication and local presentation fields remain Console-owned")
	}
}
