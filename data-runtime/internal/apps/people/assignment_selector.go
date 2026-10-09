package people

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const assignmentDateLayout = "2006-01-02"

func assignmentApprovalIsEffective(value any) bool {
	switch strings.ToLower(cleanAnyString(value)) {
	case "none", "approved":
		return true
	default:
		return false
	}
}

func assignmentIsPrimary(value any) bool {
	switch strings.ToLower(cleanAnyString(value)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func assignmentDate(value any) (time.Time, bool) {
	if typed, ok := value.(time.Time); ok {
		return typed, true
	}
	text := cleanAnyString(value)
	if len(text) >= len(assignmentDateLayout) {
		text = text[:len(assignmentDateLayout)]
	}
	parsed, err := time.Parse(assignmentDateLayout, text)
	return parsed, err == nil
}

func assignmentEffectiveAt(row map[string]any, asOf time.Time) bool {
	if !assignmentIsPrimary(row["is_primary"]) || !assignmentApprovalIsEffective(row["approval_status"]) {
		return false
	}
	from, ok := assignmentDate(row["effective_from"])
	if !ok || from.After(asOf) {
		return false
	}
	if cleanAnyString(row["effective_to"]) == "" {
		return true
	}
	to, ok := assignmentDate(row["effective_to"])
	return ok && !to.Before(asOf)
}

func assignmentIsNewer(candidate map[string]any, current map[string]any) bool {
	candidateFrom, candidateOK := assignmentDate(candidate["effective_from"])
	currentFrom, currentOK := assignmentDate(current["effective_from"])
	if candidateOK && currentOK && !candidateFrom.Equal(currentFrom) {
		return candidateFrom.After(currentFrom)
	}
	return float64FromAny(candidate["id"]) > float64FromAny(current["id"])
}

func selectEffectivePrimaryAssignments(rows []map[string]any, asOfDate string) (map[string]map[string]any, error) {
	asOf, err := time.Parse(assignmentDateLayout, strings.TrimSpace(asOfDate))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_effective_date", "effective_date must be YYYY-MM-DD")
	}

	selected := make(map[string]map[string]any)
	for _, row := range rows {
		employeeUID := cleanAnyString(row["employee_uid"])
		if employeeUID == "" || !assignmentEffectiveAt(row, asOf) {
			continue
		}
		current, exists := selected[employeeUID]
		if !exists || assignmentIsNewer(row, current) {
			selected[employeeUID] = row
		}
	}
	return selected, nil
}

func (a *Adapter) effectivePrimaryAssignmentsByEmployee(ctx context.Context, employeeUIDs []string, effectiveDate string) (map[string]map[string]any, error) {
	if len(employeeUIDs) == 0 {
		return map[string]map[string]any{}, nil
	}
	rows, err := a.queryMaps(ctx, `
		SELECT *
		FROM people_assignments
		WHERE employee_uid IN (`+placeholders(len(employeeUIDs))+`)
		  AND is_primary = 1
		  AND approval_status IN ('none', 'approved')
		  AND effective_from <= ?
		  AND (effective_to IS NULL OR effective_to >= ?)
		ORDER BY employee_uid ASC, effective_from DESC, id DESC
	`, append(stringArgs(employeeUIDs), effectiveDate, effectiveDate)...)
	if err != nil {
		return nil, err
	}
	return selectEffectivePrimaryAssignments(rows, effectiveDate)
}

func stringArgs(values []string) []any {
	args := make([]any, 0, len(values))
	for _, value := range values {
		args = append(args, value)
	}
	return args
}

func assignmentPeriodsOverlap(leftFrom string, leftTo string, rightFrom string, rightTo string) bool {
	leftStart, leftOK := assignmentDate(leftFrom)
	rightStart, rightOK := assignmentDate(rightFrom)
	if !leftOK || !rightOK {
		return false
	}
	leftEnd := time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)
	if text := strings.TrimSpace(leftTo); text != "" {
		parsed, ok := assignmentDate(text)
		if !ok {
			return false
		}
		leftEnd = parsed
	}
	rightEnd := time.Date(9999, 12, 31, 0, 0, 0, 0, time.UTC)
	if text := strings.TrimSpace(rightTo); text != "" {
		parsed, ok := assignmentDate(text)
		if !ok {
			return false
		}
		rightEnd = parsed
	}
	return !leftStart.After(rightEnd) && !rightStart.After(leftEnd)
}

