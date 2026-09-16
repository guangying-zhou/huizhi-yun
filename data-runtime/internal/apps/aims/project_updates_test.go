package aims

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestHasProjectAdminFlagSupportsSnakeAndCamelQueryKeys(t *testing.T) {
	if !hasProjectAdminFlag(url.Values{"current_user_is_project_admin": {"1"}}) {
		t.Fatal("expected snake_case admin flag to be accepted")
	}
	if !hasProjectAdminFlag(url.Values{"currentUserIsProjectAdmin": {"1"}}) {
		t.Fatal("expected camelCase admin flag to be accepted")
	}
	if hasProjectAdminFlag(url.Values{"current_user_is_project_admin": {"0"}}) {
		t.Fatal("expected disabled admin flag to be rejected")
	}
}

func TestIsAdminProjectObjectPathRequiresDirectAdminProjectID(t *testing.T) {
	if !isAdminProjectObjectPath("/v1/aims/admin/projects/42") {
		t.Fatal("expected direct admin project path to match")
	}
	if isAdminProjectObjectPath("/v1/aims/projects/42") {
		t.Fatal("expected member project path to be rejected")
	}
	if isAdminProjectObjectPath("/v1/aims/admin/projects/42/members") {
		t.Fatal("expected nested admin project path to be rejected")
	}
}

func TestAdminProjectRuntimeRoutesUseDedicatedHandlers(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	listIndex := strings.Index(content, `if path == "/v1/aims/admin/projects"`)
	if listIndex == -1 {
		t.Fatal("missing admin project list route")
	}
	listSegment := content[listIndex:]
	if !strings.Contains(listSegment, "a.adminProjects(ctx, query)") {
		t.Fatal("admin project list must use dedicated adminProjects handler")
	}
	if genericIndex := strings.Index(listSegment, "a.Adapter.HandleRuntime"); genericIndex != -1 {
		adminIndex := strings.Index(listSegment, "a.adminProjects(ctx, query)")
		if adminIndex == -1 || genericIndex < adminIndex {
			t.Fatal("admin project list must not fall through generic runtime before adminProjects")
		}
	}

	updateBlockIndex := strings.Index(content, "if method == http.MethodPatch || method == http.MethodPut {")
	if updateBlockIndex == -1 {
		t.Fatal("missing update block")
	}
	updateBlock := content[updateBlockIndex:]
	updateIndex := strings.Index(updateBlock, `if projectID, ok := directPathParam(path, "/v1/aims/admin/projects/"); ok {`)
	if updateIndex == -1 {
		t.Fatal("missing admin project update route")
	}
	updateSegment := updateBlock[updateIndex:]
	updateCall := strings.Index(updateSegment, "updateProjectWithLeaderSync(ctx, method, path, query, body, projectID)")
	updateGeneric := strings.Index(updateSegment, "a.Adapter.HandleRuntime")
	if updateCall == -1 {
		t.Fatal("admin project update must use updateProjectWithLeaderSync")
	}
	if updateGeneric != -1 && updateGeneric < updateCall {
		t.Fatal("admin project update must not fall through generic runtime before updateProjectWithLeaderSync")
	}

	deleteBlockIndex := strings.Index(content, "if method == http.MethodDelete {")
	if deleteBlockIndex == -1 {
		t.Fatal("missing delete block")
	}
	deleteBlock := content[deleteBlockIndex:]
	deleteIndex := strings.Index(deleteBlock, `if projectID, ok := directPathParam(path, "/v1/aims/admin/projects/"); ok {`)
	if deleteIndex == -1 {
		t.Fatal("missing admin project delete route")
	}
	deleteSegment := deleteBlock[deleteIndex:]
	deleteCall := strings.Index(deleteSegment, "adminDeleteProject(ctx, projectID, query, body)")
	deleteGeneric := strings.Index(deleteSegment, "a.Adapter.HandleRuntime")
	if deleteCall == -1 {
		t.Fatal("admin project delete must use adminDeleteProject")
	}
	if deleteGeneric != -1 && deleteGeneric < deleteCall {
		t.Fatal("admin project delete must not fall through generic runtime before adminDeleteProject")
	}
}

func TestProjectAuthorizationObjectPathRequiresDedicatedSuffix(t *testing.T) {
	projectID, ok := projectAuthorizationObjectPath("/v1/aims/projects/42/authorization-object")
	if !ok || projectID != "42" {
		t.Fatalf("expected authorization object path to match, projectID=%q ok=%v", projectID, ok)
	}
	if _, ok := projectAuthorizationObjectPath("/v1/aims/projects/42"); ok {
		t.Fatal("expected project detail path to be rejected")
	}
	if _, ok := projectAuthorizationObjectPath("/v1/aims/admin/projects/42/authorization-object"); ok {
		t.Fatal("expected admin project path to be rejected")
	}
}

func TestProjectVisibilityWhereIncludesScopedAdminOverride(t *testing.T) {
	query := url.Values{"current_user_is_project_admin": {"1"}}
	where, args := projectVisibilityWhere(query, "p", "u1")

	if !strings.Contains(where, "1 = 1") {
		t.Fatalf("expected admin override in visibility where clause: %s", where)
	}
	if len(args) != 4 {
		t.Fatalf("expected only default current-user args, got %d: %#v", len(args), args)
	}
}

func TestProjectVisibilityWhereIncludesProjectAdminListScopes(t *testing.T) {
	query := url.Values{
		"current_user_project_admin_dept_codes":    {"dept-a,dept-b"},
		"current_user_project_admin_project_codes": {"proj-a,proj-b"},
	}
	where, args := projectVisibilityWhere(query, "p", "u1")

	if !strings.Contains(where, "p.dept_code IN (?,?)") {
		t.Fatalf("expected project admin dept scope in visibility where clause: %s", where)
	}
	if !strings.Contains(where, "p.project_code IN (?,?)") {
		t.Fatalf("expected project admin project scope in visibility where clause: %s", where)
	}
	if len(args) != 8 {
		t.Fatalf("expected default current-user args plus four scope args, got %d: %#v", len(args), args)
	}
}

func TestProjectAndUserTimeEntriesUseRuntimeAccessGuards(t *testing.T) {
	contentBytes, err := os.ReadFile("time_entries.go")
	if err != nil {
		t.Fatalf("read time_entries.go: %v", err)
	}
	content := string(contentBytes)

	projectIndex := strings.Index(content, "func (a *Adapter) projectTimeEntries")
	if projectIndex == -1 {
		t.Fatal("missing projectTimeEntries")
	}
	projectSegment := content[projectIndex:]
	readGuardIndex := strings.Index(projectSegment, "requireProjectTimesheetReadAccess")
	listIndex := strings.Index(projectSegment, "return a.listTimeEntries")
	if readGuardIndex == -1 {
		t.Fatal("projectTimeEntries must require project timesheet read access")
	}
	if listIndex == -1 || readGuardIndex > listIndex {
		t.Fatal("projectTimeEntries must check read access before listing time entries")
	}

	userIndex := strings.Index(content, "func (a *Adapter) userTimeEntries")
	if userIndex == -1 {
		t.Fatal("missing userTimeEntries")
	}
	userSegment := content[userIndex:projectIndex]
	if !strings.Contains(userSegment, "currentUser := strings.TrimSpace(query.Get(\"current_user\"))") {
		t.Fatal("userTimeEntries must read current_user from trusted query")
	}
	if !strings.Contains(userSegment, "uid != currentUser") || !strings.Contains(userSegment, "forbidden_user_timesheet") {
		t.Fatal("userTimeEntries must reject reading another user's timesheet")
	}

	readAccessIndex := strings.Index(content, "func (a *Adapter) requireProjectTimesheetReadAccess")
	if readAccessIndex == -1 {
		t.Fatal("missing requireProjectTimesheetReadAccess")
	}
	readAccessSegment := content[readAccessIndex:]
	if !strings.Contains(readAccessSegment, "currentUserIsProjectAdmin(query)") {
		t.Fatal("requireProjectTimesheetReadAccess must honor scoped project admin context")
	}
	if !strings.Contains(readAccessSegment, "projectVisibilityWhere(query, \"p\", uid)") {
		t.Fatal("requireProjectTimesheetReadAccess must reuse project visibility scope")
	}
}

