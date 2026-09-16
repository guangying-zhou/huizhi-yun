package people

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const (
	offboardingTaskHandover      = "handover"
	offboardingTaskAssetRecovery = "asset_recovery_coordination"
)

type offboardingTaskInput struct {
	ResponsibleUID string
	DueAt          time.Time
}

type offboardingCreateInput struct {
	LeaveAssignmentCode string
	CaseCode            string
	Handover            offboardingTaskInput
	AssetRecovery       *offboardingTaskInput
}

type offboardingCaseRecord struct {
	ID                  int64
	CaseCode            string
	LeaveAssignmentCode string
	EmployeeUID         string
	Status              string
	ObjectVersion       int64
	CompletedAt         sql.NullTime
	CompletedBy         sql.NullString
	CancelledAt         sql.NullTime
	CancelledBy         sql.NullString
	CancellationReason  sql.NullString
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type offboardingTaskRecord struct {
	ID                 int64
	TaskCode           string
	CaseCode           string
	TaskType           string
	ResponsibleUID     string
	DueAt              time.Time
	Status             string
	ObjectVersion      int64
	CompletedAt        sql.NullTime
	CompletedBy        sql.NullString
	CancelledAt        sql.NullTime
	CancelledBy        sql.NullString
	CancellationReason sql.NullString
	CreatedAt          time.Time
	UpdatedAt          time.Time
}

type offboardingListCursor struct {
	UpdatedAt string `json:"updatedAt"`
	ID        int64  `json:"id"`
}

func (a *Adapter) handleOffboardingRuntime(ctx context.Context, method, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	switch {
	case method == http.MethodPost && path == "/v1/people/offboarding-cases":
		if !peopleRuntimeHasScope(query, "people:offboarding_tasks:admin") {
			return nil, "people.offboarding_cases.create", true, offboardingForbidden()
		}
		result, err := a.createOffboardingCase(ctx, query, body)
		return result, "people.offboarding_cases.create", true, err
	case method == http.MethodGet && path == "/v1/people/offboarding-cases":
		if !peopleRuntimeHasScope(query, "people:offboarding_tasks:view") {
			return nil, "people.offboarding_cases.list", true, offboardingForbidden()
		}
		result, err := a.listOffboardingCases(ctx, query)
		return result, "people.offboarding_cases.list", true, err
	case method == http.MethodGet && strings.HasPrefix(path, "/v1/people/offboarding-cases/"):
		if !peopleRuntimeHasScope(query, "people:offboarding_tasks:view") {
			return nil, "people.offboarding_cases.detail", true, offboardingForbidden()
		}
		caseCode := strings.TrimPrefix(path, "/v1/people/offboarding-cases/")
		if !singleSegment(caseCode) {
			return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
		}
		result, err := a.getOffboardingCase(ctx, caseCode, query)
		return result, "people.offboarding_cases.detail", true, err
	case method == http.MethodPost && strings.HasPrefix(path, "/v1/people/offboarding-tasks/"):
		tail := strings.TrimPrefix(path, "/v1/people/offboarding-tasks/")
		if strings.HasSuffix(tail, ":confirm") {
			taskCode := strings.TrimSuffix(tail, ":confirm")
			if !singleSegment(taskCode) {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			if !peopleRuntimeHasScope(query, "people:offboarding_tasks:confirm") {
				return nil, "people.offboarding_tasks.confirm", true, offboardingForbidden()
			}
			result, err := a.transitionOffboardingTask(ctx, taskCode, "confirm", query, body)
			return result, "people.offboarding_tasks.confirm", true, err
		}
		if strings.HasSuffix(tail, ":cancel") {
			taskCode := strings.TrimSuffix(tail, ":cancel")
			if !singleSegment(taskCode) {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			if !peopleRuntimeHasScope(query, "people:offboarding_tasks:cancel") {
				return nil, "people.offboarding_tasks.cancel", true, offboardingForbidden()
			}
			result, err := a.transitionOffboardingTask(ctx, taskCode, "cancel", query, body)
			return result, "people.offboarding_tasks.cancel", true, err
		}
	}
	return nil, "", false, nil
}

func (a *Adapter) createOffboardingCase(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actor := offboardingActor(query)
	if err := validateOffboardingIdentity(actor, "actor"); err != nil {
		return nil, err
	}
	input, err := parseOffboardingCreateInput(body)
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var employeeUID string
	err = tx.QueryRowContext(ctx, `
		SELECT employee_uid
		FROM people_assignments
		WHERE assignment_code=? AND change_type='leave' AND approval_status IN ('none','approved')
		LIMIT 1 FOR UPDATE`, input.LeaveAssignmentCode).Scan(&employeeUID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusUnprocessableEntity, "offboarding_leave_assignment_invalid", "leaveAssignmentCode must reference an approved or approval-free leave assignment")
	}
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(employeeUID, input.Handover.ResponsibleUID) || input.AssetRecovery != nil && strings.EqualFold(employeeUID, input.AssetRecovery.ResponsibleUID) {
		return nil, httperror.New(http.StatusUnprocessableEntity, "offboarding_responsible_invalid", "the leaving employee cannot be an offboarding task responsible user")
	}
	if input.CaseCode == "" {
		input.CaseCode = stableOffboardingCaseCode(input.LeaveAssignmentCode)
	}

	existingCase, err := queryOffboardingCaseTx(ctx, tx, `WHERE leave_assignment_code=? OR case_code=? LIMIT 1 FOR UPDATE`, input.LeaveAssignmentCode, input.CaseCode)
	if err != nil {
		return nil, err
	}
	if existingCase != nil {
		tasks, err := queryOffboardingTasksTx(ctx, tx, existingCase.CaseCode, true)
		if err != nil {
			return nil, err
		}
		if offboardingCreateMatches(*existingCase, tasks, input, employeeUID) {
			if err := tx.Commit(); err != nil {
				return nil, err
			}
			return offboardingCaseAggregate(*existingCase, tasks, true), nil
		}
		return nil, httperror.New(http.StatusConflict, "offboarding_create_conflict", "the leave assignment or case code already has a different offboarding payload")
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO people_offboarding_cases
		(case_code, leave_assignment_code, employee_uid, status, object_version, created_by, updated_by)
		VALUES (?, ?, ?, 'active', 1, ?, ?)`, input.CaseCode, input.LeaveAssignmentCode, employeeUID, actor, actor); err != nil {
		if offboardingDuplicateKey(err) {
			return nil, httperror.New(http.StatusConflict, "offboarding_create_conflict", "the leave assignment or case code already has a different offboarding payload")
		}
		return nil, err
	}
	for _, task := range offboardingTaskInputs(input) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO people_offboarding_tasks
			(task_code, case_code, task_type, responsible_uid, due_at, status, object_version, created_by, updated_by)
			VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)`,
			stableOffboardingTaskCode(input.CaseCode, task.taskType), input.CaseCode, task.taskType,
			task.input.ResponsibleUID, task.input.DueAt.UTC(), actor, actor); err != nil {
			if offboardingDuplicateKey(err) {
				return nil, httperror.New(http.StatusConflict, "offboarding_create_conflict", "the offboarding task identity already exists with a different payload")
			}
			return nil, err
		}
	}
	createdCase, err := queryOffboardingCaseTx(ctx, tx, `WHERE case_code=? LIMIT 1`, input.CaseCode)
	if err != nil {
		return nil, err
	}
	tasks, err := queryOffboardingTasksTx(ctx, tx, input.CaseCode, false)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return offboardingCaseAggregate(*createdCase, tasks, false), nil
}

func parseOffboardingCreateInput(body map[string]any) (offboardingCreateInput, error) {
	input := offboardingCreateInput{
		LeaveAssignmentCode: strings.TrimSpace(cleanBodyString(body, "leaveAssignmentCode")),
		CaseCode:            strings.TrimSpace(cleanBodyString(body, "caseCode")),
	}
	if err := validateOffboardingCode(input.LeaveAssignmentCode, "leaveAssignmentCode"); err != nil {
		return input, err
	}
	if input.CaseCode != "" {
		if err := validateOffboardingCode(input.CaseCode, "caseCode"); err != nil {
			return input, err
		}
	}
	var err error
	input.Handover, err = parseOffboardingTaskInput(body["handover"], "handover")
	if err != nil {
		return input, err
	}
	if value, exists := body["assetRecoveryCoordination"]; exists && value != nil {
		parsed, parseErr := parseOffboardingTaskInput(value, "assetRecoveryCoordination")
		if parseErr != nil {
			return input, parseErr
		}
		input.AssetRecovery = &parsed
	}
	return input, nil
}

func parseOffboardingTaskInput(value any, field string) (offboardingTaskInput, error) {
	object, ok := value.(map[string]any)
	if !ok || len(object) != 2 {
		return offboardingTaskInput{}, httperror.New(http.StatusBadRequest, "offboarding_request_invalid", field+" must contain exactly responsibleUid and dueAt")
	}
	for key := range object {
		if key != "responsibleUid" && key != "dueAt" {
			return offboardingTaskInput{}, httperror.New(http.StatusBadRequest, "offboarding_request_invalid", field+" contains an unsupported field")
		}
	}
	responsible, responsibleOK := object["responsibleUid"].(string)
	if !responsibleOK {
		return offboardingTaskInput{}, httperror.New(http.StatusBadRequest, "offboarding_request_invalid", field+".responsibleUid must be a string")
	}
	if err := validateOffboardingIdentity(responsible, field+".responsibleUid"); err != nil {
		return offboardingTaskInput{}, err
	}
	dueAtText, dueAtOK := object["dueAt"].(string)
	if !dueAtOK || dueAtText != strings.TrimSpace(dueAtText) {
		return offboardingTaskInput{}, httperror.New(http.StatusBadRequest, "offboarding_due_at_invalid", field+".dueAt must be an RFC3339 timestamp")
	}
	dueAt, err := time.Parse(time.RFC3339, dueAtText)
	if err != nil {
		return offboardingTaskInput{}, httperror.New(http.StatusBadRequest, "offboarding_due_at_invalid", field+".dueAt must be an RFC3339 timestamp")
	}
	return offboardingTaskInput{ResponsibleUID: responsible, DueAt: dueAt.UTC().Truncate(time.Second)}, nil
}

func (a *Adapter) listOffboardingCases(ctx context.Context, query url.Values) (map[string]any, error) {
	actor := offboardingActor(query)
	if err := validateOffboardingIdentity(actor, "actor"); err != nil {
		return nil, offboardingForbidden()
	}
	admin := peopleRuntimeAdmin(query)
	limit, err := parseOffboardingListLimit(query.Get("limit"))
	if err != nil {
		return nil, err
	}
	cursor, err := decodeOffboardingListCursor(query.Get("cursor"))
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_cursor_invalid", "cursor is invalid")
	}
	where := []string{"1=1"}
	args := make([]any, 0)
	if !admin {
		where = append(where, `EXISTS (SELECT 1 FROM people_offboarding_tasks visible_task WHERE visible_task.case_code=c.case_code AND visible_task.responsible_uid=?)`)
		args = append(args, actor)
	}
	if cursor != nil {
		value, _ := time.Parse(time.RFC3339, cursor.UpdatedAt)
		where = append(where, `(c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))`)
		args = append(args, value.UTC(), value.UTC(), cursor.ID)
	}
	args = append(args, limit+1)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT c.id,c.case_code,c.leave_assignment_code,c.employee_uid,c.status,c.object_version,
		       c.completed_at,c.completed_by,c.cancelled_at,c.cancelled_by,c.cancellation_reason,c.created_at,c.updated_at
		FROM people_offboarding_cases c
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	cases, err := scanOffboardingCases(rows)
	if err != nil {
		return nil, err
	}
	hasMore := len(cases) > limit
	if hasMore {
		cases = cases[:limit]
	}
	items := make([]map[string]any, 0, len(cases))
	for _, item := range cases {
		tasks, err := queryOffboardingTasksDB(ctx, a.DB(), item.CaseCode)
		if err != nil {
			return nil, err
		}
		items = append(items, map[string]any{"case": offboardingCaseResponse(item), "tasks": offboardingTaskResponses(tasks)})
	}
	var nextCursor any
	if hasMore && len(cases) > 0 {
		nextCursor, err = encodeOffboardingListCursor(cases[len(cases)-1].UpdatedAt, cases[len(cases)-1].ID)
		if err != nil {
			return nil, err
		}
	}
	return map[string]any{"items": items, "nextCursor": nextCursor}, nil
}

