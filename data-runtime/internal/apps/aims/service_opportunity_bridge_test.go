package aims

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestOpportunityProjectRequiresReliableServiceCommandEnvelope(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.createProjectFromOpportunityCommand(context.Background(), map[string]any{})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest || httpErr.Code != "service_command_required" {
		t.Fatalf("error = %#v", err)
	}
}

func TestOpportunityProjectIdempotencyUsesOpportunityAndCategory(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectBegin()
	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	mock.ExpectQuery(`(?s)SELECT \* FROM aims_projects WHERE opp_id = \? AND category = \?.*FOR UPDATE`).
		WithArgs(int64(88), "presales").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "opp_id", "category"}).
			AddRow(int64(9), "OPP88PS", int64(88), "presales"))

	result, err := adapter.createProjectFromOpportunityTx(context.Background(), tx, map[string]any{
		"oppId": int64(88), "category": "presales", "projectName": "政务云投标",
		"leaderUid": "u1", "customerCode": "CUS-1", "customerName": "客户一",
		"startDate": "2026-09-01", "endDate": "2026-12-31",
	})
	if err != nil || result["idempotent"] != true || result["created"] != false {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestOpportunityProjectCreatesProjectAndPublishedTemplateInOneTransaction(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectBegin()
	tx, err := adapter.DB().BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	mock.ExpectQuery(`(?s)SELECT \* FROM aims_projects WHERE opp_id = \? AND category = \?.*FOR UPDATE`).
		WithArgs(int64(88), "presales").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)SELECT v\.id.*FROM project_template_versions v.*WHERE s\.category = \? AND v\.status = 'published'`).
		WithArgs("presales").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(21)))
	mock.ExpectQuery(`(?s)SELECT v\.template_set_id, v\.status, s\.category, v\.definition_json.*WHERE v\.id = \?`).
		WithArgs(int64(21)).
		WillReturnRows(sqlmock.NewRows([]string{"template_set_id", "status", "category", "definition_json"}).AddRow(
			int64(20), "published", "presales",
			`{"milestones":[{"key":"i-bid","name":"标书制作","mode":"strong_constraint","pivrStage":"I","sortOrder":1,"workItems":[{"key":"bid-doc","title":"编制技术方案/标书","type":"task","tier":"target","required":true,"reviewLevel":2,"priority":"P1","deliverables":[{"key":"bid-file","name":"《技术方案/标书》","acceptanceCriteria":"响应招标要求","deliverableType":"document","required":true}]}]}]}`,
		))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\).*FROM aims_projects.*WHERE project_code = \?`).
		WithArgs("OPP88PS").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(int64(0)))
	mock.ExpectExec(`(?s)INSERT INTO aims_projects`).WillReturnResult(sqlmock.NewResult(100, 1))
	mock.ExpectExec(`(?s)INSERT INTO project_lifecycle_events`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO project_counters`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)INSERT INTO aims_project_members`).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT counter FROM project_counters WHERE project_id = \?`).
		WithArgs(int64(100)).
		WillReturnRows(sqlmock.NewRows([]string{"counter"}).AddRow(int64(0)))
	mock.ExpectExec(`(?s)INSERT INTO milestones.*recurrence_rule`).WillReturnResult(sqlmock.NewResult(200, 1))
	mock.ExpectExec(`(?s)INSERT INTO work_items`).WillReturnResult(sqlmock.NewResult(300, 1))
	mock.ExpectExec(`(?s)INSERT INTO deliverables`).WillReturnResult(sqlmock.NewResult(400, 1))
	mock.ExpectExec(`UPDATE project_counters SET counter = \? WHERE project_id = \?`).
		WithArgs(int64(1), int64(100)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT \* FROM aims_projects WHERE id = \? LIMIT 1`).
		WithArgs(int64(100)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_code", "opp_id", "category", "template_set_id", "template_version_id"}).
			AddRow(int64(100), "OPP88PS", int64(88), "presales", int64(20), int64(21)))

	result, err := adapter.createProjectFromOpportunityTx(context.Background(), tx, map[string]any{
		"oppId": int64(88), "category": "presales", "projectName": "政务云投标",
		"leaderUid": "u1", "customerCode": "CUS-1", "customerName": "客户一",
		"startDate": "2026-09-01", "endDate": "2026-12-31",
	})
	if err != nil || result["created"] != true || result["idempotent"] != false {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	project, _ := result["project"].(map[string]any)
	if project["project_code"] != "OPP88PS" || project["template_version_id"] != int64(21) {
		t.Fatalf("project=%#v", project)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestOpportunityProjectContractUsesExactCapabilityAndTemplates(t *testing.T) {
	if opportunityProjectOperation != "altoc.opportunity.aims-project.v1" {
		t.Fatalf("operation = %q", opportunityProjectOperation)
	}
	if opportunityProjectCapability != "aims:project:create-from-opportunity" {
		t.Fatalf("capability = %q", opportunityProjectCapability)
	}
	for category, deliverable := range map[string]string{"presales": "《技术方案/标书》", "sales": "《报价单/合同》"} {
		definition := defaultProjectTemplateDefinition(category)
		if len(definition.Milestones) == 0 {
			t.Fatalf("%s opportunity project must resolve a non-empty execution template", category)
		}
		if !projectTemplateContainsDeliverable(definition, deliverable) {
			t.Fatalf("%s opportunity template must include %s", category, deliverable)
		}
	}
}

func TestOpportunityProjectRejectsUnsupportedCategoryBeforeMutation(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.createProjectFromOpportunityTx(context.Background(), nil, map[string]any{
		"oppId": int64(88), "category": "delivery", "projectName": "错误分类",
		"leaderUid": "u1", "customerCode": "CUS-1", "customerName": "客户一",
		"startDate": "2026-09-01", "endDate": "2026-12-31",
	})
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusBadRequest || httpErr.Code != "invalid_opportunity_project_category" {
		t.Fatalf("error = %#v", err)
	}
}

func TestOpportunityProjectPeriodValidation(t *testing.T) {
	if validOpportunityProjectPeriod("", "2026-12-31") || validOpportunityProjectPeriod("2026-12-31", "2026-01-01") || !validOpportunityProjectPeriod("2026-09-01", "2026-12-31") {
		t.Fatal("opportunity project period validation mismatch")
	}
}

func projectTemplateContainsDeliverable(definition projectTemplateDefinition, name string) bool {
	for _, milestone := range definition.Milestones {
		for _, workItem := range milestone.WorkItems {
			for _, deliverable := range workItem.Deliverables {
				if deliverable.Name == name {
					return true
				}
			}
		}
	}
	return false
}
