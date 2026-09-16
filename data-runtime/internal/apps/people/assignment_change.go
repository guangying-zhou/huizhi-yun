package people

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	peopleAssignmentChangePath          = "/v1/people/assignments:change"
	peopleAssignmentChangeSourceApp     = "people"
	peopleAssignmentChangeSourceBizType = "manual_assignment_adjustment"
)

type assignmentChangeInput struct {
	EmployeeUID         string
	ChangeType          string
	EffectiveFrom       string
	DeptCode            string
	DeptName            string
	PositionCode        string
	PositionName        string
	RankCode            string
	RankName            string
	ManagerUID          string
	SourceBizID         string
	Remarks             string
	MonthlyStandardCost *float64
}

type storedAssignmentChange struct {
	AssignmentCode string
	ChangeType     string
	EffectiveFrom  string
	DeptCode       string
	DeptName       string
	PositionCode   string
	PositionName   string
	RankCode       string
	RankName       string
	ManagerUID     string
	Remarks        string
}

type futureAssignmentChangeConflict struct {
	AssignmentCode string
	ChangeType     string
	SourceApp      string
	SourceBizType  string
}

func (a *Adapter) handleAssignmentChangeRuntime(
	ctx context.Context,
	method string,
	path string,
	query url.Values,
	body map[string]any,
) (map[string]any, string, bool, error) {
	if strings.TrimRight(path, "/") != peopleAssignmentChangePath {
		return nil, "", false, nil
	}
	if method != http.MethodPost {
		return nil, "people.assignments.change", true, httperror.New(
			http.StatusMethodNotAllowed,
			"people_assignment_change_method_invalid",
			"Assignment changes require POST",
		)
	}

	input, err := parseAssignmentChangeInput(body)
	if err != nil {
		return nil, "people.assignments.change", true, err
	}
	if input.ChangeType == "rank_change" {
		if err := requireEmployeeSensitiveCostFieldAccess(query, body); err != nil {
			return nil, "people.assignments.sensitive_cost.write", true, err
		}
	}
	trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
	if err != nil {
		return nil, "people.assignments.change", true, httperror.New(
			http.StatusForbidden,
			"integration_operation_context_invalid",
			"trusted People lifecycle context is required",
		)
	}
	actor := strings.TrimSpace(query.Get("current_user"))
	creator := actor
	if creator == "" {
		creator = trusted.ServiceClientID
	}

	result, err := a.changePrimaryAssignment(ctx, input, trusted, actor, creator)
	return result, "people.assignments.change", true, err
}

