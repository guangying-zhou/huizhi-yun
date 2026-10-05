package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestDefaultProjectTemplateDefinitionHasPIVRMilestones(t *testing.T) {
	definition := defaultProjectTemplateDefinition("product_dev")

	if len(definition.Milestones) != 4 {
		t.Fatalf("expected 4 default milestones, got %d", len(definition.Milestones))
	}

	stages := []string{"P", "I", "V", "R"}
	names := []string{"规划POC", "核心MVP", "商用MMP", "市场PMF"}
	for i, milestone := range definition.Milestones {
		if milestone.PivrStage != stages[i] {
			t.Fatalf("milestone %d stage = %q, want %q", i, milestone.PivrStage, stages[i])
		}
		if milestone.Name != names[i] {
			t.Fatalf("milestone %d name = %q, want %q", i, milestone.Name, names[i])
		}
		if milestone.SortOrder != i+1 {
			t.Fatalf("milestone %d sortOrder = %d, want %d", i, milestone.SortOrder, i+1)
		}
	}
}

func TestDefaultProjectTemplateDefinitionIncludesRequirementBaseline(t *testing.T) {
	for _, category := range []string{"product_dev", "custom_dev"} {
		definition := defaultProjectTemplateDefinition(category)
		baselineCount := 0
		for _, milestone := range definition.Milestones {
			for _, workItem := range milestone.WorkItems {
				if workItem.Key != "requirement_baseline" {
					continue
				}
				baselineCount++
				if milestone.PivrStage != "I" || workItem.Type != "requirement" || workItem.Tier != "target" {
					t.Fatalf("%s baseline has unexpected placement or shape: milestone=%#v workItem=%#v", category, milestone, workItem)
				}
			}
		}
		if baselineCount != 1 {
			t.Fatalf("%s baseline count = %d, want 1", category, baselineCount)
		}
	}

	delivery := defaultProjectTemplateDefinition("delivery")
	for _, milestone := range delivery.Milestones {
		for _, workItem := range milestone.WorkItems {
			if workItem.Key == "requirement_baseline" {
				t.Fatal("delivery template must not contain a requirement baseline")
			}
		}
	}
}

