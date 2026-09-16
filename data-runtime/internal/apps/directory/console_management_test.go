package directory

import (
	"context"
	"net/url"
	"strconv"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestBoundedPageRejectsLegacyUnboundedDirectoryReads(t *testing.T) {
	page, size, err := boundedPage(url.Values{})
	if err != nil || page != 1 || size != 20 {
		t.Fatalf("unexpected defaults page=%d size=%d err=%v", page, size, err)
	}
	if _, _, err := boundedPage(url.Values{"pageSize": {"500"}}); err == nil {
		t.Fatal("expected legacy pageSize=500 to be rejected")
	}
	page, size, err = boundedPage(url.Values{"page": {"2"}, "limit": {"100"}})
	if err != nil || page != 2 || size != 100 {
		t.Fatalf("unexpected bounded page page=%d size=%d err=%v", page, size, err)
	}
}

func TestConsoleDirectoryAccountMappings(t *testing.T) {
	if accountStatus("active") != 1 || accountStatus("inactive") != 0 || accountStatus("deleted") != -1 {
		t.Fatal("directory account status compatibility mapping drifted")
	}
	if boolInt(true) != 1 || boolInt(false) != 0 {
		t.Fatal("boolean compatibility mapping drifted")
	}
}

func TestConsoleDirectoryMutationValidation(t *testing.T) {
	if _, err := enumConsoleValue("invalid", "active", []string{"active", "inactive"}, "invalid"); err == nil {
		t.Fatal("expected invalid enum to fail closed")
	}
	if err := rejectUnknownConsoleFields(
		map[string]any{"uid": "U1001", "credential": "must-not-cross-runtime-boundary"},
		consoleDirectoryUserFields,
	); err == nil {
		t.Fatal("expected unknown mutation field to be rejected")
	}
	if got := consoleMobileTail4("13800138000", ""); got != "8000" {
		t.Fatalf("unexpected mobile tail: %q", got)
	}
}

func TestConsoleDirectoryMutationBatchesAreBounded(t *testing.T) {
	members := make([]any, 101)
	for index := range members {
		members[index] = map[string]any{"uid": "U" + strconv.Itoa(index), "role": "member"}
	}
	if _, err := normalizeConsoleProjectMembers(map[string]any{"members": members}); err == nil {
		t.Fatal("expected oversized project member batch to be rejected")
	}
	if _, err := normalizeConsoleCommitteeMembers(map[string]any{
		"members": []any{
			map[string]any{"uid": "U1", "role": "leader"},
			map[string]any{"uid": "U2", "role": "leader"},
		},
	}); err == nil {
		t.Fatal("expected duplicate committee leadership to be rejected")
	}
}

func TestConsoleUserProjectsIncludesChildrenInheritedFromParentGroup(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	columns := []string{
		"id", "project_code", "parent_project_code", "project_name", "project_type",
		"dept_code", "owner_uid", "leader_uid", "repo_url", "description", "status",
	}
	mock.ExpectQuery(`(?s)FROM directory_projects p\s+LEFT JOIN directory_projects parent.*WHERE \(p\.leader_uid=\? OR \(parent\.status='active' AND parent\.leader_uid=\?\)\).*p\.parent_project_code=\?.*LIMIT 101`).
		WithArgs("zhouguangying", "zhouguangying", "huizhi-yun").
		WillReturnRows(sqlmock.NewRows(columns).
			AddRow(1, "huizhi-yun/console", "huizhi-yun", "console", "project", nil, nil, nil, "https://gitlab.wiztek.cn/huizhi-yun/console", nil, "active").
			AddRow(2, "huizhi-yun/data-runtime", "huizhi-yun", "data-runtime", "project", nil, nil, nil, "https://gitlab.wiztek.cn/huizhi-yun/data-runtime", nil, "active"))
	mock.ExpectQuery(`(?s)FROM directory_projects p\s+LEFT JOIN directory_projects parent.*EXISTS \(SELECT 1 FROM directory_project_members direct_pm.*EXISTS \(SELECT 1 FROM directory_project_members inherited_pm.*p\.parent_project_code=\?.*LIMIT 101`).
		WithArgs("zhouguangying", "zhouguangying", "zhouguangying", "zhouguangying", "huizhi-yun").
		WillReturnRows(sqlmock.NewRows(columns))

	result, err := (&Adapter{db: database}).ConsoleUserProjects(context.Background(), "zhouguangying", url.Values{
		"parent_id":        {"huizhi-yun"},
		"include_template": {"false"},
	})
	if err != nil {
		t.Fatal(err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 2 {
		t.Fatalf("expected both inherited group repositories, got %#v", result["items"])
	}
	if items[0]["projectCode"] != "huizhi-yun/console" || items[1]["projectCode"] != "huizhi-yun/data-runtime" {
		t.Fatalf("unexpected inherited repositories: %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleUserProjectsIncludesChildrenForParentGroupMember(t *testing.T) {
	database, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	columns := []string{
		"id", "project_code", "parent_project_code", "project_name", "project_type",
		"dept_code", "owner_uid", "leader_uid", "repo_url", "description", "status",
	}
	mock.ExpectQuery(`(?s)FROM directory_projects p\s+LEFT JOIN directory_projects parent.*p\.parent_project_code=\?.*LIMIT 101`).
		WithArgs("group-member", "group-member", "huizhi-yun").
		WillReturnRows(sqlmock.NewRows(columns))
	mock.ExpectQuery(`(?s)EXISTS \(SELECT 1 FROM directory_project_members inherited_pm.*inherited_pm\.project_code=parent\.project_code.*p\.parent_project_code=\?.*LIMIT 101`).
		WithArgs("group-member", "group-member", "group-member", "group-member", "huizhi-yun").
		WillReturnRows(sqlmock.NewRows(columns).
			AddRow(3, "huizhi-yun/webdev", "huizhi-yun", "webdev", "project", nil, nil, nil, "https://gitlab.wiztek.cn/huizhi-yun/webdev", nil, "active"))

	result, err := (&Adapter{db: database}).ConsoleUserProjects(context.Background(), "group-member", url.Values{
		"parentId": {"huizhi-yun"},
	})
	if err != nil {
		t.Fatal(err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 1 || items[0]["projectCode"] != "huizhi-yun/webdev" {
		t.Fatalf("expected repository inherited from parent group membership, got %#v", result["items"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestConsoleUserProjectsRejectsInvalidParentProjectCode(t *testing.T) {
	if _, err := (&Adapter{}).ConsoleUserProjects(context.Background(), "group-member", url.Values{
		"parent_id": {"invalid project code"},
	}); err == nil {
		t.Fatal("expected invalid parent project code to fail before database access")
	}
}