func TestProjectScopedAdminWhereUsesOnlyAdminScopes(t *testing.T) {
	query := url.Values{
		"current_user_project_admin_dept_codes":    {"dept-a,dept-b"},
		"current_user_project_admin_project_codes": {"proj-a,proj-b"},
	}
	where, args := projectScopedAdminWhere(query, "p")

	if strings.Contains(where, "leader_uid") || strings.Contains(where, "created_by") || strings.Contains(where, "access_whitelist") || strings.Contains(where, "security_level") {
		t.Fatalf("project scoped admin clause must not include ordinary visibility branches: %s", where)
	}
	if !strings.Contains(where, "COALESCE(p.confidentiality_level, 'L1') <> 'L3' AND p.dept_code IN (?,?)") {
		t.Fatalf("expected scoped admin dept branch in where clause: %s", where)
	}
	if !strings.Contains(where, "p.project_code IN (?,?)") {
		t.Fatalf("expected scoped admin project branch in where clause: %s", where)
	}
	if len(args) != 4 {
		t.Fatalf("expected four scoped admin args, got %d: %#v", len(args), args)
	}
}

func TestProjectScopedAdminWhereSupportsTrustedRelationScopes(t *testing.T) {
	query := url.Values{
		"current_user": {"u1"},
		"current_user_project_admin_member_scope": {"1"},
		"current_user_project_admin_owner_scope":  {"1"},
	}
	where, args := projectScopedAdminWhere(query, "p")

	if !strings.Contains(where, "p.leader_uid = ?") {
		t.Fatalf("expected scoped project owner branch in where clause: %s", where)
	}
	if !strings.Contains(where, "EXISTS (SELECT 1 FROM aims_project_members pam WHERE pam.project_id = p.id AND pam.uid = ? AND pam.status = 'active')") {
		t.Fatalf("expected scoped project member branch in where clause: %s", where)
	}
	if len(args) != 2 || args[0] != "u1" || args[1] != "u1" {
		t.Fatalf("expected trusted actor args for relation scopes, got %#v", args)
	}
}

func TestProjectScopedAdminWhereRequiresActorForRelationScopes(t *testing.T) {
	query := url.Values{
		"current_user_project_admin_member_scope": {"1"},
		"current_user_project_admin_owner_scope":  {"1"},
	}
	where, args := projectScopedAdminWhere(query, "p")

	if where != "1 = 0" {
		t.Fatalf("expected relation scopes without trusted actor to reject, got %s", where)
	}
	if len(args) != 0 {
		t.Fatalf("expected no args, got %#v", args)
	}
}

func TestProjectScopedAdminWhereRejectsWhenNoAdminScope(t *testing.T) {
	where, args := projectScopedAdminWhere(url.Values{"current_user_dept_codes": {"dept-a"}}, "p")
	if where != "1 = 0" {
		t.Fatalf("expected no admin scope to reject, got %s", where)
	}
	if len(args) != 0 {
		t.Fatalf("expected no args, got %#v", args)
	}
}

