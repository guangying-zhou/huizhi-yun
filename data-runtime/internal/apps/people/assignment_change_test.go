package people

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func assignmentChangeTestBody() map[string]any {
	body := peopleProjectionBody("2026-07-23T12:00:00Z")
	body["employee_uid"] = "u1"
	body["change_type"] = "leave"
	body["effective_from"] = "2026-06-30"
	body["dept_code"] = "D1"
	body["dept_name"] = "Software"
	body["source_biz_id"] = "u1-change-1"
	body["remarks"] = "离职"
	return body
}

func assignmentChangeTestQuery() url.Values {
	return url.Values{
		"current_user":                      []string{"operator-1"},
		"current_user_employee_access":      []string{"all"},
		"current_user_standard_cost_access": []string{"all"},
	}
}

func TestAssignmentChangeOnlySupersedesDirectoryBootstrap(t *testing.T) {
	if !assignmentIsDirectoryBootstrap(futureAssignmentChangeConflict{
		AssignmentCode: "ASN-DIR-ZHAOJING",
		ChangeType:     "onboard",
		SourceApp:      "console",
		SourceBizType:  "directory_user",
	}) {
		t.Fatal("directory bootstrap assignment must be supersedable by an authoritative backdated HR change")
	}
	if assignmentIsDirectoryBootstrap(futureAssignmentChangeConflict{
		AssignmentCode: "ASN-PLANNED",
		ChangeType:     "transfer",
		SourceApp:      "people",
		SourceBizType:  "manual_assignment_adjustment",
	}) {
		t.Fatal("ordinary planned assignment must retain future conflict protection")
	}
}

