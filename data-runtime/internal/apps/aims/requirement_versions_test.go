package aims

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestRequirementVersionsUseDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	routeIndex := strings.Index(content, `pathParam(path, "/v1/aims/requirements/", "/versions")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement versions dedicated route")
	}
	genericIndex := strings.Index(content, "handleProjectScopedGenericRuntime")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement versions must use dedicated handler before generic runtime")
	}
	if !strings.Contains(content[routeIndex:], "a.requirementVersions(ctx, requirementID, query)") {
		t.Fatal("requirement versions route must call dedicated handler")
	}
}

func TestRequirementChangeImpactUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	routeIndex := strings.Index(content, `pathParam(path, "/v1/aims/requirements/", "/change-impact")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement change impact dedicated route")
	}
	genericIndex := strings.Index(content, "handleProjectScopedGenericRuntime")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement change impact must use dedicated handler before generic runtime")
	}
	if !strings.Contains(content[routeIndex:], "a.requirementChangeImpact(ctx, requirementID, query)") {
		t.Fatal("requirement change impact route must call dedicated handler")
	}
}

func TestRequirementChangeDiffUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	routeIndex := strings.Index(content, `pathParam(path, "/v1/aims/requirements/", "/change-diff")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement change diff dedicated route")
	}
	genericIndex := strings.Index(content, "handleProjectScopedGenericRuntime")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement change diff must use dedicated handler before generic runtime")
	}
	if !strings.Contains(content[routeIndex:], "a.requirementChangeDiff(ctx, requirementID, query)") {
		t.Fatal("requirement change diff route must call dedicated handler")
	}
}

func TestRequirementDetailUsesDedicatedHandlerBeforeGenericRuntime(t *testing.T) {
	contentBytes, err := os.ReadFile("workspace.go")
	if err != nil {
		t.Fatalf("read workspace.go: %v", err)
	}
	content := string(contentBytes)

	routeIndex := strings.Index(content, `directPathParam(path, "/v1/aims/requirements/")`)
	if routeIndex == -1 {
		t.Fatal("missing requirement detail dedicated route")
	}
	genericIndex := strings.Index(content, "handleProjectScopedGenericRuntime")
	if genericIndex == -1 {
		t.Fatal("missing project scoped generic runtime")
	}
	if routeIndex > genericIndex {
		t.Fatal("requirement detail must use dedicated handler before generic runtime")
	}
	if !strings.Contains(content[routeIndex:], "a.requirementDetail(ctx, requirementID, query)") {
		t.Fatal("requirement detail route must call dedicated handler")
	}
}

func TestRequirementVersionsGuardAccessBeforeDataRead(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reads.go")
	if err != nil {
		t.Fatalf("read requirement_reads.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) requirementVersions")
	if startIndex == -1 {
		t.Fatal("missing requirementVersions")
	}
	segment := content[startIndex:]

	guardIndex := strings.Index(segment, "a.requireRequirementProjectMemberOrScopedAdmin")
	versionsIndex := strings.Index(segment, "FROM requirement_versions")

	if guardIndex == -1 {
		t.Fatal("expected requirement version reads to require project access")
	}
	if versionsIndex == -1 {
		t.Fatal("expected requirement version data read")
	}
	if guardIndex > versionsIndex {
		t.Fatal("expected project access guard before requirement_versions read")
	}
}

func TestRequirementDetailGuardAccessBeforeDataRead(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reads.go")
	if err != nil {
		t.Fatalf("read requirement_reads.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) requirementDetail")
	if startIndex == -1 {
		t.Fatal("missing requirementDetail")
	}
	segment := content[startIndex:]

	guardIndex := strings.Index(segment, "a.requireProjectMemberOrScopedAdmin")
	contentIndex := strings.Index(segment, "WITH RECURSIVE content_scope")
	workItemsIndex := strings.Index(segment, "FROM work_items")
	versionsIndex := strings.Index(segment, "FROM requirement_versions")

	if guardIndex == -1 {
		t.Fatal("expected requirement detail reads to require project access")
	}
	for label, index := range map[string]int{
		"requirement contents": contentIndex,
		"work items":           workItemsIndex,
		"requirement versions": versionsIndex,
	} {
		if index == -1 {
			t.Fatalf("expected %s data read", label)
		}
		if guardIndex > index {
			t.Fatalf("expected project access guard before %s read", label)
		}
	}
}

func TestRequirementChangeDiffGuardAccessBeforeDataRead(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reads.go")
	if err != nil {
		t.Fatalf("read requirement_reads.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) requirementChangeDiff")
	if startIndex == -1 {
		t.Fatal("missing requirementChangeDiff")
	}
	segment := content[startIndex:]

	guardIndex := strings.Index(segment, "a.requireRequirementProjectMemberOrScopedAdmin")
	diffIndex := strings.Index(segment, "FROM requirement_item_contents ric")

	if guardIndex == -1 {
		t.Fatal("expected requirement change diff reads to require project access")
	}
	if diffIndex == -1 {
		t.Fatal("expected requirement change diff data read")
	}
	if guardIndex > diffIndex {
		t.Fatal("expected project access guard before requirement_item_contents read")
	}
}

func TestRequirementChangeImpactGuardAccessBeforeDataRead(t *testing.T) {
	contentBytes, err := os.ReadFile("requirement_reads.go")
	if err != nil {
		t.Fatalf("read requirement_reads.go: %v", err)
	}
	content := string(contentBytes)
	startIndex := strings.Index(content, "func (a *Adapter) requirementChangeImpact")
	if startIndex == -1 {
		t.Fatal("missing requirementChangeImpact")
	}
	segment := content[startIndex:]

	guardIndex := strings.Index(segment, "a.requireRequirementProjectMemberOrScopedAdmin")
	workItemsIndex := strings.Index(segment, "FROM work_items")

	if guardIndex == -1 {
		t.Fatal("expected requirement change impact reads to require project access")
	}
	if workItemsIndex == -1 {
		t.Fatal("expected work item impact data read")
	}
	if guardIndex > workItemsIndex {
		t.Fatal("expected project access guard before work_items read")
	}
}

func TestRequirementVersionsPreserveLegacyShapeAndProjectAccess(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id\\s+FROM requirement_items\\s+WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT id, version_no, snapshot_json, change_type, change_reason,.*FROM requirement_versions").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"version_no",
			"snapshot_json",
			"change_type",
			"change_reason",
			"batch_id",
			"approved_by",
			"approved_at",
			"created_by",
			"created_at",
		}).AddRow(
			int64(7),
			int64(2),
			`{"title":"需求","status":"baselined"}`,
			"baseline",
			"评审通过",
			int64(3),
			"reviewer",
			"2026-06-30 10:00:00",
			"author",
			"2026-06-30 09:00:00",
		))

	items, err := adapter.requirementVersions(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement versions to pass, got %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d, want 1", len(items))
	}
	item := items[0]
	if item.ID != 7 || item.VersionNo != 2 || item.ChangeType != "baseline" {
		t.Fatalf("unexpected version item: %#v", item)
	}
	if item.ChangeReason == nil || *item.ChangeReason != "评审通过" {
		t.Fatalf("change reason = %#v", item.ChangeReason)
	}
	if item.BatchID == nil || *item.BatchID != 3 {
		t.Fatalf("batch id = %#v", item.BatchID)
	}
	snapshot, ok := item.Snapshot.(map[string]any)
	if !ok {
		t.Fatalf("snapshot = %#v, want object", item.Snapshot)
	}
	if snapshot["title"] != "需求" || snapshot["status"] != "baselined" {
		t.Fatalf("snapshot = %#v", snapshot)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequirementDetailPreservesLegacyShapeAndProjectAccess(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("(?s)SELECT r.id, r.item_kind, r.parent_requirement_id, r.change_no, r.change_reason,.*FROM requirement_items r.*LEFT JOIN milestones m.*WHERE r.id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"item_kind",
			"parent_requirement_id",
			"change_no",
			"change_reason",
			"project_id",
			"req_number",
			"req_code",
			"title",
			"type",
			"category",
			"priority",
			"source",
			"scope_note",
			"milestone_id",
			"status",
			"current_version",
			"baselined_at",
			"created_by",
			"created_at",
			"updated_by",
			"updated_at",
			"milestone_name",
		}).AddRow(
			int64(10),
			"baseline",
			nil,
			nil,
			nil,
			int64(42),
			int64(1),
			"REQ-1",
			"需求详情",
			"business",
			nil,
			"high",
			"manual",
			nil,
			int64(5),
			"draft",
			int64(2),
			nil,
			"author",
			"2026-06-30 09:00:00",
			nil,
			"2026-06-30 09:30:00",
			"M1",
		))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)WITH RECURSIVE content_scope AS \\(.*FROM requirement_contents c.*ORDER BY sort_path").
		WithArgs(int64(10), "baseline", int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"content_original_id",
			"display_parent_id",
			"source_parent_id",
			"title",
			"heading_depth",
			"sort_order",
			"status",
			"content_md",
			"relation_sort_order",
		}).AddRow(
			int64(20),
			nil,
			nil,
			int64(99),
			"章节",
			int64(1),
			int64(0),
			"draft",
			"正文",
			int64(0),
		))
	mock.ExpectQuery("(?s)SELECT id, title, heading_depth, sort_order, content_md\\s+FROM requirement_contents\\s+WHERE id IN \\(\\?\\)").
		WithArgs(int64(99)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"title",
			"heading_depth",
			"sort_order",
			"content_md",
		}).AddRow(int64(99), "上下文模块", int64(0), int64(0), "模块正文"))
	mock.ExpectQuery("(?s)SELECT id, item_key, title, status, assignee_uid, type, change_request_of\\s+FROM work_items").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"item_key",
			"title",
			"status",
			"assignee_uid",
			"type",
			"change_request_of",
		}).AddRow(int64(30), "WI-1", "任务", "todo", "dev1", "task", nil))
	mock.ExpectQuery("(?s)SELECT id, version_no, change_type, change_reason, approved_by,.*FROM requirement_versions").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"version_no",
			"change_type",
			"change_reason",
			"approved_by",
			"approved_at",
			"created_by",
			"created_at",
		}).AddRow(
			int64(40),
			int64(2),
			"baseline",
			"评审通过",
			"reviewer",
			"2026-06-30 10:00:00",
			"author",
			"2026-06-30 09:00:00",
		))

	data, err := adapter.requirementDetail(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement detail to pass, got %v", err)
	}
	if data.ID != 10 || data.ProjectID != 42 || data.ReqCode != "REQ-1" || data.MilestoneName == nil || *data.MilestoneName != "M1" {
		t.Fatalf("unexpected requirement detail: %#v", data)
	}
	if len(data.Contents) != 1 || data.Contents[0].ID != 20 || data.Contents[0].SourceParentID == nil || *data.Contents[0].SourceParentID != 99 {
		t.Fatalf("unexpected contents: %#v", data.Contents)
	}
	if len(data.ContextModules) != 1 || data.ContextModules[0].ID != 99 {
		t.Fatalf("unexpected context modules: %#v", data.ContextModules)
	}
	if len(data.Tasks) != 1 || data.Tasks[0].ItemKey != "WI-1" || data.Tasks[0].AssigneeUID == nil || *data.Tasks[0].AssigneeUID != "dev1" {
		t.Fatalf("unexpected tasks: %#v", data.Tasks)
	}
	if len(data.Versions) != 1 || data.Versions[0].VersionNo != 2 || data.Versions[0].ApprovedBy == nil || *data.Versions[0].ApprovedBy != "reviewer" {
		t.Fatalf("unexpected versions: %#v", data.Versions)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequirementChangeDiffPreservesLegacyShapeAndProjectAccess(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id\\s+FROM requirement_items\\s+WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT r.id, r.req_code, r.title, r.status, r.parent_requirement_id,.*FROM requirement_items r").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"req_code",
			"title",
			"status",
			"parent_requirement_id",
			"parent_req_code",
			"parent_title",
		}).AddRow(
			int64(10),
			"REQ-CHG",
			"变更需求",
			"draft",
			int64(3),
			"REQ-BASE",
			"基线需求",
		))
	mock.ExpectQuery("(?s)SELECT cc.content_original_id,.*FROM requirement_item_contents ric").
		WithArgs(int64(3), int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"content_original_id",
			"diff_status",
			"base_content_id",
			"base_title",
			"base_content_md",
			"base_version_no",
			"change_content_id",
			"change_title",
			"change_content_md",
			"change_version_no",
		}).
			AddRow(int64(5), "changed", int64(4), "旧章节", "old", int64(1), int64(6), "新章节", "new", int64(2)).
			AddRow(nil, "added", nil, nil, nil, nil, int64(7), "新增章节", "added", int64(1)))

	data, err := adapter.requirementChangeDiff(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement change diff to pass, got %v", err)
	}
	requirement, ok := data["requirement"].(requirementChangeDiffRequirement)
	if !ok {
		t.Fatalf("requirement = %#v, want requirementChangeDiffRequirement", data["requirement"])
	}
	if requirement.ID != 10 || requirement.ReqCode != "REQ-CHG" || requirement.ParentRequirementID != 3 {
		t.Fatalf("unexpected requirement: %#v", requirement)
	}
	items, ok := data["items"].([]requirementChangeDiffItem)
	if !ok {
		t.Fatalf("items = %#v, want []requirementChangeDiffItem", data["items"])
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].DiffStatus != "changed" || items[0].Base == nil || items[0].Base.ID != 4 || items[0].Change.ID != 6 {
		t.Fatalf("unexpected changed diff item: %#v", items[0])
	}
	if items[1].DiffStatus != "added" || items[1].Base != nil || items[1].Change.ID != 7 {
		t.Fatalf("unexpected added diff item: %#v", items[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRequirementChangeImpactPreservesLegacyRecommendation(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT project_id\\s+FROM requirement_items\\s+WHERE id = \\?").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"project_id"}).AddRow(int64(42)))
	mock.ExpectQuery("(?s)SELECT COUNT\\(\\*\\).*FROM aims_projects p").
		WithArgs("u1", int64(42), "u1", "PRJ-1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT id, item_key, title, status, assignee_uid, type\\s+FROM work_items").
		WithArgs(int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"item_key",
			"title",
			"status",
			"assignee_uid",
			"type",
		}).
			AddRow(int64(1), "WI-1", "未分配任务", "todo", nil, "task").
			AddRow(int64(2), "WI-2", "开发中任务", "in_progress", "dev1", "task").
			AddRow(int64(3), "WI-3", "已完成变更", "completed", "dev2", "change_request"))

	data, err := adapter.requirementChangeImpact(
		context.Background(),
		"10",
		url.Values{
			"current_user": {"u1"},
			"current_user_project_admin_project_codes": {"PRJ-1"},
		},
	)
	if err != nil {
		t.Fatalf("expected requirement change impact to pass, got %v", err)
	}
	if data["recommendation"] != "mixed" {
		t.Fatalf("recommendation = %#v, want mixed", data["recommendation"])
	}
	tasks, ok := data["linkedTasks"].([]requirementImpactTask)
	if !ok {
		t.Fatalf("linkedTasks = %#v, want []requirementImpactTask", data["linkedTasks"])
	}
	if len(tasks) != 3 {
		t.Fatalf("len(tasks) = %d, want 3", len(tasks))
	}
	if tasks[0].ImpactCategory != "safe_to_update" {
		t.Fatalf("first impact = %s", tasks[0].ImpactCategory)
	}
	if tasks[1].ImpactCategory != "user_choice" {
		t.Fatalf("second impact = %s", tasks[1].ImpactCategory)
	}
	if tasks[2].ImpactCategory != "force_change_request" {
		t.Fatalf("third impact = %s", tasks[2].ImpactCategory)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