func TestInstantiateProjectTemplatePersistsPeriodicRecurrenceRule(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectBegin()
	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	mock.ExpectQuery(`SELECT counter FROM project_counters WHERE project_id = \?`).
		WithArgs(int64(7)).
		WillReturnRows(sqlmock.NewRows([]string{"counter"}).AddRow(int64(0)))
	mock.ExpectExec(`(?s)INSERT INTO milestones.*recurrence_rule.*VALUES`).
		WithArgs(int64(7), "月度运维周期", nil, "periodic", "R", "monthly", 2, "u1", "monthly_cycle").
		WillReturnResult(sqlmock.NewResult(71, 1))
	mock.ExpectExec(`UPDATE project_counters SET counter = \? WHERE project_id = \?`).
		WithArgs(int64(0), int64(7)).
		WillReturnResult(sqlmock.NewResult(0, 1))

	definition := projectTemplateDefinition{Milestones: []projectTemplateMilestone{{
		Key: "monthly_cycle", Name: "月度运维周期", Mode: "periodic", PivrStage: "R",
		RecurrenceRule: "monthly", SortOrder: 2,
	}}}
	if err := instantiateProjectFromTemplateTx(context.Background(), tx, 7, "PRJ-7", "u1", definition, nil); err != nil {
		t.Fatalf("instantiateProjectFromTemplateTx: %v", err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestEnsureRequirementBaselinePreservesExistingWorkItems(t *testing.T) {
	description := "保留此描述"
	definition := projectTemplateDefinition{Milestones: []projectTemplateMilestone{
		{
			Key:       "implementation",
			Name:      "实施",
			PivrStage: "I",
			WorkItems: []projectTemplateWorkItem{
				{Key: "custom-item", Title: "自定义工作项", Description: &description},
			},
		},
	}}

	if !ensureRequirementBaseline(&definition, "product_dev") {
		t.Fatal("expected missing baseline to be added")
	}
	workItems := definition.Milestones[0].WorkItems
	if len(workItems) != 2 || workItems[0].Key != "requirement_baseline" || workItems[1].Key != "custom-item" {
		t.Fatalf("existing work items were not preserved: %#v", workItems)
	}
	if workItems[1].Description == nil || *workItems[1].Description != description {
		t.Fatalf("existing work item content changed: %#v", workItems[1])
	}
	if ensureRequirementBaseline(&definition, "product_dev") {
		t.Fatal("second repair must be idempotent")
	}
}

func TestParseProjectTemplateDefinitionNormalizesEmptyFields(t *testing.T) {
	definition, err := parseProjectTemplateDefinition(`{"milestones":[{"workItems":[{"deliverables":[{}]}]}]}`)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	milestone := definition.Milestones[0]
	if milestone.Key != "milestone-1" || milestone.Name != "里程碑 1" || milestone.Mode != "rolling_plan" || milestone.PivrStage != "P" {
		t.Fatalf("unexpected normalized milestone: %#v", milestone)
	}
	workItem := milestone.WorkItems[0]
	if workItem.Key != "milestone-1-work-item-1" || workItem.Title != "工作项 1" || workItem.Type != "task" || workItem.Tier != "target" || workItem.Priority != "P2" {
		t.Fatalf("unexpected normalized work item: %#v", workItem)
	}
	deliverable := workItem.Deliverables[0]
	if deliverable.Key != "milestone-1-work-item-1-deliverable-1" || deliverable.Name != "交付物 1" || deliverable.DeliverableType != "document" {
		t.Fatalf("unexpected normalized deliverable: %#v", deliverable)
	}
}

func TestProjectTemplateVersionsRuntimeListPreservesLegacyJoinShape(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT id, is_system.*FROM project_template_sets.*WHERE category = \\?").
		WithArgs("product_dev").
		WillReturnRows(sqlmock.NewRows([]string{"id", "is_system"}).AddRow(int64(9), int64(1)))
	mock.ExpectQuery("SELECT id, definition_json.*FROM project_template_versions.*WHERE template_set_id = \\? AND status = 'published'").
		WithArgs(int64(9)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "definition_json"}).
			AddRow(int64(12), `{"milestones":[{"pivrStage":"I","workItems":[{"key":"requirement_baseline"}]}]}`))
	mock.ExpectQuery("(?s)SELECT\\s+v.id,.*s.code AS template_set_code.*COUNT\\(\\*\\).*FROM project_template_versions v.*JOIN project_template_sets s.*WHERE 1 = 1 AND s.category = \\?.*GROUP BY v.id.*ORDER BY s.category ASC").
		WithArgs("product_dev").
		WillReturnRows(projectTemplateVersionRows().
			AddRow(
				int64(12),
				int64(9),
				"system-product_dev",
				"product_dev 默认模板",
				"product_dev",
				int64(1),
				"v1",
				"published",
				"系统初始化版本",
				`{"milestones":[]}`,
				"2026-06-30 09:00:00",
				nil,
				"system",
				nil,
				"system",
				"2026-06-30 08:00:00",
				"2026-06-30 09:00:00",
				int64(1),
				int64(2),
			))

	items, err := adapter.listProjectTemplateVersions(context.Background(), url.Values{"category": {"product_dev"}})
	if err != nil {
		t.Fatalf("expected list to pass, got %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items len = %d, want 1", len(items))
	}
	item := items[0]
	if item.ID != 12 || item.TemplateSetID != 9 || item.TemplateSetCode != "system-product_dev" || item.Category != "product_dev" || item.UsageCount != 2 || !item.IsSystem {
		t.Fatalf("unexpected item: %#v", item)
	}
	if item.Definition != nil {
		t.Fatalf("list item must omit definition, got %#v", item.Definition)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestProjectTemplateVersionWriteRequiresTrustedAdminFlag(t *testing.T) {
	adapter, _, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	_, err := adapter.createProjectTemplateVersionDraft(
		context.Background(),
		url.Values{"current_user": {"u1"}},
		map[string]any{"category": "product_dev"},
	)
	if err == nil {
		t.Fatal("expected create without trusted admin flag to fail")
	}
	if httpErr, ok := err.(httperror.Error); !ok || httpErr.Status != 403 {
		t.Fatalf("err = %#v, want 403 httperror", err)
	}
}

func projectTemplateVersionRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"template_set_id",
		"template_set_code",
		"template_set_name",
		"category",
		"version_no",
		"version_label",
		"status",
		"notes",
		"definition_json",
		"published_at",
		"archived_at",
		"published_by",
		"archived_by",
		"created_by",
		"created_at",
		"updated_at",
		"is_system",
		"usage_count",
	})
}