func parseAssignmentChangeInput(body map[string]any) (assignmentChangeInput, error) {
	input := assignmentChangeInput{
		EmployeeUID:   cleanBodyString(body, "employee_uid", "employeeUid"),
		ChangeType:    strings.ToLower(cleanBodyString(body, "change_type", "changeType")),
		EffectiveFrom: cleanBodyString(body, "effective_from", "effectiveFrom"),
		DeptCode:      cleanBodyString(body, "dept_code", "deptCode"),
		DeptName:      cleanBodyString(body, "dept_name", "deptName"),
		PositionCode:  cleanBodyString(body, "position_code", "positionCode"),
		PositionName:  cleanBodyString(body, "position_name", "positionName"),
		RankCode:      cleanBodyString(body, "rank_code", "rankCode"),
		RankName:      cleanBodyString(body, "rank_name", "rankName"),
		ManagerUID:    cleanBodyString(body, "manager_uid", "managerUid"),
		SourceBizID:   cleanBodyString(body, "source_biz_id", "sourceBizId"),
		Remarks:       cleanBodyString(body, "remarks"),
	}
	if input.EmployeeUID == "" || input.SourceBizID == "" {
		return assignmentChangeInput{}, httperror.New(
			http.StatusBadRequest,
			"people_assignment_change_identity_invalid",
			"employee_uid and source_biz_id are required",
		)
	}
	switch input.ChangeType {
	case "transfer", "rank_change", "leave":
	default:
		return assignmentChangeInput{}, httperror.New(
			http.StatusBadRequest,
			"people_assignment_change_type_invalid",
			"change_type must be transfer, rank_change or leave",
		)
	}
	if _, err := time.Parse(assignmentDateLayout, input.EffectiveFrom); err != nil {
		return assignmentChangeInput{}, httperror.New(
			http.StatusBadRequest,
			"invalid_effective_date",
			"effective_from must be YYYY-MM-DD",
		)
	}
	for _, field := range []struct {
		name  string
		value string
		limit int
	}{
		{name: "employee_uid", value: input.EmployeeUID, limit: 64},
		{name: "dept_code", value: input.DeptCode, limit: 64},
		{name: "dept_name", value: input.DeptName, limit: 100},
		{name: "position_code", value: input.PositionCode, limit: 64},
		{name: "position_name", value: input.PositionName, limit: 100},
		{name: "rank_code", value: input.RankCode, limit: 32},
		{name: "rank_name", value: input.RankName, limit: 100},
		{name: "manager_uid", value: input.ManagerUID, limit: 64},
		{name: "source_biz_id", value: input.SourceBizID, limit: 128},
		{name: "remarks", value: input.Remarks, limit: 500},
	} {
		if utf8.RuneCountInString(field.value) > field.limit {
			return assignmentChangeInput{}, httperror.New(
				http.StatusBadRequest,
				"people_assignment_change_field_too_long",
				fmt.Sprintf("%s exceeds %d characters", field.name, field.limit),
			)
		}
	}
	if input.ChangeType == "rank_change" {
		if input.RankCode == "" {
			return assignmentChangeInput{}, httperror.New(
				http.StatusBadRequest,
				"people_assignment_rank_required",
				"rank_code is required for rank changes",
			)
		}
		value, exists := assignmentMutationValue(body, "monthly_standard_cost", "monthlyStandardCost")
		if !exists {
			return assignmentChangeInput{}, httperror.New(
				http.StatusBadRequest,
				"people_assignment_standard_cost_required",
				"monthly_standard_cost is required for rank changes",
			)
		}
		cost, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
		if err != nil || math.IsNaN(cost) || math.IsInf(cost, 0) || cost < 0 {
			return assignmentChangeInput{}, httperror.New(
				http.StatusBadRequest,
				"people_assignment_standard_cost_invalid",
				"monthly_standard_cost must be a non-negative number",
			)
		}
		input.MonthlyStandardCost = &cost
	}
	return input, nil
}

