package aims

import (
	"net/url"
	"os"
	"strings"
	"testing"
)

func TestProjectReposRuntimePreservesLegacyLinkSemantics(t *testing.T) {
	contentBytes, err := os.ReadFile("project_repos.go")
	if err != nil {
		t.Fatalf("read project_repos.go: %v", err)
	}
	content := string(contentBytes)

	requiredTokens := []string{
		"func (a *Adapter) handleProjectReposRuntime",
		`pathParam(path, "/v1/aims/projects/", "/repos")`,
		"func (a *Adapter) listProjectRepos",
		"func (a *Adapter) linkProjectRepo",
		"func (a *Adapter) unlinkProjectRepo",
		"a.requireProjectReadAccess(ctx, rawProjectID, query)",
		"a.requireProjectUpdateAccess(ctx, \"/v1/aims/projects/\"+rawProjectID, query, body, rawProjectID)",
		`firstBodyText(body, "repoProjectCode", "repo_project_code")`,
		`firstQueryText(query, "repoProjectCode", "repo_project_code")`,
		"SELECT COUNT(*)",
		"INSERT INTO aims_project_repos (project_id, repo_project_code)",
		"DELETE FROM aims_project_repos",
		"ORDER BY created_at ASC, id ASC",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("expected project repos runtime to include %q", token)
		}
	}

	workspaceBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	workspace := string(workspaceBytes)
	reposIndex := strings.Index(workspace, "a.handleProjectReposRuntime(ctx, method, path, query, body)")
	genericIndex := strings.Index(workspace, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if reposIndex < 0 || genericIndex < 0 || reposIndex > genericIndex {
		t.Fatalf("project repos runtime must be dispatched before generic project scoped runtime")
	}
}

func TestProjectGitlabCommitsRuntimePreservesLegacyListFilters(t *testing.T) {
	contentBytes, err := os.ReadFile("project_gitlab_commits.go")
	if err != nil {
		t.Fatalf("read project_gitlab_commits.go: %v", err)
	}
	content := string(contentBytes)

	requiredTokens := []string{
		"func (a *Adapter) handleProjectGitlabCommitsRuntime",
		`pathParam(path, "/v1/aims/projects/", "/gitlab-commits")`,
		"a.requireProjectReadAccess(ctx, rawProjectID, query)",
		`strings.EqualFold(strings.TrimSpace(query.Get("unlinked")), "true")`,
		`optionalPositiveQueryID(query, "exclude_work_item_id", "excludeWorkItemId")`,
		"(work_item_id IS NULL OR work_item_id != ?)",
		"work_item_id IS NULL",
		`firstQueryText(query, "uid")`,
		"author_name = ?",
		`firstQueryText(query, "keyword", "search", "q")`,
		"(message LIKE ? OR commit_sha LIKE ? OR author_name LIKE ?)",
		"ORDER BY committed_at DESC, id DESC",
		"LIMIT 100",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("expected project GitLab commits runtime to include %q", token)
		}
	}

	workspaceBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	workspace := string(workspaceBytes)
	gitlabIndex := strings.Index(workspace, "a.handleProjectGitlabCommitsRuntime(ctx, method, path, query)")
	genericIndex := strings.Index(workspace, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if gitlabIndex < 0 || genericIndex < 0 || gitlabIndex > genericIndex {
		t.Fatalf("project GitLab commits runtime must be dispatched before generic project scoped runtime")
	}
}

func TestProjectMilestonesRuntimePreservesLegacyListAndCreateSemantics(t *testing.T) {
	contentBytes, err := os.ReadFile("project_milestones.go")
	if err != nil {
		t.Fatalf("read project_milestones.go: %v", err)
	}
	content := string(contentBytes)

	requiredTokens := []string{
		"func (a *Adapter) handleProjectMilestonesRuntime",
		`pathParam(path, "/v1/aims/projects/", "/milestones")`,
		"func (a *Adapter) listProjectMilestones",
		"func (a *Adapter) createProjectMilestone",
		"a.requireProjectReadAccess(ctx, rawProjectID, query)",
		"a.requireProjectUpdateAccess(ctx, \"/v1/aims/projects/\"+rawProjectID, query, body, rawProjectID)",
		"SUM(weight) AS total_weight",
		"SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END) AS completed_weight",
		"projectMilestoneDeliverablesMap",
		"normalizeProjectMilestoneDeliverables",
		"syncProjectMilestoneDeliverables",
		`mode == "strong_constraint"`,
		"强约束模式必须设置截止日期",
		`projectMilestoneBodyID(body, "paymentTermId", "payment_term_id")`,
		"项目未关联合同，不能绑定回款条款",
		"回款条款只能绑定到验证交付(V)阶段的里程碑",
		"INSERT INTO milestones",
		"INSERT INTO deliverables",
		"DELETE FROM deliverables",
		"tier = 'target'",
		"type = 'requirement'",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("expected project milestones runtime to include %q", token)
		}
	}

	workspaceBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	workspace := string(workspaceBytes)
	milestoneIndex := strings.Index(workspace, "a.handleProjectMilestonesRuntime(ctx, method, path, query, body)")
	genericIndex := strings.Index(workspace, "a.handleProjectScopedGenericRuntime(ctx, method, path, query, body)")
	if milestoneIndex < 0 || genericIndex < 0 || milestoneIndex > genericIndex {
		t.Fatalf("project milestones runtime must be dispatched before generic project scoped runtime")
	}
}