func (a *Adapter) getOffboardingCase(ctx context.Context, caseCode string, query url.Values) (map[string]any, error) {
	actor := offboardingActor(query)
	if err := validateOffboardingIdentity(actor, "actor"); err != nil {
		return nil, offboardingForbidden()
	}
	admin := peopleRuntimeAdmin(query)
	args := []any{caseCode}
	access := ""
	if !admin {
		access = ` AND EXISTS (SELECT 1 FROM people_offboarding_tasks visible_task WHERE visible_task.case_code=c.case_code AND visible_task.responsible_uid=?)`
		args = append(args, actor)
	}
	row := a.DB().QueryRowContext(ctx, `
		SELECT c.id,c.case_code,c.leave_assignment_code,c.employee_uid,c.status,c.object_version,
		       c.completed_at,c.completed_by,c.cancelled_at,c.cancelled_by,c.cancellation_reason,c.created_at,c.updated_at
		FROM people_offboarding_cases c WHERE c.case_code=?`+access+` LIMIT 1`, args...)
	item, err := scanOffboardingCaseRow(row)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "offboarding_case_not_found", "offboarding case was not found")
	}
	if err != nil {
		return nil, err
	}
	tasks, err := queryOffboardingTasksDB(ctx, a.DB(), item.CaseCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{"case": offboardingCaseResponse(*item), "tasks": offboardingTaskResponses(tasks)}, nil
}

