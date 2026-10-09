package aims

import (
	"context"
	"database/sql"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func normalizeRoutineWorkItemInput(category string, body map[string]any, creating bool) (any, any, bool, error) {
	scope := strings.TrimSpace(firstBodyText(body, "routineScope", "routine_scope"))
	beneficiary := strings.TrimSpace(firstBodyText(body, "beneficiaryDeptCode", "beneficiary_dept_code"))
	unplanned := bodyBool(body, "isUnplanned", "is_unplanned")
	hasRoutineInput := scope != "" || beneficiary != "" || hasAnyBodyKey(body, "isUnplanned", "is_unplanned")
	if category != "routine" {
		if hasRoutineInput {
			return nil, nil, false, httperror.New(http.StatusBadRequest, "routine_project_required", "routine markers are only supported for routine projects")
		}
		return nil, nil, false, nil
	}
	if creating && scope == "" {
		scope = "department"
	}
	if scope != "department" && scope != "cross_dept" {
		return nil, nil, false, httperror.New(http.StatusBadRequest, "invalid_routine_scope", "routineScope must be department or cross_dept")
	}
	if scope == "cross_dept" && beneficiary == "" {
		return nil, nil, false, httperror.New(http.StatusBadRequest, "beneficiary_dept_required", "beneficiaryDeptCode is required for cross-department assistance")
	}
	if scope == "department" {
		beneficiary = ""
	}
	return nullableText(scope), nullableText(beneficiary), unplanned, nil
}

func normalizeProjectWorkItemKind(category string, itemType string, tier string) (string, string, error) {
	if strings.TrimSpace(category) == "routine" {
		return "task", "matter", nil
	}

	itemType = strings.TrimSpace(itemType)
	if itemType == "" {
		return "", "", httperror.New(http.StatusBadRequest, "missing_work_item_type", "work item type is required")
	}
	tier = strings.TrimSpace(tier)
	if tier == "" {
		tier = "matter"
	}
	return itemType, tier, nil
}

func validateRoutineWorkItemTx(ctx context.Context, tx *sql.Tx, workItemID string) error {
	var category string
	var scope, beneficiary sql.NullString
	var milestoneID sql.NullInt64
	var isUnplanned int64
	err := tx.QueryRowContext(ctx, `
		SELECT p.category, wi.milestone_id, wi.routine_scope, wi.beneficiary_dept_code, wi.is_unplanned
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ? FOR UPDATE
	`, workItemID).Scan(&category, &milestoneID, &scope, &beneficiary, &isUnplanned)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	}
	if err != nil {
		return err
	}
	if category != "routine" {
		if !milestoneID.Valid || milestoneID.Int64 <= 0 {
			return httperror.New(http.StatusBadRequest, "milestone_required", "non-routine work items must belong to a milestone")
		}
		if scope.Valid || beneficiary.Valid || isUnplanned != 0 {
			return httperror.New(http.StatusBadRequest, "routine_project_required", "routine markers are only supported for routine projects")
		}
		return nil
	}
	if milestoneID.Valid {
		return httperror.New(http.StatusBadRequest, "routine_milestone_not_allowed", "routine work items do not belong to milestones")
	}
	if !scope.Valid || (scope.String != "department" && scope.String != "cross_dept") {
		return httperror.New(http.StatusBadRequest, "invalid_routine_scope", "routineScope must be department or cross_dept")
	}
	if scope.String == "cross_dept" && (!beneficiary.Valid || strings.TrimSpace(beneficiary.String) == "") {
		return httperror.New(http.StatusBadRequest, "beneficiary_dept_required", "beneficiaryDeptCode is required for cross-department assistance")
	}
	if scope.String == "department" && beneficiary.Valid && strings.TrimSpace(beneficiary.String) != "" {
		return httperror.New(http.StatusBadRequest, "beneficiary_dept_not_allowed", "beneficiaryDeptCode is only supported for cross-department assistance")
	}
	return nil
}