func TestDirectProjectMilestonesRuntimePreservesLegacyObjectSemantics(t *testing.T) {
	contentBytes, err := os.ReadFile("project_milestones.go")
	if err != nil {
		t.Fatalf("read project_milestones.go: %v", err)
	}
	content := string(contentBytes)

	requiredTokens := []string{
		"func (a *Adapter) handleDirectMilestonesRuntime",
		`path == "/v1/aims/milestones"`,
		"func (a *Adapter) listDirectMilestones",
		"func directMilestonesWhere",
		`projectVisibilityWhere(query, "p", currentUser)`,
		"JOIN aims_projects p ON p.id = m.project_id",
		`directPathParam(path, "/v1/aims/milestones/")`,
		"func (a *Adapter) getDirectMilestone",
		"func (a *Adapter) updateDirectMilestone",
		"func (a *Adapter) deleteDirectMilestone",
		`a.requireProjectReadAccess(ctx, strconv.FormatInt(item.ProjectID, 10), query)`,
		"a.requireProjectManagerOrScopedAdmin(ctx, record.ProjectID, uid, query)",
		"SUM(wi.weight)",
		"SUM(CASE WHEN wi.status = 'completed' THEN wi.weight ELSE 0 END)",
		"projectMilestoneDeliverablesMap",
		"syncProjectMilestoneDeliverables",
		"没有需要更新的字段",
		"强约束模式必须设置截止日期",
		"projectMilestonePositiveIDValue",
		"项目未关联合同，不能绑定回款条款",
		"回款条款只能绑定到验证交付(V)阶段的里程碑",
		"UPDATE milestones",
		"SELECT COUNT(*)",
		"FROM work_items",
		"该里程碑下有 %d 个工作项，请先移动或删除后再删除里程碑",
		"DELETE FROM milestones",
	}
	for _, token := range requiredTokens {
		if !strings.Contains(content, token) {
			t.Fatalf("expected direct project milestones runtime to include %q", token)
		}
	}

	workspaceBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	workspace := string(workspaceBytes)
	directIndex := strings.Index(workspace, "a.handleDirectMilestonesRuntime(ctx, method, path, query, body)")
	getBranchIndex := strings.Index(workspace, "if method == http.MethodGet")
	if directIndex < 0 || getBranchIndex < 0 || directIndex > getBranchIndex {
		t.Fatalf("direct milestone runtime must be dispatched before generic GET/runtime branches")
	}
}

func TestDirectMilestonesWhereUsesProjectVisibility(t *testing.T) {
	where, args, err := directMilestonesWhere(url.Values{
		"current_user_dept_codes":                  {"dept-sales"},
		"current_user_project_admin_project_codes": {"PRJ-1"},
		"projectCode":                              {"PRJ-1"},
		"status":                                   {"active"},
		"search":                                   {"验收"},
	}, "u1")
	if err != nil {
		t.Fatalf("directMilestonesWhere returned error: %v", err)
	}

	whereSQL := strings.Join(where, " AND ")
	for _, expected := range []string{
		"p.project_code = ?",
		"m.status = ?",
		"(m.name LIKE ? OR m.status LIKE ? OR m.pivr_stage LIKE ? OR m.template_key LIKE ?)",
		"p.project_code IN (?)",
		"p.dept_code IN (?)",
	} {
		if !strings.Contains(whereSQL, expected) {
			t.Fatalf("where missing %q: %s", expected, whereSQL)
		}
	}
	if len(args) < 10 {
		t.Fatalf("expected filters and visibility args, got %#v", args)
	}
}
