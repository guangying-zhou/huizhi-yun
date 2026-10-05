package people

import (
	"context"
	"net/http"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func peopleProjectionBody(asOf string) map[string]any {
	return map[string]any{
		"asOf":                asOf,
		"current_user_scopes": []string{"people:integration_operation:execute"},
		integrationoperation.TrustedTenantCodeKey:      "tenant-1",
		integrationoperation.TrustedDeploymentCodeKey:  "people-deployment",
		integrationoperation.TrustedSourceAppKey:       "people",
		integrationoperation.TrustedServiceClientIDKey: "people.runtime",
		integrationoperation.TrustedRequestIDKey:       "request-1",
	}
}

func TestEffectiveOffboardingQueryRequiresApprovedOrApprovalFreeAndFixedAsOf(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)approval_status IN \('none','approved'\).*effective_from<=\?.*ORDER BY a.effective_from DESC,a.id DESC.*approval_status IN \('none','approved'\).*effective_from<=\?.*approval_status IN \('none','approved'\).*effective_from<=\?.*latest_change_type='leave'`).
		WithArgs(asOf, asOf, asOf, 101).
		WillReturnRows(sqlmock.NewRows([]string{"employee_id", "employee_uid", "display_name", "employment_status", "assignment_code", "effective_date"}).
			AddRow(1, "left-1", "Left User", "active", "ASN-LEAVE-1", time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)))
	facts, err := adapter.queryEffectiveOffboardingFacts(context.Background(), asOf, nil, 101)
	if err != nil || len(facts) != 1 || facts[0].AssignmentCode != "ASN-LEAVE-1" {
		t.Fatalf("facts=%#v err=%v", facts, err)
	}
}

func TestFutureOrUnapprovedLeaveProducesNoProjectionFact(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)approval_status IN \('none','approved'\).*effective_from<=\?`).
		WithArgs(asOf, asOf, asOf, 101).
		WillReturnRows(sqlmock.NewRows([]string{"employee_id", "employee_uid", "display_name", "employment_status", "assignment_code", "effective_date"}))
	facts, err := adapter.queryEffectiveOffboardingFacts(context.Background(), asOf, nil, 101)
	if err != nil || len(facts) != 0 {
		t.Fatalf("future/pending facts=%#v err=%v", facts, err)
	}
}

func TestLatestEffectiveOnboardSuppressesHistoricalApprovedLeave(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	// The latest-assignment subqueries intentionally consider every effective
	// change type. A historical leave cannot win after a later onboard/transfer.
	mock.ExpectQuery(`(?s)SELECT a.change_type FROM people_assignments a\s+WHERE a.employee_uid=e.employee_uid AND a.approval_status IN \('none','approved'\).*ORDER BY a.effective_from DESC,a.id DESC.*fact.latest_change_type='leave'`).
		WithArgs(asOf, asOf, asOf, 101).
		WillReturnRows(sqlmock.NewRows([]string{"employee_id", "employee_uid", "display_name", "employment_status", "assignment_code", "effective_date"}))
	facts, err := adapter.queryEffectiveOffboardingFacts(context.Background(), asOf, nil, 101)
	if err != nil || len(facts) != 0 {
		t.Fatalf("rehired employee projected from historical leave: facts=%#v err=%v", facts, err)
	}
}

func TestPeopleAssetsOffboardingCursorIsStableAndRejectsInvalid(t *testing.T) {
	fact := peopleAssetsOffboardingFact{EmployeeID: 42, EffectiveDate: time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)}
	encoded, err := encodePeopleAssetsOffboardingCursor(fact)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodePeopleAssetsOffboardingCursor(encoded)
	if err != nil || decoded.EmployeeID != 42 || decoded.EffectiveDate != "2026-07-10" {
		t.Fatalf("decoded=%#v err=%v", decoded, err)
	}
	if _, err := decodePeopleAssetsOffboardingCursor("not-a-cursor"); err == nil {
		t.Fatal("invalid cursor accepted")
	}
}

