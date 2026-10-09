package aims

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestValidateRoutineWorkItemRejectsMilestoneAssignment(t *testing.T) {
	assertRoutineWorkItemValidationCode(t, "routine", int64(9), "department", nil, int64(0), "routine_milestone_not_allowed")
}

func TestValidateNonRoutineWorkItemRequiresMilestone(t *testing.T) {
	assertRoutineWorkItemValidationCode(t, "delivery", nil, nil, nil, int64(0), "milestone_required")
}

func TestNormalizeRoutineWorkItemRequiresCrossDepartmentBeneficiary(t *testing.T) {
	_, _, _, err := normalizeRoutineWorkItemInput("routine", map[string]any{"routineScope": "cross_dept"}, true)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "beneficiary_dept_required" {
		t.Fatalf("error = %#v", err)
	}
	scope, beneficiary, unplanned, err := normalizeRoutineWorkItemInput("routine", map[string]any{}, true)
	if err != nil || scope != "department" || beneficiary != nil || unplanned {
		t.Fatalf("default routine values scope=%#v beneficiary=%#v unplanned=%v err=%v", scope, beneficiary, unplanned, err)
	}
}

func TestNormalizeRoutineWorkItemKindAlwaysUsesFlatTasks(t *testing.T) {
	itemType, tier, err := normalizeProjectWorkItemKind("routine", "bug", "target")
	if err != nil || itemType != "task" || tier != "matter" {
		t.Fatalf("routine kind type=%q tier=%q err=%v", itemType, tier, err)
	}

	itemType, tier, err = normalizeProjectWorkItemKind("routine", "", "")
	if err != nil || itemType != "task" || tier != "matter" {
		t.Fatalf("default routine kind type=%q tier=%q err=%v", itemType, tier, err)
	}
}

func TestNormalizeNonRoutineWorkItemKindStillRequiresType(t *testing.T) {
	_, _, err := normalizeProjectWorkItemKind("delivery", "", "matter")
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != "missing_work_item_type" {
		t.Fatalf("error = %#v", err)
	}
}

func assertRoutineWorkItemValidationCode(t *testing.T, category string, milestoneID any, scope any, beneficiary any, isUnplanned int64, wantCode string) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	mock.ExpectQuery(`(?s)SELECT p\.category, wi\.milestone_id, wi\.routine_scope, wi\.beneficiary_dept_code, wi\.is_unplanned.*WHERE wi\.id = \? FOR UPDATE`).
		WithArgs("42").
		WillReturnRows(sqlmock.NewRows([]string{"category", "milestone_id", "routine_scope", "beneficiary_dept_code", "is_unplanned"}).
			AddRow(category, milestoneID, scope, beneficiary, isUnplanned))

	err = validateRoutineWorkItemTx(context.Background(), tx, "42")
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Code != wantCode {
		t.Fatalf("error = %#v, want %s", err, wantCode)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