func (a *Adapter) changePrimaryAssignment(
	ctx context.Context,
	input assignmentChangeInput,
	trusted integrationoperation.TrustedContext,
	actor string,
	creator string,
) (map[string]any, error) {
	effectiveFrom, _ := time.Parse(assignmentDateLayout, input.EffectiveFrom)
	effectiveTo := effectiveFrom.AddDate(0, 0, -1).Format(assignmentDateLayout)
	asOf := time.Now().UTC()

	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var lockedEmployeeUID string
	var currentRankCode, currentRankName sql.NullString
	if err := tx.QueryRowContext(ctx, `
		SELECT employee_uid,rank_code,rank_name
		FROM people_employees
		WHERE employee_uid=? AND archived_at IS NULL
		FOR UPDATE
	`, input.EmployeeUID).Scan(&lockedEmployeeUID, &currentRankCode, &currentRankName); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "people_employee_not_found", "Employee not found")
		}
		return nil, err
	}
	if input.ChangeType != "rank_change" {
		input.RankCode = currentRankCode.String
		input.RankName = currentRankName.String
	}

	existing, err := loadStoredAssignmentChange(ctx, tx, input)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if err == nil {
		input = canonicalizeIdempotentAssignmentInput(existing, input)
		if !storedAssignmentChangeMatches(existing, input) {
			return nil, httperror.New(
				http.StatusConflict,
				"people_assignment_change_idempotency_conflict",
				"source_biz_id was already used for a different assignment change",
			)
		}
		metadata, err := a.freezeDirectoryLifecycleOperationAtTx(ctx, tx, input.EmployeeUID, trusted, actor, creator, asOf)
		if err != nil {
			return nil, err
		}
		result := assignmentChangeResult(existing.AssignmentCode, input, nil, nil, true)
		mergeAssignmentChangeMetadata(result, metadata)
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return result, nil
	}

	if input.ChangeType == "rank_change" {
		var canonicalRankCode, canonicalRankName string
		if err := tx.QueryRowContext(ctx, `
			SELECT rank_code,rank_name
			FROM people_ranks
			WHERE rank_code=? AND enabled=1
			LIMIT 1
			FOR SHARE
		`, input.RankCode).Scan(&canonicalRankCode, &canonicalRankName); err != nil {
			if err == sql.ErrNoRows {
				return nil, httperror.New(
					http.StatusBadRequest,
					"people_assignment_rank_unavailable",
					"rank_code must reference an enabled rank",
				)
			}
			return nil, err
		}
		input.RankCode = canonicalRankCode
		input.RankName = canonicalRankName
	}

	futureRows, err := tx.QueryContext(ctx, `
		SELECT assignment_code,change_type,COALESCE(source_app,''),COALESCE(source_biz_type,'')
		FROM people_assignments
		WHERE employee_uid=?
		  AND is_primary=1
		  AND approval_status IN ('none','approved')
		  AND effective_from>=?
		ORDER BY effective_from ASC,id ASC
		FOR UPDATE
	`, input.EmployeeUID, input.EffectiveFrom)
	if err != nil {
		return nil, err
	}
	supersededAssignmentCodes := make([]string, 0)
	for futureRows.Next() {
		var future futureAssignmentChangeConflict
		if err := futureRows.Scan(&future.AssignmentCode, &future.ChangeType, &future.SourceApp, &future.SourceBizType); err != nil {
			_ = futureRows.Close()
			return nil, err
		}
		if !assignmentIsDirectoryBootstrap(future) {
			_ = futureRows.Close()
			return nil, httperror.New(
				http.StatusConflict,
				"people_assignment_change_future_conflict",
				fmt.Sprintf("Assignment change conflicts with existing assignment %s on or after the effective date", future.AssignmentCode),
			)
		}
		supersededAssignmentCodes = append(supersededAssignmentCodes, future.AssignmentCode)
	}
	if err := futureRows.Err(); err != nil {
		_ = futureRows.Close()
		return nil, err
	}
	if err := futureRows.Close(); err != nil {
		return nil, err
	}
	for _, assignmentCode := range supersededAssignmentCodes {
		if _, err := tx.ExecContext(ctx, `
			UPDATE people_assignments
			SET approval_status='cancelled',updated_by=?,updated_at=NOW()
			WHERE assignment_code=?
		`, nullablePeopleText(actor), assignmentCode); err != nil {
			return nil, err
		}
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT assignment_code
		FROM people_assignments
		WHERE employee_uid=?
		  AND is_primary=1
		  AND approval_status IN ('none','approved')
		  AND effective_from<?
		  AND (effective_to IS NULL OR effective_to>=?)
		ORDER BY effective_from ASC,id ASC
		FOR UPDATE
	`, input.EmployeeUID, input.EffectiveFrom, input.EffectiveFrom)
	if err != nil {
		return nil, err
	}
	closedAssignmentCodes := make([]string, 0)
	for rows.Next() {
		var assignmentCode string
		if err := rows.Scan(&assignmentCode); err != nil {
			_ = rows.Close()
			return nil, err
		}
		closedAssignmentCodes = append(closedAssignmentCodes, assignmentCode)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	for _, assignmentCode := range closedAssignmentCodes {
		if _, err := tx.ExecContext(ctx, `
			UPDATE people_assignments
			SET effective_to=?,updated_by=?,updated_at=NOW()
			WHERE assignment_code=?
		`, effectiveTo, nullablePeopleText(actor), assignmentCode); err != nil {
			return nil, err
		}
	}

	assignmentCode := generatedCode("ASN")
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO people_assignments (
			assignment_code,employee_uid,change_type,effective_from,effective_to,is_primary,
			dept_code,dept_name,position_code,position_name,rank_code,rank_name,manager_uid,
			approval_status,source_app,source_biz_type,source_biz_id,remarks,created_by,updated_by
		) VALUES (?,?,?,?,NULL,1,?,?,?,?,?,?,?,'none',?,?,?,?,?,?)
	`,
		assignmentCode,
		input.EmployeeUID,
		input.ChangeType,
		input.EffectiveFrom,
		nullablePeopleText(input.DeptCode),
		nullablePeopleText(input.DeptName),
		nullablePeopleText(input.PositionCode),
		nullablePeopleText(input.PositionName),
		nullablePeopleText(input.RankCode),
		nullablePeopleText(input.RankName),
		nullablePeopleText(input.ManagerUID),
		peopleAssignmentChangeSourceApp,
		peopleAssignmentChangeSourceBizType,
		input.SourceBizID,
		nullablePeopleText(input.Remarks),
		nullablePeopleText(creator),
		nullablePeopleText(creator),
	); err != nil {
		return nil, err
	}

	if !effectiveFrom.After(asOf) {
		if err := updateEmployeeFromAssignmentChange(ctx, tx, input, actor); err != nil {
			return nil, err
		}
	}

	metadata, err := a.freezeDirectoryLifecycleOperationAtTx(ctx, tx, input.EmployeeUID, trusted, actor, creator, asOf)
	if err != nil {
		return nil, err
	}
	result := assignmentChangeResult(assignmentCode, input, closedAssignmentCodes, supersededAssignmentCodes, false)
	mergeAssignmentChangeMetadata(result, metadata)
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func loadStoredAssignmentChange(ctx context.Context, tx *sql.Tx, input assignmentChangeInput) (storedAssignmentChange, error) {
	var stored storedAssignmentChange
	var deptCode, deptName, positionCode, positionName, rankCode, rankName, managerUID, remarks sql.NullString
	err := tx.QueryRowContext(ctx, `
		SELECT assignment_code,change_type,DATE_FORMAT(effective_from,'%Y-%m-%d'),
		       dept_code,dept_name,position_code,position_name,rank_code,rank_name,manager_uid,remarks
		FROM people_assignments
		WHERE employee_uid=? AND source_app=? AND source_biz_type=? AND source_biz_id=?
		ORDER BY id DESC
		LIMIT 1
		FOR UPDATE
	`,
		input.EmployeeUID,
		peopleAssignmentChangeSourceApp,
		peopleAssignmentChangeSourceBizType,
		input.SourceBizID,
	).Scan(
		&stored.AssignmentCode,
		&stored.ChangeType,
		&stored.EffectiveFrom,
		&deptCode,
		&deptName,
		&positionCode,
		&positionName,
		&rankCode,
		&rankName,
		&managerUID,
		&remarks,
	)
	stored.DeptCode = deptCode.String
	stored.DeptName = deptName.String
	stored.PositionCode = positionCode.String
	stored.PositionName = positionName.String
	stored.RankCode = rankCode.String
	stored.RankName = rankName.String
	stored.ManagerUID = managerUID.String
	stored.Remarks = remarks.String
	return stored, err
}