func TestRequireProjectManagerOrScopedAdminAllowsScopedDeptAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireProjectManagerOrScopedAdmin(
		context.Background(),
		42,
		"u1",
		url.Values{"current_user_project_admin_dept_codes": {"dept-a"}},
	)
	if err != nil {
		t.Fatalf("expected scoped dept admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireProjectManagerOrScopedAdminRejectsUnauthorizedUser(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))

	err := adapter.requireProjectManagerOrScopedAdmin(context.Background(), 42, "u1", url.Values{})
	if err == nil {
		t.Fatal("expected unauthorized user to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_manager_required" {
		t.Fatalf("expected project_manager_required 403, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireProjectMemberOrScopedAdminAllowsProjectMember(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireProjectMemberOrScopedAdmin(context.Background(), 42, "u1", url.Values{})
	if err != nil {
		t.Fatalf("expected project member to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireProjectMemberOrScopedAdminAllowsScopedProjectAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireProjectMemberOrScopedAdmin(
		context.Background(),
		42,
		"u1",
		url.Values{"current_user_project_admin_project_codes": {"proj-a"}},
	)
	if err != nil {
		t.Fatalf("expected scoped project admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireProjectMemberOrScopedAdminRejectsUnauthorizedUser(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))

	err := adapter.requireProjectMemberOrScopedAdmin(context.Background(), 42, "u1", url.Values{})
	if err == nil {
		t.Fatal("expected unauthorized user to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_member_required" {
		t.Fatalf("expected project_member_required 403, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireWorkItemProjectMemberOrScopedAdminUsesWorkItemProject(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id\\s+FROM work_items\\s+WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireWorkItemProjectMemberOrScopedAdmin(
		context.Background(),
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemChildrenRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT\\s+wi\\.id,.*FROM work_items wi").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"item_key",
			"title",
			"status",
			"assignee_uid",
			"assignee_name",
			"estimated_hours",
			"start_date",
			"due_date",
			"description",
			"priority",
			"approval_status",
			"created_at",
		}).AddRow(
			int64(11),
			"AIMS-11",
			"Child item",
			"todo",
			"u2",
			nil,
			1.5,
			"2026-06-30",
			"2026-07-01",
			"child",
			"P1",
			"not_required",
			"2026-06-30 10:00:00",
		))

	children, err := adapter.workItemChildren(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read children, got %v", err)
	}
	if len(children) != 1 || children[0].ID != int64(11) {
		t.Fatalf("unexpected children: %#v", children)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemTransitionsRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT tier, status\\s+FROM work_items").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"tier", "status"}).AddRow("task", "todo"))
	mock.ExpectQuery("SELECT to_status, transition_key\\s+FROM workflow_transitions").
		WithArgs(int64(42), "task", "todo").
		WillReturnRows(sqlmock.NewRows([]string{"to_status", "transition_key"}).AddRow("in_progress", "start"))

	transitions, err := adapter.workItemTransitions(
		context.Background(),
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read transitions, got %v", err)
	}
	if len(transitions) != 1 || transitions[0].ToStatus != "in_progress" {
		t.Fatalf("unexpected transitions: %#v", transitions)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemCommitsRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id, repo_project_code, commit_sha, message, author_name, author_email, committed_at").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"repo_project_code",
			"commit_sha",
			"message",
			"author_name",
			"author_email",
			"committed_at",
		}).AddRow(int64(77), "repo-a", "abc", "message", "Author", "author@example.com", "2026-06-30 10:00:00"))

	commits, err := adapter.workItemCommits(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read commits, got %v", err)
	}
	if len(commits) != 1 || commits[0].ID != int64(77) {
		t.Fatalf("unexpected commits: %#v", commits)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkWorkItemCommitRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectExec("UPDATE gitlab_commits SET work_item_id = \\? WHERE id = \\? AND project_id = \\?").
		WithArgs(int64(10), int64(77), int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	data, err := adapter.linkWorkItemCommit(
		context.Background(),
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
		map[string]any{"commitId": int64(77)},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to link commit, got %v", err)
	}
	if data["workItemId"] != int64(10) || data["commitId"] != int64(77) {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUnlinkWorkItemCommitRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectExec("UPDATE gitlab_commits SET work_item_id = NULL WHERE id = \\? AND work_item_id = \\? AND project_id = \\?").
		WithArgs(int64(77), int64(10), int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	data, err := adapter.unlinkWorkItemCommit(
		context.Background(),
		"10",
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to unlink commit, got %v", err)
	}
	if data["workItemId"] != int64(10) || data["commitId"] != int64(77) {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemCommitDiffMetadataRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT commit_sha, repo_project_code\\s+FROM gitlab_commits").
		WithArgs(int64(77), int64(10), int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"commit_sha", "repo_project_code"}).AddRow("abc123", "repo-a"))

	data, err := adapter.workItemCommitDiffMetadata(
		context.Background(),
		"10",
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read commit diff metadata, got %v", err)
	}
	if data["workItemId"] != int64(10) || data["id"] != int64(77) || data["repoProjectCode"] != "repo-a" || data["commitSha"] != "abc123" {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpdateWorkItemCommitFilesChangedRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectExec("UPDATE gitlab_commits\\s+SET files_changed = \\?\\s+WHERE id = \\? AND work_item_id = \\? AND project_id = \\?").
		WithArgs(int64(5), int64(77), int64(10), int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	data, err := adapter.updateWorkItemCommitFilesChanged(
		context.Background(),
		"10",
		"77",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
		map[string]any{"filesChanged": int64(5)},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to update commit files changed, got %v", err)
	}
	if data["workItemId"] != int64(10) || data["commitId"] != int64(77) || data["filesChanged"] != int64(5) {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemCommitDiffRoutesUseDedicatedHandlers(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	getIndex := strings.Index(content, `workItemCommitSubPath(path, "/diff-metadata")`)
	if getIndex == -1 {
		t.Fatal("missing work item commit diff metadata route")
	}
	getSegment := content[getIndex:]
	if !strings.Contains(getSegment, "a.workItemCommitDiffMetadata(ctx, workItemID, commitID, query)") {
		t.Fatal("diff metadata route must use dedicated handler")
	}

	postIndex := strings.Index(content, `workItemCommitSubPath(path, "/files-changed")`)
	if postIndex == -1 {
		t.Fatal("missing work item commit files changed route")
	}
	postSegment := content[postIndex:]
	if !strings.Contains(postSegment, "a.updateWorkItemCommitFilesChanged(ctx, workItemID, commitID, query, body)") {
		t.Fatal("files changed route must use dedicated handler")
	}
}

func TestUpdateWorkItemDeliverableRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT wi\\.project_id\\s+FROM work_items wi\\s+JOIN deliverables d").
		WithArgs(int64(77), int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT COALESCE\\(d\\.milestone_owner_id, matter\\.milestone_id, target\\.milestone_id\\).*FROM deliverables d").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))
	mock.ExpectExec("UPDATE deliverables SET status = \\?, submitted_by = \\?, submitted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = \\?").
		WithArgs("submitted", "u1", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("(?s)SELECT id, target_id, matter_id, name, description, acceptance_criteria, deliverable_type,.*FROM deliverables").
		WithArgs("10", "10").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"target_id",
			"matter_id",
			"name",
			"description",
			"acceptance_criteria",
			"deliverable_type",
			"required",
			"status",
			"document_uuid",
			"document_title",
			"document_source",
			"repo_project_code",
			"repo_file_path",
			"repo_commit_id",
			"evidence_url",
			"evidence_note",
			"submitted_by",
			"submitted_at",
			"created_at",
			"updated_at",
		}).AddRow(
			int64(77),
			nil,
			int64(10),
			"项目计划书",
			nil,
			"需包含里程碑计划",
			"document",
			int64(1),
			"submitted",
			"doc-uuid-77",
			"汇智云项目计划书",
			"codocs",
			nil,
			nil,
			nil,
			nil,
			nil,
			"u1",
			"2026-08-25 12:00:00",
			"2026-08-25 11:00:00",
			"2026-08-25 12:00:00",
		))

	data, err := adapter.updateWorkItemDeliverable(
		context.Background(),
		"10",
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
		map[string]any{"status": "submitted", "current_user": "spoofed"},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to update deliverable, got %v", err)
	}
	if data["workItemId"] != int64(10) || data["deliverableId"] != int64(77) || data["updated"] != true {
		t.Fatalf("unexpected data: %#v", data)
	}
	updated, ok := data["deliverable"].(*executionDeliverable)
	if !ok || updated.ID != int64(77) || updated.DocumentUUID == nil || *updated.DocumentUUID != "doc-uuid-77" || updated.DocumentTitle == nil || *updated.DocumentTitle != "汇智云项目计划书" {
		t.Fatalf("updated deliverable snapshot missing from response: %#v", data["deliverable"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemDeliverableRouteUsesSpecializedRuntimeBeforeGenericWorkItemFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	patchIndex := strings.Index(content, "if method == http.MethodPatch || method == http.MethodPut")
	if patchIndex == -1 {
		t.Fatal("missing PATCH/PUT branch")
	}
	patchSegment := content[patchIndex:]
	deliverableIndex := strings.Index(patchSegment, "a.updateWorkItemDeliverable")
	directWorkItemIndex := strings.Index(patchSegment, "directPathParam(path, \"/v1/aims/work-items/\")")
	if deliverableIndex == -1 {
		t.Fatal("missing specialized deliverable update route")
	}
	if directWorkItemIndex == -1 {
		t.Fatal("missing direct work item fallback")
	}
	if deliverableIndex > directWorkItemIndex {
		t.Fatal("deliverable update route must run before direct work item fallback")
	}
}

func TestWorkItemCommentsRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM work_item_comments WHERE work_item_id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id, work_item_id, author_uid, content, created_at, updated_at").
		WithArgs(int64(10), 20, 0).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"work_item_id",
			"author_uid",
			"content",
			"created_at",
			"updated_at",
		}).AddRow(int64(88), int64(10), "u1", "comment", "2026-06-30 10:00:00", "2026-06-30 10:00:00"))

	data, err := adapter.workItemComments(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read comments, got %v", err)
	}
	items, ok := data["items"].([]workItemComment)
	if !ok || len(items) != 1 || items[0].ID != int64(88) {
		t.Fatalf("unexpected comments: %#v", data["items"])
	}
	if data["total"] != int64(1) || data["page"] != 1 || data["pageSize"] != 20 {
		t.Fatalf("unexpected pagination: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateWorkItemCommentRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectExec("INSERT INTO work_item_comments").
		WithArgs(int64(10), "u1", "comment").
		WillReturnResult(sqlmock.NewResult(88, 1))
	mock.ExpectQuery("SELECT id, work_item_id, author_uid, content, created_at, updated_at").
		WithArgs(int64(88), int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"work_item_id",
			"author_uid",
			"content",
			"created_at",
			"updated_at",
		}).AddRow(int64(88), int64(10), "u1", "comment", "2026-06-30 10:00:00", "2026-06-30 10:00:00"))

	comment, err := adapter.createWorkItemComment(
		context.Background(),
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
		map[string]any{"content": " comment "},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to create comment, got %v", err)
	}
	if comment.ID != int64(88) || comment.Content != "comment" {
		t.Fatalf("unexpected comment: %#v", comment)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemDocumentsRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT wi\\.id, wi\\.project_id, p\\.project_code\\s+FROM work_items wi").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "project_code"}).AddRow(int64(10), int64(42), "proj-a"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id, work_item_id, COALESCE\\(codocs_uuid, uuid\\) AS document_id").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"work_item_id",
			"document_id",
			"created_by",
			"created_at",
			"title",
		}).AddRow(int64(77), int64(10), "doc-1", "u1", "2026-06-30 10:00:00", "需求文档"))

	documents, err := adapter.workItemDocuments(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read documents, got %v", err)
	}
	if len(documents) != 1 || documents[0].DocumentID != "doc-1" {
		t.Fatalf("unexpected documents: %#v", documents)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestLinkWorkItemDocumentRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT wi\\.id, wi\\.project_id, p\\.project_code\\s+FROM work_items wi").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "project_code"}).AddRow(int64(10), int64(42), "proj-a"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT id\\s+FROM project_documents").
		WithArgs(int64(10), "doc-1", "doc-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("SELECT uuid, title, doc_category, oss_path, codocs_uuid, content_size").
		WithArgs("doc-1", "doc-1", "doc-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"uuid",
			"title",
			"doc_category",
			"oss_path",
			"codocs_uuid",
			"content_size",
		}).AddRow("source-uuid", "需求文档", "requirement", nil, "doc-1", int64(123)))
	mock.ExpectExec("INSERT INTO project_documents").
		WithArgs(sqlmock.AnyArg(), int64(42), "proj-a", int64(10), "需求文档", "requirement", nil, "doc-1", int64(123), "u1", "u1").
		WillReturnResult(sqlmock.NewResult(88, 1))

	data, err := adapter.linkWorkItemDocument(
		context.Background(),
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
		map[string]any{"documentId": "doc-1"},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to link document, got %v", err)
	}
	if data["workItemId"] != int64(10) || data["documentId"] != "doc-1" {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUnlinkWorkItemDocumentRequiresProjectManagerOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT wi\\.id, wi\\.project_id, p\\.project_code\\s+FROM work_items wi").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "project_code"}).AddRow(int64(10), int64(42), "proj-a"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectExec("DELETE FROM project_documents").
		WithArgs(int64(10), "doc-1", "doc-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	data, err := adapter.unlinkWorkItemDocument(
		context.Background(),
		"10",
		"doc-1",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped project admin to unlink document, got %v", err)
	}
	if data["deleted"] != true {
		t.Fatalf("unexpected data: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemTimeEntriesRequireProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM time_entries t").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT\\s+t\\.id,.*FROM time_entries t").
		WithArgs(int64(10)).
		WillReturnRows(timeEntryRows().AddRow(
			int64(99),
			int64(10),
			int64(42),
			"proj-a",
			"Project A",
			"PA",
			"AIMS-10",
			"Work item",
			"u1",
			"2026-06-30",
			"2.50",
			"desc",
			"draft",
			nil,
			nil,
			nil,
			int64(1),
			nil,
			nil,
			nil,
			nil,
			"2026-06-30 10:00:00",
			"2026-06-30 10:00:00",
		))

	items, err := adapter.workItemTimeEntries(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to read time entries, got %v", err)
	}
	if len(items) != 1 || items[0].ID != int64(99) || items[0].WorkItemID == nil || *items[0].WorkItemID != int64(10) {
		t.Fatalf("unexpected time entries: %#v", items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateWorkItemTimeEntryRequiresProjectMemberOrScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectExec("INSERT INTO time_entries").
		WithArgs(int64(42), int64(10), "u1", "2026-06-30", 2.5, "implemented").
		WillReturnResult(sqlmock.NewResult(99, 1))
	mock.ExpectQuery("(?s)SELECT\\s+t\\.id,.*FROM time_entries t").
		WithArgs(int64(99)).
		WillReturnRows(timeEntryRows().AddRow(
			int64(99),
			int64(10),
			int64(42),
			"proj-a",
			"Project A",
			"PA",
			"AIMS-10",
			"Work item",
			"u1",
			"2026-06-30",
			"2.50",
			"implemented",
			"draft",
			nil,
			nil,
			nil,
			int64(1),
			nil,
			nil,
			nil,
			nil,
			"2026-06-30 10:00:00",
			"2026-06-30 10:00:00",
		))

	item, err := adapter.createWorkItemTimeEntry(
		context.Background(),
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
		map[string]any{
			"entryDate":   "2026-06-30",
			"hours":       2.5,
			"description": "implemented",
		},
	)
	if err != nil {
		t.Fatalf("expected scoped work item admin to create time entry, got %v", err)
	}
	if item.ID != int64(99) || item.WorkItemID == nil || *item.WorkItemID != int64(10) {
		t.Fatalf("unexpected time entry: %#v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestUpdateWorkItemTimeEntryPreservesOwnerOnly(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT uid, review_status\\s+FROM time_entries").
		WithArgs(int64(99), int64(10), int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"uid", "review_status"}).AddRow("u1", "draft"))
	mock.ExpectExec("UPDATE time_entries").
		WithArgs(3.5, int64(99), int64(10), int64(42), "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("(?s)SELECT\\s+t\\.id,.*FROM time_entries t").
		WithArgs(int64(99)).
		WillReturnRows(timeEntryRows().AddRow(
			int64(99),
			int64(10),
			int64(42),
			"proj-a",
			"Project A",
			"PA",
			"AIMS-10",
			"Work item",
			"u1",
			"2026-06-30",
			"3.50",
			"implemented",
			"draft",
			nil,
			nil,
			nil,
			int64(1),
			nil,
			nil,
			nil,
			nil,
			"2026-06-30 10:00:00",
			"2026-06-30 10:10:00",
		))

	item, err := adapter.updateWorkItemTimeEntry(
		context.Background(),
		"10",
		"99",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
		map[string]any{"hours": 3.5},
	)
	if err != nil {
		t.Fatalf("expected owner to update own time entry, got %v", err)
	}
	if item.ID != int64(99) || item.Hours != 3.5 {
		t.Fatalf("unexpected time entry: %#v", item)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestDeleteWorkItemTimeEntryPreservesOwnerOnly(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM work_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("SELECT uid, review_status\\s+FROM time_entries").
		WithArgs(int64(99), int64(10), int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"uid", "review_status"}).AddRow("u2", "draft"))

	_, err := adapter.deleteWorkItemTimeEntry(
		context.Background(),
		"10",
		"99",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
	)
	if err == nil {
		t.Fatal("expected non-owner delete to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "forbidden_time_entry_delete" {
		t.Fatalf("expected forbidden_time_entry_delete 403, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func timeEntryRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"work_item_id",
		"project_id",
		"project_code",
		"project_name",
		"project_short_name",
		"item_key",
		"item_title",
		"uid",
		"entry_date",
		"hours",
		"description",
		"review_status",
		"review_route",
		"reviewer_uid_snapshot",
		"locked_report_version_id",
		"row_version",
		"submitted_at",
		"reviewed_by",
		"reviewed_at",
		"return_reason",
		"created_at",
		"updated_at",
	})
}

func TestRequireDirectProjectManagedObjectManagerOrScopedAdminUsesObjectProject(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM milestones WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireDirectProjectManagedObjectManagerOrScopedAdmin(
		context.Background(),
		"milestones",
		"10",
		url.Values{
			"current_user":                          {"u1"},
			"current_user_project_admin_dept_codes": {"dept-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped milestone admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireDirectProjectDocumentDeleteAccessAllowsUploader(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COALESCE\\(d.project_id, m.project_id, wi.project_id\\).*FROM project_documents d").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "created_by", "is_folder"}).AddRow(int64(42), "u1", int64(0)))

	err := adapter.requireDirectProjectDocumentDeleteAccess(
		context.Background(),
		"10",
		url.Values{"current_user": {"u1"}},
	)
	if err != nil {
		t.Fatalf("expected uploader to delete own non-folder document, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireDirectProjectDocumentDeleteAccessRequiresManagerForFolder(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COALESCE\\(d.project_id, m.project_id, wi.project_id\\).*FROM project_documents d").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "created_by", "is_folder"}).AddRow(int64(42), "u1", int64(1)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireDirectProjectDocumentDeleteAccess(
		context.Background(),
		"10",
		url.Values{"current_user": {"u1"}},
	)
	if err != nil {
		t.Fatalf("expected project manager to delete folder document, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProcessDirectApprovalDecisionRequiresTrustedPermissionFlag(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	_, err := adapter.processDirectApprovalDecision(
		context.Background(),
		"10",
		url.Values{"current_user": {"u1"}},
		map[string]any{"status": "approved"},
	)
	if err == nil {
		t.Fatal("expected missing trusted approval permission flag to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "approval_permission_required" {
		t.Fatalf("expected approval_permission_required 403, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProcessDirectApprovalDecisionUpdatesProjectApproval(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT project_id, project_owner_id, milestone_owner_id, work_item_owner_id,.*FROM approval_records.*FOR UPDATE").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id",
			"project_owner_id",
			"milestone_owner_id",
			"work_item_owner_id",
			"request_no",
			"workflow_instance_id",
			"transition",
			"reviewer_uid",
			"status",
		}).AddRow(int64(42), int64(42), nil, nil, "", nil, "approve", "u1", "pending"))
	mock.ExpectExec("UPDATE approval_records").
		WithArgs("approved", "u1", nil, int64(10)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE aims_projects SET lifecycle_status = 'active' WHERE id = \\?").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("(?s)SELECT id\\s+FROM milestones\\s+WHERE project_id = \\? AND status = 'active'").
		WithArgs(int64(42)).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("(?s)UPDATE milestones\\s+SET status = 'todo'\\s+WHERE project_id = \\? AND status = 'planning'").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("(?s)UPDATE milestones\\s+SET status = 'active'\\s+WHERE id = \\(").
		WithArgs(int64(42)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.processDirectApprovalDecision(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_approval_decision_authorized": {"1"},
		},
		map[string]any{"status": "approved"},
	)
	if err != nil {
		t.Fatalf("expected approval decision to pass, got %v", err)
	}
	if data["status"] != "approved" {
		t.Fatalf("data status = %#v, want approved", data["status"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestSubmitWorkItemBreakdownUsesTrustedActorAndScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT wi.id, wi.project_id, p.project_code, wi.item_key.*FROM work_items wi.*JOIN aims_projects p").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"project_code",
			"item_key",
			"title",
			"description",
			"start_date",
			"due_date",
			"assignee_uid",
			"approval_status",
		}).AddRow(int64(77), int64(42), "PRJ-1", "WI-1", "任务", "执行说明", "2026-01-01", "2026-01-02", "assignee", "draft"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT id, description, start_date, due_date, assignee_uid\\s+FROM work_items\\s+WHERE parent_id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "description", "start_date", "due_date", "assignee_uid"}))
	mock.ExpectQuery("(?s)SELECT target_id, matter_id, name, acceptance_criteria\\s+FROM deliverables").
		WithArgs(int64(42), int64(77), int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"target_id", "matter_id", "name", "acceptance_criteria"}).
			AddRow(int64(77), nil, "成果", "验收标准"))
	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO approval_records").
		WithArgs(nil, nil, int64(77), "WI-1", "submit_breakdown", "WI-1 工作目标分解提交", "u1", "note", "reviewer-1", int64(42), "PRJ-1").
		WillReturnResult(sqlmock.NewResult(100, 1))
	mock.ExpectExec("UPDATE work_items SET approval_status = \\? WHERE id = \\?").
		WithArgs("pending", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.submitWorkItemBreakdown(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{
			"reviewerUid":    "reviewer-1",
			"requestComment": "note",
			"current_user":   "spoofed",
		},
	)
	if err != nil {
		t.Fatalf("expected submit to pass, got %v", err)
	}
	if data["approvalStatus"] != "pending" {
		t.Fatalf("approvalStatus = %#v, want pending", data["approvalStatus"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWithdrawWorkItemBreakdownUsesTrustedActorAndScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT wi.id, wi.project_id, p.project_code, wi.item_key.*FROM work_items wi.*JOIN aims_projects p").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"project_id",
			"project_code",
			"item_key",
			"title",
			"description",
			"start_date",
			"due_date",
			"assignee_uid",
			"approval_status",
		}).AddRow(int64(77), int64(42), "PRJ-1", "WI-1", "任务", "执行说明", "2026-01-01", "2026-01-02", "assignee", "pending"))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)SELECT id\\s+FROM approval_records.*FOR UPDATE").
		WithArgs(int64(42), int64(77), "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(200)))
	mock.ExpectExec("UPDATE approval_records").
		WithArgs(int64(200)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE work_items SET approval_status = \\? WHERE id = \\?").
		WithArgs("not_required", int64(77)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	data, err := adapter.withdrawWorkItemBreakdown(
		context.Background(),
		"77",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected withdraw to pass, got %v", err)
	}
	if data != nil {
		t.Fatalf("data = %#v, want nil", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateDeliverablesBatchUsesResolvedProjectAndScopedAdmin(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT tier FROM work_items WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"tier"}).AddRow("target"))
	mock.ExpectQuery("(?s)SELECT wi.project_id, p.project_code\\s+FROM work_items wi\\s+JOIN aims_projects p").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "project_code"}).AddRow(int64(42), "PRJ-1"))
	mock.ExpectQuery("SELECT milestone_id FROM work_items WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT id.*FROM deliverables.*LOWER\\(TRIM\\(name\\)\\) = LOWER\\(\\?\\).*target_id = \\?").
		WithArgs(int64(42), "成果", int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectPrepare("INSERT INTO deliverables").
		ExpectExec().
		WithArgs(nil, nil, int64(77), nil, "成果", nil, "标准", "document", 1, int64(0), int64(42), "PRJ-1", "u1", nil).
		WillReturnResult(sqlmock.NewResult(100, 1))
	mock.ExpectCommit()

	data, err := adapter.createDeliverablesBatch(
		context.Background(),
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{
			"items": []any{
				map[string]any{
					"entityType":         "work_item",
					"entityId":           float64(77),
					"name":               "成果",
					"acceptanceCriteria": "标准",
					"projectId":          float64(999),
					"projectCode":        "spoofed",
				},
			},
		},
	)
	if err != nil {
		t.Fatalf("expected deliverable batch to pass, got %v", err)
	}
	if data["created"] != 1 {
		t.Fatalf("created = %#v, want 1", data["created"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestCreateDeliverablesBatchRejectsExistingNameForSameTarget(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT tier FROM work_items WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"tier"}).AddRow("target"))
	mock.ExpectQuery("(?s)SELECT wi.project_id, p.project_code\\s+FROM work_items wi\\s+JOIN aims_projects p").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id", "project_code"}).AddRow(int64(42), "PRJ-1"))
	mock.ExpectQuery("SELECT milestone_id FROM work_items WHERE id = \\?").
		WithArgs(int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"milestone_id"}).AddRow(nil))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM aims_projects WHERE id = \\? FOR UPDATE").
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT id.*FROM deliverables.*LOWER\\(TRIM\\(name\\)\\) = LOWER\\(\\?\\).*target_id = \\?").
		WithArgs(int64(42), "《需求规格说明书》", int64(77)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(207)))
	mock.ExpectRollback()

	_, err := adapter.createDeliverablesBatch(
		context.Background(),
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
		map[string]any{
			"items": []any{
				map[string]any{
					"entityType": "work_item",
					"entityId":   float64(77),
					"name":       " 《需求规格说明书》 ",
				},
			},
		},
	)
	if err == nil || !strings.Contains(err.Error(), "deliverable_name_conflict") {
		t.Fatalf("err = %v, want deliverable_name_conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireRequirementProjectManagerOrScopedAdminUsesRequirementProject(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_items WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "dept-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireRequirementProjectManagerOrScopedAdmin(
		context.Background(),
		10,
		"u1",
		url.Values{"current_user_project_admin_dept_codes": {"dept-a"}},
	)
	if err != nil {
		t.Fatalf("expected scoped requirement admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireRequirementContentProjectManagerOrScopedAdminUsesContentProject(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id FROM requirement_contents WHERE id = \\?").
		WithArgs(int64(20)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireRequirementContentProjectManagerOrScopedAdmin(
		context.Background(),
		20,
		"u1",
		url.Values{"current_user_project_admin_project_codes": {"proj-a"}},
	)
	if err != nil {
		t.Fatalf("expected scoped content admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireProjectEnvironmentManagerOrScopedAdminUsesProjectCode(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT id\\s+FROM aims_projects").
		WithArgs("PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(42)))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "proj-a").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))

	err := adapter.requireProjectEnvironmentManagerOrScopedAdmin(
		context.Background(),
		"PRJ-1",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"proj-a"},
		},
	)
	if err != nil {
		t.Fatalf("expected scoped environment admin to pass, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequireProjectEnvironmentManagerOrScopedAdminSkipsServiceContextWithoutUser(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	if err := adapter.requireProjectEnvironmentManagerOrScopedAdmin(context.Background(), "PRJ-1", url.Values{}); err != nil {
		t.Fatalf("expected service context without current_user to pass through, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestWorkItemDecomposeSubmitRequiresProjectManagerOrScopedAdminBeforeTransaction(t *testing.T) {
	contentBytes, err := os.ReadFile("decompose_submit.go")
	if err != nil {
		t.Fatalf("read decompose_submit.go: %v", err)
	}
	content := string(contentBytes)
	guardIndex := strings.Index(content, "requireProjectManagerOrScopedAdmin")
	templateIndex := strings.Index(content, "allowedDecomposeTemplateKeys")
	txIndex := strings.Index(content, "BeginTx")

	if guardIndex == -1 {
		t.Fatal("expected decompose submit to require project manager or scoped admin")
	}
	if templateIndex == -1 || guardIndex > templateIndex {
		t.Fatal("expected decompose submit authorization before template-specific validation")
	}
	if txIndex == -1 || guardIndex > txIndex {
		t.Fatal("expected decompose submit authorization before starting write transaction")
	}
}

func TestWorkItemDistributionWritesRequireProjectManagerOrScopedAdminBeforeTransaction(t *testing.T) {
	contentBytes, err := os.ReadFile("work_item_distribution.go")
	if err != nil {
		t.Fatalf("read work_item_distribution.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		endToken   string
	}{
		{
			name:       "appendWorkItemTasks",
			startToken: "func (a *Adapter) appendWorkItemTasks",
			endToken:   "func parseDistributionWorkItemID",
		},
		{
			name:       "saveWorkItemBreakdown",
			startToken: "func (a *Adapter) saveWorkItemBreakdown",
			endToken:   "func formatHours",
		},
		{
			name:       "revokeDistributeWorkItems",
			startToken: "func (a *Adapter) revokeDistributeWorkItems",
			endToken:   "func (a *Adapter) saveWorkItemBreakdown",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			endIndex := strings.Index(content[startIndex:], tt.endToken)
			if endIndex == -1 {
				t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
			}
			segment := content[startIndex : startIndex+endIndex]
			guardIndex := strings.Index(segment, "requireProjectManagerOrScopedAdmin")
			txIndex := strings.Index(segment, "BeginTx")
			if guardIndex == -1 {
				t.Fatal("expected project manager or scoped admin guard")
			}
			if txIndex == -1 || guardIndex > txIndex {
				t.Fatal("expected project manager or scoped admin guard before write transaction")
			}
		})
	}
}

func TestWorkItemCloneFromTemplateRequiresProjectManagerOrScopedAdminBeforeTransaction(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_import_actions.go")
	if err != nil {
		t.Fatalf("read requirement_import_actions.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) cloneWorkItemFromTemplate")
	if startIndex == -1 {
		t.Fatal("missing cloneWorkItemFromTemplate")
	}
	endIndex := strings.Index(content[startIndex:], "// ---------- 需求规格书导入 ----------")
	if endIndex == -1 {
		t.Fatal("missing requirement import section marker after cloneWorkItemFromTemplate")
	}
	segment := content[startIndex : startIndex+endIndex]
	guardIndex := strings.Index(segment, "requireProjectManagerOrScopedAdmin")
	templateIndex := strings.Index(segment, `source.templateKey.String != "requirement_change"`)
	txIndex := strings.Index(segment, "BeginTx")
	if guardIndex == -1 {
		t.Fatal("expected clone from template to require project manager or scoped admin")
	}
	if templateIndex == -1 || guardIndex > templateIndex {
		t.Fatal("expected project manager or scoped admin guard before template-specific validation")
	}
	if txIndex == -1 || guardIndex > txIndex {
		t.Fatal("expected project manager or scoped admin guard before write transaction")
	}
}

func TestProjectEnvironmentUserWritesRequireProjectManagerOrScopedAdminBeforeTransaction(t *testing.T) {
	contentBytes, err := os.ReadFile("project_environments.go")
	if err != nil {
		t.Fatalf("read project_environments.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		endToken   string
	}{
		{
			name:       "upsertProjectEnvironmentByProjectCode",
			startToken: "func (a *Adapter) upsertProjectEnvironmentByProjectCode",
			endToken:   "func upsertProjectEnvironmentTx",
		},
		{
			name:       "changeProjectEnvironment",
			startToken: "func (a *Adapter) changeProjectEnvironment",
			endToken:   "func changeProjectEnvironmentTx",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			endIndex := strings.Index(content[startIndex:], tt.endToken)
			if endIndex == -1 {
				t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
			}
			segment := content[startIndex : startIndex+endIndex]
			guardIndex := strings.Index(segment, "requireProjectEnvironmentManagerOrScopedAdmin")
			txIndex := strings.Index(segment, "BeginTx")
			if guardIndex == -1 {
				t.Fatal("expected project environment write to require project manager or scoped admin")
			}
			if txIndex == -1 || guardIndex > txIndex {
				t.Fatal("expected project manager or scoped admin guard before write transaction")
			}
		})
	}
}

func TestDirectWorkItemWritesRequireProjectMemberOrScopedAdminBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		endToken   string
	}{
		{
			name:       "update",
			startToken: "if workItemID, ok := directPathParam(path, \"/v1/aims/work-items/\"); ok {",
			endToken:   "if resource, objectID, ok := directProjectManagedObjectPath(path); ok {",
		},
		{
			name:       "delete",
			startToken: "if method == http.MethodDelete",
			endToken:   "if resource, objectID, ok := directProjectManagedObjectPath(path); ok {",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			segment := content[startIndex:]
			if tt.name == "delete" {
				branchIndex := strings.Index(segment, "if workItemID, ok := directPathParam(path, \"/v1/aims/work-items/\"); ok {")
				if branchIndex == -1 {
					t.Fatal("missing direct work item delete branch")
				}
				segment = segment[branchIndex:]
			}
			endIndex := strings.Index(segment, tt.endToken)
			if endIndex == -1 {
				t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
			}
			segment = segment[:endIndex]
			guardIndex := strings.Index(segment, "requireWorkItemProjectMemberOrScopedAdmin")
			genericIndex := strings.Index(segment, "a.Adapter.HandleRuntime")
			if guardIndex == -1 {
				t.Fatal("expected direct work item write guard")
			}
			if genericIndex == -1 || guardIndex > genericIndex {
				t.Fatal("expected direct work item guard before generic runtime mutation")
			}
		})
	}
}

func TestWorkItemBreakdownContextRequiresProjectMemberOrScopedAdminBeforeDataReads(t *testing.T) {
	contentBytes, err := os.ReadFile("breakdown_context.go")
	if err != nil {
		t.Fatalf("read breakdown_context.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) workItemBreakdownContext")
	if startIndex == -1 {
		t.Fatal("missing workItemBreakdownContext")
	}
	segment := content[startIndex:]

	guardIndex := strings.Index(segment, "requireWorkItemProjectMemberOrScopedAdmin")
	deliverablesIndex := strings.Index(segment, "a.breakdownDeliverables")
	documentsIndex := strings.Index(segment, "a.breakdownDocuments")
	childrenIndex := strings.Index(segment, "a.breakdownChildren")

	if guardIndex == -1 {
		t.Fatal("expected breakdown context to require project member or scoped admin")
	}
	for name, index := range map[string]int{
		"deliverables": deliverablesIndex,
		"documents":    documentsIndex,
		"children":     childrenIndex,
	} {
		if index == -1 {
			t.Fatalf("missing %s data read", name)
		}
		if guardIndex > index {
			t.Fatalf("expected access guard before %s data read", name)
		}
	}
}

func TestDirectProjectManagedObjectWritesRequireProjectManagerOrScopedAdminBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		endToken   string
	}{
		{
			name:       "update",
			startToken: "if resource, objectID, ok := directProjectManagedObjectPath(path); ok {",
			endToken:   "if projectID, ok := directPathParam(path, \"/v1/aims/admin/projects/\"); ok",
		},
		{
			name:       "delete",
			startToken: "if method == http.MethodDelete",
			endToken:   "if projectID, entryID, ok := nestedPathParam(path, \"/v1/aims/projects/\", \"/time-entries/\"); ok",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			segment := content[startIndex:]
			if tt.name == "delete" {
				branchIndex := strings.Index(segment, "if resource, objectID, ok := directProjectManagedObjectPath(path); ok {")
				if branchIndex == -1 {
					t.Fatal("missing direct project managed object delete branch")
				}
				segment = segment[branchIndex:]
			}
			endIndex := strings.Index(segment, tt.endToken)
			if endIndex == -1 {
				t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
			}
			segment = segment[:endIndex]
			guardIndex := strings.Index(segment, "requireDirectProjectManagedObjectManagerOrScopedAdmin")
			genericIndex := strings.Index(segment, "a.Adapter.HandleRuntime")
			if guardIndex == -1 {
				t.Fatal("expected direct project managed object write guard")
			}
			if genericIndex == -1 || guardIndex > genericIndex {
				t.Fatal("expected direct project managed object guard before generic runtime mutation")
			}
		})
	}
}

func TestDirectDocumentsAndApprovalsGuardBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		guardToken string
		endToken   string
	}{
		{
			name:       "document update",
			startToken: "if documentID, ok := directPathParam(path, \"/v1/aims/documents/\"); ok {",
			guardToken: "requireDirectProjectDocumentMemberOrScopedAdmin",
			endToken:   "if approvalID, ok := directPathParam(path, \"/v1/aims/approvals/\"); ok",
		},
		{
			name:       "approval decision",
			startToken: "if approvalID, ok := directPathParam(path, \"/v1/aims/approvals/\"); ok {",
			guardToken: "processDirectApprovalDecision",
			endToken:   "if resource, objectID, ok := directProjectManagedObjectPath(path); ok",
		},
		{
			name:       "document delete",
			startToken: "if documentID, ok := directPathParam(path, \"/v1/aims/documents/\"); ok {",
			guardToken: "requireDirectProjectDocumentDeleteAccess",
			endToken:   "if _, ok := directPathParam(path, \"/v1/aims/approvals/\"); ok",
		},
		{
			name:       "approval delete",
			startToken: "if _, ok := directPathParam(path, \"/v1/aims/approvals/\"); ok {",
			guardToken: "approval_delete_not_supported",
			endToken:   "if resource, objectID, ok := directProjectManagedObjectPath(path); ok",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			segment := content[startIndex:]
			if tt.name == "document delete" || tt.name == "approval delete" {
				deleteIndex := strings.Index(content, "if method == http.MethodDelete")
				if deleteIndex == -1 {
					t.Fatal("missing delete method branch")
				}
				startIndex = strings.Index(content[deleteIndex:], tt.startToken)
				if startIndex == -1 {
					t.Fatalf("missing %s inside delete branch", tt.startToken)
				}
				segment = content[deleteIndex+startIndex:]
			}
			endIndex := strings.Index(segment, tt.endToken)
			if endIndex == -1 {
				t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
			}
			segment = segment[:endIndex]
			guardIndex := strings.Index(segment, tt.guardToken)
			genericIndex := strings.Index(segment, "a.Adapter.HandleRuntime")
			if guardIndex == -1 {
				t.Fatalf("expected %s", tt.guardToken)
			}
			if tt.name != "approval decision" && tt.name != "approval delete" && (genericIndex == -1 || guardIndex > genericIndex) {
				t.Fatalf("expected %s before generic runtime mutation", tt.guardToken)
			}
		})
	}
}

func TestWorkItemDocumentRoutesUseSpecializedRuntimeBeforeGenericFallback(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	getMethodIndex := strings.Index(content, "if method == http.MethodGet {")
	if getMethodIndex == -1 {
		t.Fatal("missing GET method branch")
	}
	getBranch := content[getMethodIndex:]
	getDocumentIndex := strings.Index(getBranch, "a.workItemDocuments(ctx, workItemID, query)")
	getGenericIndex := strings.Index(getBranch, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if getDocumentIndex == -1 || getGenericIndex == -1 || getDocumentIndex > getGenericIndex {
		t.Fatal("work item document GET route must use specialized runtime before generic fallback")
	}

	postMethodIndex := strings.Index(content, "if method == http.MethodPost {")
	if postMethodIndex == -1 {
		t.Fatal("missing POST method branch")
	}
	postBranch := content[postMethodIndex:]
	postDocumentIndex := strings.Index(postBranch, "a.linkWorkItemDocument(ctx, workItemID, query, body)")
	postGenericIndex := strings.Index(postBranch, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if postDocumentIndex == -1 || postGenericIndex == -1 || postDocumentIndex > postGenericIndex {
		t.Fatal("work item document POST route must use specialized runtime before generic fallback")
	}

	deleteMethodIndex := strings.Index(content, "if method == http.MethodDelete {")
	if deleteMethodIndex == -1 {
		t.Fatal("missing DELETE method branch")
	}
	deleteBranch := content[deleteMethodIndex:]
	nestedDeleteIndex := strings.Index(deleteBranch, "a.unlinkWorkItemDocument(ctx, workItemID, documentID, query)")
	queryDeleteIndex := strings.Index(deleteBranch, "a.unlinkWorkItemDocument(ctx, workItemID, \"\", query)")
	directWorkItemDeleteIndex := strings.Index(deleteBranch, "if workItemID, ok := directPathParam(path, \"/v1/aims/work-items/\"); ok {")
	if nestedDeleteIndex == -1 || queryDeleteIndex == -1 || directWorkItemDeleteIndex == -1 {
		t.Fatal("missing specialized work item document delete routes")
	}
	if nestedDeleteIndex > directWorkItemDeleteIndex || queryDeleteIndex > directWorkItemDeleteIndex {
		t.Fatal("work item document DELETE routes must run before direct work item delete")
	}
}

func TestRequirementDerivedWritesRequireProjectManagerOrScopedAdminBeforeTransaction(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_change_actions.go")
	if err != nil {
		t.Fatalf("read requirement_change_actions.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		endToken   string
	}{
		{
			name:       "createRequirementTask",
			startToken: "func (a *Adapter) createRequirementTask",
			endToken:   "// restoreRequirementContent",
		},
		{
			name:       "restoreRequirementContent",
			startToken: "func (a *Adapter) restoreRequirementContent",
			endToken:   "var changeTitlePrefixPattern",
		},
		{
			name:       "createRequirementChangeDraft",
			startToken: "func (a *Adapter) createRequirementChangeDraft",
			endToken:   "func (a *Adapter) requireRequirementProjectManagerOrScopedAdmin",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			endIndex := strings.Index(content[startIndex:], tt.endToken)
			if endIndex == -1 {
				t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
			}
			segment := content[startIndex : startIndex+endIndex]
			guardIndex := strings.Index(segment, "ProjectManagerOrScopedAdmin")
			txIndex := strings.Index(segment, "BeginTx")
			if guardIndex == -1 {
				t.Fatal("expected project manager or scoped admin guard")
			}
			if txIndex == -1 || guardIndex > txIndex {
				t.Fatal("expected project manager or scoped admin guard before write transaction")
			}
		})
	}
}

func TestRequirementReviewProjectWritesRequireProjectManagerOrScopedAdminBeforeTransaction(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_review_actions.go")
	if err != nil {
		t.Fatalf("read requirement_review_actions.go: %v", err)
	}
	content := string(contentBytes)
	for _, tt := range []struct {
		name       string
		startToken string
		endToken   string
	}{
		{
			name:       "withdrawRequirementReviewBatch",
			startToken: "func (a *Adapter) withdrawRequirementReviewBatch",
			endToken:   "// revertChangeRequirementContents",
		},
		{
			name:       "appendRequirementsToReviewBatch",
			startToken: "func (a *Adapter) appendRequirementsToReviewBatch",
			endToken:   "// createTasksForReviewBatch",
		},
		{
			name:       "createTasksForReviewBatch",
			startToken: "func (a *Adapter) createTasksForReviewBatch",
			endToken:   "",
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			startIndex := strings.Index(content, tt.startToken)
			if startIndex == -1 {
				t.Fatalf("missing %s", tt.startToken)
			}
			segment := content[startIndex:]
			if tt.endToken != "" {
				endIndex := strings.Index(segment, tt.endToken)
				if endIndex == -1 {
					t.Fatalf("missing %s after %s", tt.endToken, tt.startToken)
				}
				segment = segment[:endIndex]
			}
			guardIndex := strings.Index(segment, "requireProjectManagerOrScopedAdmin")
			txIndex := strings.Index(segment, "BeginTx")
			if guardIndex == -1 {
				t.Fatal("expected project manager or scoped admin guard")
			}
			if txIndex == -1 || guardIndex > txIndex {
				t.Fatal("expected project manager or scoped admin guard before write transaction")
			}
		})
	}
}

func TestRequireProjectAdminAccess(t *testing.T) {
	query := url.Values{
		"current_user":                  {"u1"},
		"current_user_is_project_admin": {"1"},
	}
	if err := requireProjectAdminAccess(query, nil, "42"); err != nil {
		t.Fatalf("expected admin access, got %v", err)
	}

	err := requireProjectAdminAccess(url.Values{"current_user": {"u1"}}, nil, "42")
	if err == nil {
		t.Fatal("expected missing admin flag to be rejected")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "project_admin_required" {
		t.Fatalf("expected project_admin_required 403, got %#v", err)
	}

	err = requireProjectAdminAccess(url.Values{"current_user_is_project_admin": {"1"}}, nil, "42")
	if err == nil {
		t.Fatal("expected missing current_user to be rejected")
	}
	httpErr, ok = err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusUnauthorized || httpErr.Code != "missing_current_user" {
		t.Fatalf("expected missing_current_user 401, got %#v", err)
	}
}