func (a *Adapter) ensureNoEffectivePrimaryAssignmentOverlap(ctx context.Context, assignment map[string]any) error {
	if !assignmentIsPrimary(assignment["is_primary"]) {
		return nil
	}
	employeeUID := cleanAnyString(assignment["employee_uid"])
	assignmentCode := cleanAnyString(assignment["assignment_code"])
	effectiveFrom := cleanAnyString(assignment["effective_from"])
	effectiveTo := cleanAnyString(assignment["effective_to"])
	if employeeUID == "" || assignmentCode == "" || effectiveFrom == "" {
		return nil
	}
	endBoundary := effectiveTo
	if endBoundary == "" {
		endBoundary = "9999-12-31"
	}

	var conflictingCode string
	err := a.DB().QueryRowContext(ctx, `
		SELECT assignment_code
		FROM people_assignments
		WHERE employee_uid = ?
		  AND assignment_code <> ?
		  AND is_primary = 1
		  AND approval_status IN ('none', 'approved')
		  AND effective_from <= ?
		  AND (effective_to IS NULL OR effective_to >= ?)
		ORDER BY effective_from DESC, id DESC
		LIMIT 1
	`, employeeUID, assignmentCode, endBoundary, effectiveFrom).Scan(&conflictingCode)
	if err == nil {
		return httperror.New(
			http.StatusConflict,
			"people_primary_assignment_overlap",
			fmt.Sprintf("Primary assignment period overlaps with %s", conflictingCode),
		)
	}
	if err == sql.ErrNoRows {
		return nil
	}
	return err
}

func (a *Adapter) ensureWorkflowApprovalPrimaryAssignmentConflictFree(ctx context.Context, bizID string) error {
	rows, err := a.queryMaps(ctx, `
		SELECT assignment_code, employee_uid, is_primary, effective_from, effective_to
		FROM people_assignments
		WHERE assignment_code = ? OR source_biz_id = ?
	`, bizID, bizID)
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := a.ensureNoEffectivePrimaryAssignmentOverlap(ctx, row); err != nil {
			return err
		}
	}
	return nil
}

func assignmentMutationValue(body map[string]any, keys ...string) (any, bool) {
	for _, key := range keys {
		value, exists := body[key]
		if exists {
			return value, true
		}
	}
	return nil, false
}

func (a *Adapter) ensureGenericAssignmentMutationConflictFree(ctx context.Context, method string, path string, body map[string]any) error {
	method = strings.ToUpper(strings.TrimSpace(method))
	trimmedPath := strings.TrimRight(path, "/")
	if method == http.MethodPost && trimmedPath == "/v1/people/assignments" {
		assignmentCode := cleanBodyString(body, "assignment_code", "assignmentCode")
		if assignmentCode == "" {
			assignmentCode = generatedCode("ASN-OVERLAP-CHECK")
		}
		isPrimary := any(1)
		if value, exists := assignmentMutationValue(body, "is_primary", "isPrimary"); exists {
			isPrimary = value
		}
		return a.ensureNoEffectivePrimaryAssignmentOverlap(ctx, map[string]any{
			"assignment_code": assignmentCode,
			"employee_uid":    cleanBodyString(body, "employee_uid", "employeeUid"),
			"is_primary":      isPrimary,
			"approval_status": "none",
			"effective_from":  cleanBodyString(body, "effective_from", "effectiveFrom"),
			"effective_to":    cleanBodyString(body, "effective_to", "effectiveTo"),
		})
	}
	if method != http.MethodPatch && method != http.MethodPut {
		return nil
	}
	prefix := "/v1/people/assignments/"
	assignmentCode := strings.TrimPrefix(trimmedPath, prefix)
	if !strings.HasPrefix(trimmedPath, prefix) || !singleSegment(assignmentCode) {
		return nil
	}
	if _, touchesEmployee := assignmentMutationValue(body, "employee_uid", "employeeUid"); !touchesEmployee {
		if _, touchesPrimary := assignmentMutationValue(body, "is_primary", "isPrimary"); !touchesPrimary {
			if _, touchesFrom := assignmentMutationValue(body, "effective_from", "effectiveFrom"); !touchesFrom {
				if _, touchesTo := assignmentMutationValue(body, "effective_to", "effectiveTo"); !touchesTo {
					return nil
				}
			}
		}
	}

	current, err := a.queryRowMap(ctx, `
		SELECT assignment_code, employee_uid, is_primary, approval_status, effective_from, effective_to
		FROM people_assignments
		WHERE assignment_code = ?
		LIMIT 1
	`, assignmentCode)
	if err != nil || current == nil {
		return err
	}
	for _, field := range []struct {
		column string
		keys   []string
	}{
		{column: "employee_uid", keys: []string{"employee_uid", "employeeUid"}},
		{column: "is_primary", keys: []string{"is_primary", "isPrimary"}},
		{column: "effective_from", keys: []string{"effective_from", "effectiveFrom"}},
		{column: "effective_to", keys: []string{"effective_to", "effectiveTo"}},
	} {
		if value, exists := assignmentMutationValue(body, field.keys...); exists {
			current[field.column] = value
		}
	}
	if !assignmentApprovalIsEffective(current["approval_status"]) {
		return nil
	}
	return a.ensureNoEffectivePrimaryAssignmentOverlap(ctx, current)
}