func canonicalizeIdempotentAssignmentInput(stored storedAssignmentChange, input assignmentChangeInput) assignmentChangeInput {
	if input.ChangeType == "rank_change" {
		input.RankName = stored.RankName
	}
	return input
}

func storedAssignmentChangeMatches(stored storedAssignmentChange, input assignmentChangeInput) bool {
	rankCodeMatches := stored.RankCode == input.RankCode
	if input.ChangeType == "rank_change" {
		rankCodeMatches = strings.EqualFold(strings.TrimSpace(stored.RankCode), strings.TrimSpace(input.RankCode))
	}
	return stored.ChangeType == input.ChangeType &&
		stored.EffectiveFrom == input.EffectiveFrom &&
		stored.DeptCode == input.DeptCode &&
		stored.DeptName == input.DeptName &&
		stored.PositionCode == input.PositionCode &&
		stored.PositionName == input.PositionName &&
		rankCodeMatches &&
		stored.RankName == input.RankName &&
		stored.ManagerUID == input.ManagerUID &&
		stored.Remarks == input.Remarks
}

func assignmentIsDirectoryBootstrap(assignment futureAssignmentChangeConflict) bool {
	return strings.HasPrefix(strings.ToUpper(strings.TrimSpace(assignment.AssignmentCode)), "ASN-DIR-") &&
		strings.EqualFold(strings.TrimSpace(assignment.ChangeType), "onboard") &&
		strings.EqualFold(strings.TrimSpace(assignment.SourceApp), "console") &&
		strings.EqualFold(strings.TrimSpace(assignment.SourceBizType), "directory_user")
}