func (a *Adapter) transitionOffboardingTask(ctx context.Context, taskCode, action string, query url.Values, body map[string]any) (map[string]any, error) {
	actor := offboardingActor(query)
	if err := validateOffboardingIdentity(actor, "actor"); err != nil {
		return nil, offboardingForbidden()
	}
	admin := peopleRuntimeAdmin(query)
	expected, err := parseOffboardingObjectVersion(cleanBodyString(body, "expectedVersion"))
	if err != nil {
		return nil, err
	}
	reason := strings.TrimSpace(cleanBodyString(body, "reason"))
	if action == "cancel" && (reason == "" || len([]rune(reason)) > 500) {
		return nil, httperror.New(http.StatusBadRequest, "offboarding_cancellation_reason_invalid", "reason is required and must not exceed 500 characters")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	task, caseRecord, err := lockOffboardingTaskAndCase(ctx, tx, taskCode)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "offboarding_task_not_found", "offboarding task was not found")
	}
	if err != nil {
		return nil, err
	}
	if action == "confirm" && !admin && task.ResponsibleUID != actor {
		return nil, offboardingForbidden()
	}
	targetStatus := "completed"
	if action == "cancel" {
		targetStatus = "cancelled"
	}
	if task.Status == targetStatus && task.ObjectVersion == expected+1 {
		if action == "cancel" && (!task.CancellationReason.Valid || task.CancellationReason.String != reason) {
			return nil, httperror.New(http.StatusConflict, "offboarding_version_conflict", "the cancellation replay payload conflicts with the committed task transition")
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"task": offboardingTaskResponse(*task), "case": offboardingCaseResponse(*caseRecord), "idempotent": true}, nil
	}
	if task.Status != "pending" || caseRecord.Status != "active" || task.ObjectVersion != expected {
		return nil, httperror.New(http.StatusConflict, "offboarding_version_conflict", "offboarding task state or object version is stale")
	}
	if action == "confirm" {
		_, err = tx.ExecContext(ctx, `UPDATE people_offboarding_tasks
			SET status='completed',object_version=object_version+1,completed_at=UTC_TIMESTAMP(),completed_by=?,updated_by=?
			WHERE id=? AND status='pending' AND object_version=?`, actor, actor, task.ID, expected)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE people_offboarding_tasks
			SET status='cancelled',object_version=object_version+1,cancelled_at=UTC_TIMESTAMP(),cancelled_by=?,cancellation_reason=?,updated_by=?
			WHERE id=? AND status='pending' AND object_version=?`, actor, reason, actor, task.ID, expected)
	}
	if err != nil {
		return nil, err
	}
	var pendingCount, cancelledCount int
	if err := tx.QueryRowContext(ctx, `SELECT SUM(status='pending'),SUM(status='cancelled') FROM people_offboarding_tasks WHERE case_code=?`, caseRecord.CaseCode).Scan(&pendingCount, &cancelledCount); err != nil {
		return nil, err
	}
	if pendingCount == 0 && cancelledCount == 0 {
		_, err = tx.ExecContext(ctx, `UPDATE people_offboarding_cases SET status='completed',object_version=object_version+1,
			completed_at=UTC_TIMESTAMP(),completed_by=?,updated_by=? WHERE id=? AND status='active'`, actor, actor, caseRecord.ID)
	} else if pendingCount == 0 {
		_, err = tx.ExecContext(ctx, `UPDATE people_offboarding_cases SET status='cancelled',object_version=object_version+1,
			cancelled_at=UTC_TIMESTAMP(),cancelled_by=?,cancellation_reason=?,updated_by=? WHERE id=? AND status='active'`, actor, reasonOrCoordinationCancellation(reason), actor, caseRecord.ID)
	} else {
		_, err = tx.ExecContext(ctx, `UPDATE people_offboarding_cases SET object_version=object_version+1,updated_by=? WHERE id=? AND status='active'`, actor, caseRecord.ID)
	}
	if err != nil {
		return nil, err
	}
	updatedCase, err := queryOffboardingCaseTx(ctx, tx, `WHERE case_code=? LIMIT 1`, caseRecord.CaseCode)
	if err != nil {
		return nil, err
	}
	updatedTasks, err := queryOffboardingTasksTx(ctx, tx, caseRecord.CaseCode, false)
	if err != nil {
		return nil, err
	}
	var updatedTask offboardingTaskRecord
	for _, candidate := range updatedTasks {
		if candidate.TaskCode == taskCode {
			updatedTask = candidate
			break
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"task": offboardingTaskResponse(updatedTask), "case": offboardingCaseResponse(*updatedCase), "idempotent": false}, nil
}

func lockOffboardingTaskAndCase(ctx context.Context, tx *sql.Tx, taskCode string) (*offboardingTaskRecord, *offboardingCaseRecord, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT t.id,t.task_code,t.case_code,t.task_type,t.responsible_uid,t.due_at,t.status,t.object_version,
		       t.completed_at,t.completed_by,t.cancelled_at,t.cancelled_by,t.cancellation_reason,t.created_at,t.updated_at,
		       c.id,c.case_code,c.leave_assignment_code,c.employee_uid,c.status,c.object_version,
		       c.completed_at,c.completed_by,c.cancelled_at,c.cancelled_by,c.cancellation_reason,c.created_at,c.updated_at
		FROM people_offboarding_tasks t JOIN people_offboarding_cases c ON c.case_code=t.case_code
		WHERE t.task_code=? LIMIT 1 FOR UPDATE`, taskCode)
	task := &offboardingTaskRecord{}
	caseRecord := &offboardingCaseRecord{}
	err := row.Scan(&task.ID, &task.TaskCode, &task.CaseCode, &task.TaskType, &task.ResponsibleUID, &task.DueAt, &task.Status, &task.ObjectVersion,
		&task.CompletedAt, &task.CompletedBy, &task.CancelledAt, &task.CancelledBy, &task.CancellationReason, &task.CreatedAt, &task.UpdatedAt,
		&caseRecord.ID, &caseRecord.CaseCode, &caseRecord.LeaveAssignmentCode, &caseRecord.EmployeeUID, &caseRecord.Status, &caseRecord.ObjectVersion,
		&caseRecord.CompletedAt, &caseRecord.CompletedBy, &caseRecord.CancelledAt, &caseRecord.CancelledBy, &caseRecord.CancellationReason, &caseRecord.CreatedAt, &caseRecord.UpdatedAt)
	return task, caseRecord, err
}

