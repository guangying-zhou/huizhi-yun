package people

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestMissingOnboardingProfileFieldsIsStableAndComplete(t *testing.T) {
	missing := missingOnboardingProfileFields(map[string]string{})
	if len(missing) != len(onboardingRequiredProfileFields) {
		t.Fatalf("missing=%v", missing)
	}
	for i := 1; i < len(missing); i++ {
		if missing[i-1] > missing[i] {
			t.Fatalf("missing fields must be stably sorted for UI and contract assertions: %v", missing)
		}
	}

	// 入职日期缺失也必须拦下：以空日期完成入职会让任职事实从第一天就是错的。
	complete := map[string]string{
		"dept_code": "RD", "position_code": "engineer",
		"rank_code": "P5", "canonical_uid": "liukai", "corporate_email": "liukai@example.com",
	}
	if got := missingOnboardingProfileFields(complete); len(got) != 1 || got[0] != "planned_onboard_date" {
		t.Fatalf("missing=%v", got)
	}
	complete["planned_onboard_date"] = "2026-09-10"
	if got := missingOnboardingProfileFields(complete); len(got) != 0 {
		t.Fatalf("missing=%v", got)
	}

	// 只有空白的字段等同于缺失，不能靠空格蒙混过关。
	complete["dept_code"] = "   "
	if got := missingOnboardingProfileFields(complete); len(got) != 1 || got[0] != "dept_code" {
		t.Fatalf("missing=%v", got)
	}
}

func TestOnboardingProfileAssignsEmployeeNumberAutomatically(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id,onboarding_code,status,object_version`).
		WithArgs("ONB-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "onboarding_code", "status", "object_version", "employee_no", "dept_code",
			"position_code", "rank_code", "canonical_uid", "corporate_email",
			"planned_onboard_date", "manager_uid", "employment_type",
		}).AddRow(1, "ONB-1", "awaiting_profile", 1, nil, nil, nil, nil, nil, nil, nil, nil, "full_time"))
	mock.ExpectQuery(`SELECT next_value FROM people_employee_number_sequences`).
		WithArgs(employeeNumberSequenceCode).
		WillReturnRows(sqlmock.NewRows([]string{"next_value"}).AddRow(0))
	mock.ExpectQuery(`SELECT EXISTS.*people_employees.*EXISTS.*people_onboarding_cases`).
		WithArgs("000", "000").
		WillReturnRows(sqlmock.NewRows([]string{"employee_exists", "onboarding_exists"}).AddRow(0, 0))
	mock.ExpectExec(`UPDATE people_employee_number_sequences SET next_value=\?`).
		WithArgs(int64(1), employeeNumberSequenceCode).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE people_onboarding_cases SET`).
		WithArgs("000", "RD", "engineer", "P5", "liukai", "liukai@example.com",
			"2026-09-10", "", "full_time", "ready_for_provisioning", "hr001", int64(1), int64(1)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.UpdateOnboardingProfile(context.Background(), "ONB-1", map[string]any{
		"object_version": 1, "submit": true,
		"dept_code": "RD", "position_code": "engineer", "rank_code": "P5",
		"canonical_uid": "liukai", "corporate_email": "liukai@example.com",
		"planned_onboard_date": "2026-09-10",
	}, "hr001")
	if err != nil || result["readyToProvision"] != true {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOnboardingEditIsBlockedWhileProvisioningIsInFlight(t *testing.T) {
	// 开通在途时改资料会让已冻结的 command 与入职单事实不一致。
	for _, status := range []string{"reserving_identity", "provisioning_account", "activating_employee", "projecting_authorization", "completed", "cancelled"} {
		if onboardingEditableStatuses[status] {
			t.Fatalf("status %q must not be editable", status)
		}
	}
	// 异常状态必须可编辑，否则 HR 无法修正后重试。
	for _, status := range []string{"awaiting_profile", "profile_conflict", "identity_conflict", "reservation_expired", "provisioning_failed"} {
		if !onboardingEditableStatuses[status] {
			t.Fatalf("status %q must be editable so HR can recover", status)
		}
	}
}

func TestOnboardingProfileUpdateRequiresVersionAndActorBeforeTouchingTheDatabase(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	if _, err := adapter.UpdateOnboardingProfile(context.Background(), "ONB-1", map[string]any{}, "hr001"); err == nil ||
		!strings.Contains(err.Error(), "object version") {
		t.Fatalf("err=%v", err)
	}
	if _, err := adapter.UpdateOnboardingProfile(context.Background(), "ONB-1",
		map[string]any{"object_version": 1}, ""); err == nil {
		t.Fatal("an unverified actor must be rejected")
	}
	if _, err := adapter.UpdateOnboardingProfile(context.Background(), "",
		map[string]any{"object_version": 1}, "hr001"); err == nil {
		t.Fatal("an empty onboarding code must be rejected")
	}
	// 以上都必须在开事务之前失败。
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