func TestAssignmentChangeAtomicallyClosesOldAssignmentAndFreezesOffboarding(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "rank_code", "rank_name"}).AddRow("u1", "P5", "专业 P5"))
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*source_biz_id=\?.*FOR UPDATE`).
		WithArgs("u1", peopleAssignmentChangeSourceApp, peopleAssignmentChangeSourceBizType, "u1-change-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*effective_from>=\?.*FOR UPDATE`).
		WithArgs("u1", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "change_type", "source_app", "source_biz_type"}).
			AddRow("ASN-DIR-ZHAOJING", "onboard", "console", "directory_user"))
	mock.ExpectExec(`(?s)UPDATE people_assignments.*approval_status='cancelled'.*assignment_code=\?`).
		WithArgs("operator-1", "ASN-DIR-ZHAOJING").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT assignment_code.*FROM people_assignments.*effective_from<\?.*effective_to>=\?.*FOR UPDATE`).
		WithArgs("u1", "2026-06-30", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code"}).AddRow("ASN-DIR-U1"))
	mock.ExpectExec(`(?s)UPDATE people_assignments.*effective_to=\?.*assignment_code=\?`).
		WithArgs("2026-06-29", "operator-1", "ASN-DIR-U1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO people_assignments`).
		WillReturnResult(sqlmock.NewResult(2, 1))
	mock.ExpectExec(`(?s)UPDATE people_employees.*employment_status=IF.*leave_date=IF`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"employee_uid", "employee_no", "login_name", "display_name", "dept_code",
			"position_code", "position_name", "employment_status", "leave_date",
			"identity_subject", "email", "email_state", "mobile", "mobile_state",
		}).AddRow("u1", "E001", "alice", "Alice", "D1", "", "", "left", "2026-06-30", "", "", "absent", "", "absent"))
	mock.ExpectQuery(`(?s)FROM people_assignments.*effective_from<=\?.*ORDER BY effective_from DESC,id DESC.*FOR UPDATE`).
		WithArgs("u1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"assignment_code", "dept_code", "position_code", "position_name", "change_type", "effective_from",
		}).AddRow("ASN-LEAVE-U1", "D1", "", "", "leave", "2026-06-30"))
	mock.ExpectQuery(`SELECT revision_no,snapshot_hash,operation_key FROM people_directory_lifecycle_versions`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"revision_no", "snapshot_hash", "operation_key"}))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO integration_operation (")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO people_directory_lifecycle_versions`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	response, operation, err := adapter.HandleRuntime(
		context.Background(),
		http.MethodPost,
		peopleAssignmentChangePath,
		assignmentChangeTestQuery(),
		assignmentChangeTestBody(),
	)
	if err != nil {
		t.Fatalf("HandleRuntime: %v", err)
	}
	if operation != "people.assignments.change" {
		t.Fatalf("operation = %q", operation)
	}
	envelope, ok := response.(map[string]any)
	if !ok {
		t.Fatalf("response = %#v", response)
	}
	data, ok := envelope["data"].(map[string]any)
	if !ok || data["change_type"] != "leave" || data["rank_code"] != "P5" {
		t.Fatalf("data = %#v", envelope["data"])
	}
	closed, ok := data["closed_assignment_codes"].([]string)
	if !ok || len(closed) != 1 || closed[0] != "ASN-DIR-U1" {
		t.Fatalf("closed assignments = %#v", data["closed_assignment_codes"])
	}
	superseded, ok := data["superseded_assignment_codes"].([]string)
	if !ok || len(superseded) != 1 || superseded[0] != "ASN-DIR-ZHAOJING" {
		t.Fatalf("superseded assignments = %#v", data["superseded_assignment_codes"])
	}
	lifecycle, ok := data["directoryLifecycle"].(map[string]any)
	if !ok || lifecycle["operationStatus"] != "pending" {
		t.Fatalf("directory lifecycle = %#v", data["directoryLifecycle"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAssignmentChangeRollsBackOldAssignmentClosureWhenInsertFails(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "rank_code", "rank_name"}).AddRow("u1", nil, nil))
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*source_biz_id=\?.*FOR UPDATE`).
		WithArgs("u1", peopleAssignmentChangeSourceApp, peopleAssignmentChangeSourceBizType, "u1-change-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*effective_from>=\?.*FOR UPDATE`).
		WithArgs("u1", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "change_type", "source_app", "source_biz_type"}))
	mock.ExpectQuery(`(?s)SELECT assignment_code.*FROM people_assignments.*effective_from<\?.*effective_to>=\?.*FOR UPDATE`).
		WithArgs("u1", "2026-06-30", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code"}).AddRow("ASN-DIR-U1"))
	mock.ExpectExec(`(?s)UPDATE people_assignments.*effective_to=\?.*assignment_code=\?`).
		WithArgs("2026-06-29", "operator-1", "ASN-DIR-U1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO people_assignments`).
		WillReturnError(errors.New("insert failed"))
	mock.ExpectRollback()

	input, err := parseAssignmentChangeInput(assignmentChangeTestBody())
	if err != nil {
		t.Fatal(err)
	}
	trusted := integrationoperation.TrustedContext{
		TenantCode:      "tenant-1",
		DeploymentCode:  "people-deployment",
		SourceApp:       "people",
		ServiceClientID: "people.runtime",
		RequestID:       "request-1",
	}
	if _, err := adapter.changePrimaryAssignment(context.Background(), input, trusted, "operator-1", "operator-1"); err == nil {
		t.Fatal("expected assignment insert failure")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("old assignment closure must roll back with the failed insert: %v", err)
	}
}

func TestRankChangeRejectsUnknownOrDisabledRank(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	body := assignmentChangeTestBody()
	body["change_type"] = "rank_change"
	body["rank_code"] = "P99"
	body["rank_name"] = "Spoofed"
	body["monthly_standard_cost"] = 1000
	input, err := parseAssignmentChangeInput(body)
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "rank_code", "rank_name"}).AddRow("u1", "P5", "专业 P5"))
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*source_biz_id=\?.*FOR UPDATE`).
		WithArgs("u1", peopleAssignmentChangeSourceApp, peopleAssignmentChangeSourceBizType, "u1-change-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`(?s)SELECT rank_code,rank_name.*FROM people_ranks.*rank_code=\?.*enabled=1`).
		WithArgs("P99").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	trusted := integrationoperation.TrustedContext{
		TenantCode:      "tenant-1",
		DeploymentCode:  "people-deployment",
		SourceApp:       "people",
		ServiceClientID: "people.runtime",
		RequestID:       "request-1",
	}
	_, err = adapter.changePrimaryAssignment(context.Background(), input, trusted, "operator-1", "operator-1")
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusBadRequest || httpErr.Code != "people_assignment_rank_unavailable" {
		t.Fatalf("expected unavailable rank bad request, got %#v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRankChangeUsesEnabledDictionaryCanonicalName(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	body := assignmentChangeTestBody()
	body["change_type"] = "rank_change"
	body["rank_code"] = "p6"
	body["rank_name"] = "Spoofed"
	body["monthly_standard_cost"] = 1000

	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "rank_code", "rank_name"}).AddRow("u1", "P5", "专业 P5"))
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*source_biz_id=\?.*FOR UPDATE`).
		WithArgs("u1", peopleAssignmentChangeSourceApp, peopleAssignmentChangeSourceBizType, "u1-change-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`(?s)SELECT rank_code,rank_name.*FROM people_ranks.*rank_code=\?.*enabled=1`).
		WithArgs("p6").
		WillReturnRows(sqlmock.NewRows([]string{"rank_code", "rank_name"}).AddRow("P6", "专业 P6"))
	mock.ExpectQuery(`(?s)SELECT assignment_code,change_type.*FROM people_assignments.*effective_from>=\?.*FOR UPDATE`).
		WithArgs("u1", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "change_type", "source_app", "source_biz_type"}))
	mock.ExpectQuery(`(?s)SELECT assignment_code.*FROM people_assignments.*effective_from<\?.*effective_to>=\?.*FOR UPDATE`).
		WithArgs("u1", "2026-06-30", "2026-06-30").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code"}))
	mock.ExpectExec(`(?s)INSERT INTO people_assignments`).
		WithArgs(
			sqlmock.AnyArg(), "u1", "rank_change", "2026-06-30",
			"D1", "Software", nil, nil, "P6", "专业 P6", nil,
			peopleAssignmentChangeSourceApp, peopleAssignmentChangeSourceBizType, "u1-change-1", "离职",
			"operator-1", "operator-1",
		).
		WillReturnResult(sqlmock.NewResult(2, 1))
	mock.ExpectExec(`(?s)UPDATE people_employees.*rank_name=\?.*monthly_standard_cost=\?`).
		WithArgs("D1", "Software", nil, nil, "P6", "专业 P6", nil, "", "", nil, nil, float64(1000), "operator-1", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`(?s)SELECT employee_uid.*FROM people_employees.*FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"employee_uid", "employee_no", "login_name", "display_name", "dept_code",
			"position_code", "position_name", "employment_status", "leave_date",
			"identity_subject", "email", "email_state", "mobile", "mobile_state",
		}).AddRow("u1", "E001", "alice", "Alice", "D1", "", "", "active", nil, "", "", "absent", "", "absent"))
	mock.ExpectQuery(`(?s)FROM people_assignments.*effective_from<=\?.*ORDER BY effective_from DESC,id DESC.*FOR UPDATE`).
		WithArgs("u1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"assignment_code", "dept_code", "position_code", "position_name", "change_type", "effective_from",
		}).AddRow("ASN-RANK-U1", "D1", "", "", "rank_change", "2026-06-30"))
	mock.ExpectQuery(`SELECT revision_no,snapshot_hash,operation_key FROM people_directory_lifecycle_versions`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"revision_no", "snapshot_hash", "operation_key"}))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO integration_operation (")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO people_directory_lifecycle_versions`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	response, _, err := adapter.HandleRuntime(context.Background(), http.MethodPost, peopleAssignmentChangePath, assignmentChangeTestQuery(), body)
	if err != nil {
		t.Fatal(err)
	}
	data := response.(map[string]any)["data"].(map[string]any)
	if data["rank_name"] != "专业 P6" {
		t.Fatalf("response must use canonical dictionary name: %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRankChangeIdempotencyUsesStoredCanonicalRankName(t *testing.T) {
	stored := storedAssignmentChange{
		ChangeType:    "rank_change",
		EffectiveFrom: "2026-08-29",
		RankCode:      "P6",
		RankName:      "专业 P6",
	}
	input := assignmentChangeInput{
		ChangeType:    "rank_change",
		EffectiveFrom: "2026-08-29",
		RankCode:      "p6",
		RankName:      "spoofed or omitted on retry",
	}

	canonical := canonicalizeIdempotentAssignmentInput(stored, input)
	if canonical.RankCode != "p6" || canonical.RankName != "专业 P6" || !storedAssignmentChangeMatches(stored, canonical) {
		t.Fatalf("rank retry must reuse stored canonical name: %#v", canonical)
	}
	canonical.RankCode = "P7"
	if storedAssignmentChangeMatches(stored, canonical) {
		t.Fatal("reusing a source_biz_id for a different rank code must conflict")
	}
}