func queryOffboardingCaseTx(ctx context.Context, tx *sql.Tx, suffix string, args ...any) (*offboardingCaseRecord, error) {
	row := tx.QueryRowContext(ctx, `SELECT id,case_code,leave_assignment_code,employee_uid,status,object_version,
		completed_at,completed_by,cancelled_at,cancelled_by,cancellation_reason,created_at,updated_at
		FROM people_offboarding_cases `+suffix, args...)
	item, err := scanOffboardingCaseRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return item, err
}

type rowScanner interface{ Scan(...any) error }

func scanOffboardingCaseRow(row rowScanner) (*offboardingCaseRecord, error) {
	item := &offboardingCaseRecord{}
	err := row.Scan(&item.ID, &item.CaseCode, &item.LeaveAssignmentCode, &item.EmployeeUID, &item.Status, &item.ObjectVersion,
		&item.CompletedAt, &item.CompletedBy, &item.CancelledAt, &item.CancelledBy, &item.CancellationReason, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func scanOffboardingCases(rows *sql.Rows) ([]offboardingCaseRecord, error) {
	defer rows.Close()
	result := make([]offboardingCaseRecord, 0)
	for rows.Next() {
		item, err := scanOffboardingCaseRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *item)
	}
	return result, rows.Err()
}

func queryOffboardingTasksTx(ctx context.Context, tx *sql.Tx, caseCode string, lock bool) ([]offboardingTaskRecord, error) {
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,task_code,case_code,task_type,responsible_uid,due_at,status,object_version,
		completed_at,completed_by,cancelled_at,cancelled_by,cancellation_reason,created_at,updated_at
		FROM people_offboarding_tasks WHERE case_code=? ORDER BY id ASC`+suffix, caseCode)
	if err != nil {
		return nil, err
	}
	return scanOffboardingTasks(rows)
}

func queryOffboardingTasksDB(ctx context.Context, db *sql.DB, caseCode string) ([]offboardingTaskRecord, error) {
	rows, err := db.QueryContext(ctx, `SELECT id,task_code,case_code,task_type,responsible_uid,due_at,status,object_version,
		completed_at,completed_by,cancelled_at,cancelled_by,cancellation_reason,created_at,updated_at
		FROM people_offboarding_tasks WHERE case_code=? ORDER BY id ASC`, caseCode)
	if err != nil {
		return nil, err
	}
	return scanOffboardingTasks(rows)
}

func scanOffboardingTasks(rows *sql.Rows) ([]offboardingTaskRecord, error) {
	defer rows.Close()
	result := make([]offboardingTaskRecord, 0)
	for rows.Next() {
		item := offboardingTaskRecord{}
		if err := rows.Scan(&item.ID, &item.TaskCode, &item.CaseCode, &item.TaskType, &item.ResponsibleUID, &item.DueAt, &item.Status, &item.ObjectVersion,
			&item.CompletedAt, &item.CompletedBy, &item.CancelledAt, &item.CancelledBy, &item.CancellationReason, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func offboardingCaseAggregate(item offboardingCaseRecord, tasks []offboardingTaskRecord, idempotent bool) map[string]any {
	return map[string]any{"case": offboardingCaseResponse(item), "tasks": offboardingTaskResponses(tasks), "idempotent": idempotent}
}

func offboardingCaseResponse(item offboardingCaseRecord) map[string]any {
	return map[string]any{
		"caseCode": item.CaseCode, "leaveAssignmentCode": item.LeaveAssignmentCode, "employeeUid": item.EmployeeUID,
		"status": item.Status, "objectVersion": fmt.Sprintf("v%d", item.ObjectVersion),
		"createdAt": item.CreatedAt.UTC().Format(time.RFC3339), "updatedAt": item.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func offboardingTaskResponses(tasks []offboardingTaskRecord) []map[string]any {
	result := make([]map[string]any, 0, len(tasks))
	for _, item := range tasks {
		result = append(result, offboardingTaskResponse(item))
	}
	return result
}

func offboardingTaskResponse(item offboardingTaskRecord) map[string]any {
	return map[string]any{
		"taskCode": item.TaskCode, "caseCode": item.CaseCode, "taskType": item.TaskType,
		"responsibleUid": item.ResponsibleUID, "dueAt": item.DueAt.UTC().Format(time.RFC3339), "status": item.Status,
		"objectVersion": fmt.Sprintf("v%d", item.ObjectVersion), "completedAt": nullTimeRFC3339(item.CompletedAt),
		"completedBy": nullStringValue(item.CompletedBy), "cancelledAt": nullTimeRFC3339(item.CancelledAt),
		"cancelledBy": nullStringValue(item.CancelledBy), "cancellationReason": nullStringValue(item.CancellationReason),
		"createdAt": item.CreatedAt.UTC().Format(time.RFC3339), "updatedAt": item.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

func nullTimeRFC3339(value sql.NullTime) any {
	if !value.Valid {
		return nil
	}
	return value.Time.UTC().Format(time.RFC3339)
}

func nullStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}

func offboardingCreateMatches(item offboardingCaseRecord, tasks []offboardingTaskRecord, input offboardingCreateInput, employeeUID string) bool {
	if item.CaseCode != input.CaseCode || item.LeaveAssignmentCode != input.LeaveAssignmentCode || item.EmployeeUID != employeeUID || len(tasks) != len(offboardingTaskInputs(input)) {
		return false
	}
	expected := map[string]offboardingTaskInput{offboardingTaskHandover: input.Handover}
	if input.AssetRecovery != nil {
		expected[offboardingTaskAssetRecovery] = *input.AssetRecovery
	}
	for _, task := range tasks {
		want, ok := expected[task.TaskType]
		if !ok || want.ResponsibleUID != task.ResponsibleUID || !want.DueAt.Equal(task.DueAt.UTC()) || task.TaskCode != stableOffboardingTaskCode(item.CaseCode, task.TaskType) {
			return false
		}
	}
	return true
}

func offboardingTaskInputs(input offboardingCreateInput) []struct {
	taskType string
	input    offboardingTaskInput
} {
	result := []struct {
		taskType string
		input    offboardingTaskInput
	}{{offboardingTaskHandover, input.Handover}}
	if input.AssetRecovery != nil {
		result = append(result, struct {
			taskType string
			input    offboardingTaskInput
		}{offboardingTaskAssetRecovery, *input.AssetRecovery})
	}
	return result
}

func stableOffboardingCaseCode(assignmentCode string) string {
	return "OBC-" + strings.ToUpper(offboardingHash(assignmentCode)[:20])
}

func stableOffboardingTaskCode(caseCode, taskType string) string {
	suffix := "H"
	if taskType == offboardingTaskAssetRecovery {
		suffix = "A"
	}
	return "OBT-" + strings.ToUpper(offboardingHash(caseCode)[:20]) + "-" + suffix
}

func offboardingHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func validateOffboardingCode(value, field string) error {
	if value == "" || len(value) > 64 || strings.EqualFold(value, "@all") || hasControlRune(value) || strings.ContainsAny(value, "/\\") {
		return httperror.New(http.StatusBadRequest, "offboarding_request_invalid", field+" is invalid")
	}
	return nil
}

func offboardingDuplicateKey(err error) bool {
	var mysqlError *mysql.MySQLError
	return errors.As(err, &mysqlError) && mysqlError.Number == 1062
}

func validateOffboardingIdentity(value, field string) error {
	if err := validateOffboardingCode(value, field); err != nil {
		return err
	}
	if strings.TrimSpace(value) != value {
		return httperror.New(http.StatusBadRequest, "offboarding_request_invalid", field+" is invalid")
	}
	return nil
}

func hasControlRune(value string) bool {
	for _, r := range value {
		if unicode.IsControl(r) {
			return true
		}
	}
	return false
}

func peopleRuntimeHasScope(query url.Values, required string) bool {
	for _, scope := range strings.FieldsFunc(query.Get("current_user_scopes"), func(r rune) bool { return unicode.IsSpace(r) || r == ',' || r == ';' }) {
		if scope == required {
			return true
		}
	}
	return false
}

func peopleRuntimeAdmin(query url.Values) bool {
	return peopleRuntimeHasScope(query, "people:offboarding_tasks:admin")
}

func offboardingActor(query url.Values) string {
	return strings.TrimSpace(query.Get("current_user"))
}

func offboardingForbidden() error {
	return httperror.New(http.StatusForbidden, "offboarding_access_denied", "only the current responsible user or People runtime administrator may access this offboarding object")
}

func parseOffboardingObjectVersion(value string) (int64, error) {
	if !strings.HasPrefix(value, "v") {
		return 0, httperror.New(http.StatusBadRequest, "offboarding_expected_version_invalid", "expectedVersion must use vN format")
	}
	parsed, err := strconv.ParseInt(strings.TrimPrefix(value, "v"), 10, 64)
	if err != nil || parsed <= 0 || fmt.Sprintf("v%d", parsed) != value {
		return 0, httperror.New(http.StatusBadRequest, "offboarding_expected_version_invalid", "expectedVersion must use vN format")
	}
	return parsed, nil
}

func parseOffboardingListLimit(value string) (int, error) {
	if value == "" {
		return 50, nil
	}
	if value != strings.TrimSpace(value) {
		return 0, httperror.New(http.StatusBadRequest, "offboarding_limit_invalid", "limit must be an integer between 1 and 100")
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed < 1 || parsed > 100 || strconv.Itoa(parsed) != value {
		return 0, httperror.New(http.StatusBadRequest, "offboarding_limit_invalid", "limit must be an integer between 1 and 100")
	}
	return parsed, nil
}

func reasonOrCoordinationCancellation(reason string) string {
	if reason != "" {
		return reason
	}
	return "one or more offboarding coordination tasks were cancelled"
}

func encodeOffboardingListCursor(updatedAt time.Time, id int64) (string, error) {
	payload, err := json.Marshal(offboardingListCursor{UpdatedAt: updatedAt.UTC().Format(time.RFC3339), ID: id})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeOffboardingListCursor(value string) (*offboardingListCursor, error) {
	if strings.TrimSpace(value) == "" {
		return nil, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return nil, err
	}
	var cursor offboardingListCursor
	if err := json.Unmarshal(payload, &cursor); err != nil || cursor.ID <= 0 {
		return nil, fmt.Errorf("invalid cursor")
	}
	if _, err := time.Parse(time.RFC3339, cursor.UpdatedAt); err != nil {
		return nil, err
	}
	return &cursor, nil
}