func updateEmployeeFromAssignmentChange(ctx context.Context, tx *sql.Tx, input assignmentChangeInput, actor string) error {
	employmentStatus := ""
	leaveDate := any(nil)
	if input.ChangeType == "leave" {
		employmentStatus = "left"
		leaveDate = input.EffectiveFrom
	}
	if input.MonthlyStandardCost != nil {
		_, err := tx.ExecContext(ctx, `
			UPDATE people_employees
			SET dept_code=?,dept_name=?,position_code=?,position_name=?,rank_code=?,rank_name=?,manager_uid=?,
			    employment_status=IF(?='',employment_status,?),leave_date=IF(? IS NULL,leave_date,?),
			    monthly_standard_cost=?,updated_by=?,updated_at=NOW()
			WHERE employee_uid=? AND archived_at IS NULL
		`,
			nullablePeopleText(input.DeptCode),
			nullablePeopleText(input.DeptName),
			nullablePeopleText(input.PositionCode),
			nullablePeopleText(input.PositionName),
			nullablePeopleText(input.RankCode),
			nullablePeopleText(input.RankName),
			nullablePeopleText(input.ManagerUID),
			employmentStatus,
			employmentStatus,
			leaveDate,
			leaveDate,
			*input.MonthlyStandardCost,
			nullablePeopleText(actor),
			input.EmployeeUID,
		)
		return err
	}
	_, err := tx.ExecContext(ctx, `
		UPDATE people_employees
		SET dept_code=?,dept_name=?,position_code=?,position_name=?,rank_code=?,rank_name=?,manager_uid=?,
		    employment_status=IF(?='',employment_status,?),leave_date=IF(? IS NULL,leave_date,?),
		    updated_by=?,updated_at=NOW()
		WHERE employee_uid=? AND archived_at IS NULL
	`,
		nullablePeopleText(input.DeptCode),
		nullablePeopleText(input.DeptName),
		nullablePeopleText(input.PositionCode),
		nullablePeopleText(input.PositionName),
		nullablePeopleText(input.RankCode),
		nullablePeopleText(input.RankName),
		nullablePeopleText(input.ManagerUID),
		employmentStatus,
		employmentStatus,
		leaveDate,
		leaveDate,
		nullablePeopleText(actor),
		input.EmployeeUID,
	)
	return err
}

func assignmentChangeResult(
	assignmentCode string,
	input assignmentChangeInput,
	closedAssignmentCodes []string,
	supersededAssignmentCodes []string,
	idempotent bool,
) map[string]any {
	return map[string]any{
		"assignment_code":             assignmentCode,
		"employee_uid":                input.EmployeeUID,
		"change_type":                 input.ChangeType,
		"effective_from":              input.EffectiveFrom,
		"dept_code":                   input.DeptCode,
		"dept_name":                   input.DeptName,
		"position_code":               input.PositionCode,
		"position_name":               input.PositionName,
		"rank_code":                   input.RankCode,
		"rank_name":                   input.RankName,
		"manager_uid":                 input.ManagerUID,
		"closed_assignment_codes":     closedAssignmentCodes,
		"superseded_assignment_codes": supersededAssignmentCodes,
		"idempotent":                  idempotent,
	}
}

func mergeAssignmentChangeMetadata(result map[string]any, metadata map[string]any) {
	for key, value := range metadata {
		result[key] = value
	}
}