func TestPeopleAssetsOffboardingCommandUsesStableCommittedEvidence(t *testing.T) {
	fact := peopleAssetsOffboardingFact{EmployeeUID: "u-1", Status: "active", AssignmentCode: "ASN-1", EffectiveDate: time.Date(2026, 7, 10, 8, 0, 0, 0, time.UTC)}
	command, eventKey := peopleAssetsOffboardingCommand(fact)
	if eventKey != "people:leave:ASN-1:effective:2026-07-10" || command["offboardedAt"] != "2026-07-10T00:00:00Z" {
		t.Fatalf("command=%#v eventKey=%q", command, eventKey)
	}
	if _, copied := command["departedEmployeeName"]; copied {
		t.Fatal("mutable display name must not participate in lifecycle projection identity")
	}
}

func TestPreparePeopleAssetsOffboardingProjectionIsIdempotent(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	asOf := "2026-07-10T12:00:00Z"
	effective := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	factRows := func() *sqlmock.Rows {
		return sqlmock.NewRows([]string{"employee_id", "employee_uid", "display_name", "employment_status", "assignment_code", "effective_date"}).AddRow(1, "left-1", "Left User", "left", "ASN-LEAVE-1", effective)
	}
	command, _ := peopleAssetsOffboardingCommand(peopleAssetsOffboardingFact{EmployeeUID: "left-1", Status: "left", AssignmentCode: "ASN-LEAVE-1", EffectiveDate: effective})
	commandSHA, _ := integrationoperation.ValidateAndDigestCommand(command)
	for _, inserted := range []int64{1, 0} {
		mock.ExpectQuery(`(?s)approval_status IN \('none','approved'\).*FROM people_employees e`).WillReturnRows(factRows())
		mock.ExpectBegin()
		mock.ExpectExec(regexp.QuoteMeta("INSERT IGNORE INTO integration_operation")).WillReturnResult(sqlmock.NewResult(1, inserted))
		mock.ExpectQuery(`SELECT command_sha256 FROM integration_operation`).WithArgs("tenant-1", "people-deployment", sqlmock.AnyArg()).WillReturnRows(sqlmock.NewRows([]string{"command_sha256"}).AddRow(commandSHA))
		mock.ExpectCommit()
		result, err := adapter.prepareAssetsOffboardingProjections(context.Background(), peopleProjectionBody(asOf))
		if err != nil || result["created"] != int(inserted) {
			t.Fatalf("inserted=%d result=%#v err=%v", inserted, result, err)
		}
	}
}

func TestPreparePeopleAssetsOffboardingProjectionRejectsWrongScopeOrSource(t *testing.T) {
	adapter, _, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	for _, mutate := range []func(map[string]any){
		func(body map[string]any) { body["current_user_scopes"] = []string{"people.write"} },
		func(body map[string]any) { body[integrationoperation.TrustedSourceAppKey] = "console" },
		func(body map[string]any) { body[integrationoperation.TrustedTenantCodeKey] = "" },
		func(body map[string]any) { body[integrationoperation.TrustedDeploymentCodeKey] = "other deployment" },
	} {
		body := peopleProjectionBody("2026-07-10T12:00:00Z")
		mutate(body)
		_, err := adapter.prepareAssetsOffboardingProjections(context.Background(), body)
		if err == nil {
			t.Fatal("invalid source or scope accepted")
		}
		if typed, ok := err.(*httperror.Error); ok && typed.Status != http.StatusForbidden {
			t.Fatalf("unexpected status: %#v", typed)
		}
	}
}

func TestPreparePeopleAssetsOffboardingProjectionRejectsExistingDifferentPayload(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	effective := time.Date(2026, 7, 10, 0, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`(?s)FROM people_employees e`).WillReturnRows(sqlmock.NewRows([]string{"employee_id", "employee_uid", "display_name", "employment_status", "assignment_code", "effective_date"}).AddRow(1, "left-1", "Left User", "left", "ASN-1", effective))
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("INSERT IGNORE INTO integration_operation")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT command_sha256 FROM integration_operation`).WillReturnRows(sqlmock.NewRows([]string{"command_sha256"}).AddRow("different"))
	mock.ExpectRollback()
	_, err := adapter.prepareAssetsOffboardingProjections(context.Background(), peopleProjectionBody("2026-07-10T12:00:00Z"))
	if err == nil {
		t.Fatal("same operation identity with different command was accepted")
	}
}
