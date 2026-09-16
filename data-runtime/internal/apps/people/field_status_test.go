package people

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func summaryFor(summary []map[string]any, field string) map[string]any {
	for _, row := range summary {
		if row["field"] == field {
			return row
		}
	}
	return nil
}

func TestFieldStatusSeparatesAbsentFromEmptyAndInvalid(t *testing.T) {
	counter := newDirectoryFieldStatusCounter()

	// provider 完全没有下发该字段：权限缺失时钉钉就是这个形态。
	counter.observe("mobile", map[string]any{"name": "Alice"}, "", []string{"mobile"})
	// provider 下发了该字段，但值为空：这是一次明确的“该员工没有手机号”。
	counter.observe("mobile", map[string]any{"mobile": ""}, "", []string{"mobile"})
	counter.observe("mobile", map[string]any{"mobile": "13800000000"}, "13800000000", []string{"mobile"})

	mobile := summaryFor(counter.summary(), "mobile")
	if mobile == nil {
		t.Fatal("mobile summary missing")
	}
	if mobile["absent"] != 1 || mobile["empty"] != 1 || mobile["provided"] != 1 {
		t.Fatalf("mobile summary=%#v", mobile)
	}
	if mobile["observed"] != 3 || mobile["missingAll"] != false {
		t.Fatalf("mobile summary=%#v", mobile)
	}

	// 日期下发了但格式无法识别，必须与“没下发”区分开。
	counter.observeDate("onboard_date", map[string]any{"onboardDate": "1.7040672e"}, "1.7040672e", "", []string{"onboardDate"})
	onboard := summaryFor(counter.summary(), "onboard_date")
	if onboard["invalid"] != 1 || onboard["absent"] != 0 || onboard["missingAll"] != true {
		t.Fatalf("onboard summary=%#v", onboard)
	}
}

func TestFieldStatusFlagsWholeBatchMissingField(t *testing.T) {
	counter := newDirectoryFieldStatusCounter()
	for range 3 {
		counter.observeDate("onboard_date", map[string]any{"name": "Alice"}, "", "", []string{"onboardDate"})
	}
	onboard := summaryFor(counter.summary(), "onboard_date")
	if onboard["absent"] != 3 || onboard["missingAll"] != true {
		t.Fatalf("onboard summary=%#v", onboard)
	}
}

func TestSourceFieldWriteSemanticsPreserveAbsentButApplyExplicitEmpty(t *testing.T) {
	if sourceTextFieldWritable(map[string]any{"name": "Alice"}, []string{"mobile"}) {
		t.Fatal("an absent mobile must preserve the existing value")
	}
	if !sourceTextFieldWritable(map[string]any{"mobile": ""}, []string{"mobile"}) {
		t.Fatal("an explicitly empty mobile must clear the source-owned value")
	}
	if !sourceDateFieldWritable(map[string]any{"onboardDate": ""}, "", "", []string{"onboardDate"}) {
		t.Fatal("an explicitly empty source date must be applied")
	}
	if sourceDateFieldWritable(map[string]any{"onboardDate": "not-a-date"}, "not-a-date", "", []string{"onboardDate"}) {
		t.Fatal("an invalid source date must not erase a valid existing date")
	}
}

func TestDingTalkEmploymentSyncReportsFieldStatusAndBindsMobile(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_no FROM people_employees WHERE employee_uid=\? FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_no"}).AddRow("007"))
	mock.ExpectExec(`(?s)INSERT INTO people_employees.*mobile = CASE WHEN \? THEN VALUES\(mobile\) ELSE people_employees\.mobile END.*onboard_date = CASE WHEN \? THEN VALUES\(onboard_date\).*onboard_date_source = CASE WHEN \? THEN 'dingtalk'`).
		WithArgs(
			"u1", "007", "Alice", sqlmock.AnyArg(), sqlmock.AnyArg(),
			"13800000000", "active", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			"2025-03-04", "2025-03-04", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			true, true, true,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT assignment_code,change_type,COALESCE\(source_app,''\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"assignment_code", "change_type", "source_app"}))
	mock.ExpectExec(`INSERT INTO people_assignments`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`(?s)UPDATE people_assignments a.*SET a\.effective_from = e\.onboard_date`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := adapter.syncDirectoryUsers(context.Background(), map[string]any{
		"source_app": "connector-runtime", "source_biz_type": "dingtalk_hr_employee",
		"effective_from": "2026-07-23", "items": []any{map[string]any{
			"employee_uid": "u1", "employee_no": "DINGTALK-MUST-BE-IGNORED", "display_name": "Alice",
			"dept_code": "D1", "employment_status": "active",
			"onboard_date": "2025-03-04", "mobile": "13800000000", "source_biz_id": "ding-u1",
		}},
	})
	if err != nil {
		t.Fatalf("err=%v", err)
	}

	summary, ok := result["field_status"].([]map[string]any)
	if !ok {
		t.Fatalf("field_status=%#v", result["field_status"])
	}
	if got := summaryFor(summary, "mobile"); got == nil || got["provided"] != 1 {
		t.Fatalf("mobile status=%#v", got)
	}
	if got := summaryFor(summary, "onboard_date"); got == nil || got["provided"] != 1 {
		t.Fatalf("onboard_date status=%#v", got)
	}
	// 钉钉没有下发邮箱，这必须表现为 absent 而不是被静默吞掉。
	if got := summaryFor(summary, "email"); got == nil || got["absent"] != 1 || got["missingAll"] != true {
		t.Fatalf("email status=%#v", got)
	}
	if got := summaryFor(summary, "employee_no"); got != nil {
		t.Fatalf("DingTalk work number must not be observed as a People source field: %#v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestManualOnboardDateSourceIsMarkedOnlyForEmployeeWritesCarryingTheDate(t *testing.T) {
	body := map[string]any{"onboard_date": "2026-09-01", "display_name": "Alice"}
	markManualOnboardDateSource("PATCH", "/v1/people/employees/u1", body)
	if body["onboard_date_source"] != "manual" {
		t.Fatalf("body=%#v", body)
	}

	// 不带入职日期的普通编辑不得改变来源标记，否则一次改姓名就会
	// 让该员工此后永久脱离钉钉同步。
	untouched := map[string]any{"display_name": "Alice"}
	markManualOnboardDateSource("PATCH", "/v1/people/employees/u1", untouched)
	if _, ok := untouched["onboard_date_source"]; ok {
		t.Fatalf("body=%#v", untouched)
	}

	// 只读路径和其他资源不受影响。
	profile := map[string]any{"onboard_date": "2026-09-01"}
	markManualOnboardDateSource("PATCH", "/v1/people/employees/u1/profile", profile)
	if _, ok := profile["onboard_date_source"]; ok {
		t.Fatalf("body=%#v", profile)
	}

	assignment := map[string]any{"onboard_date": "2026-09-01"}
	markManualOnboardDateSource("PATCH", "/v1/people/assignments/a1", assignment)
	if _, ok := assignment["onboard_date_source"]; ok {
		t.Fatalf("body=%#v", assignment)
	}
}

func TestClientCannotForgeOnboardDateSource(t *testing.T) {
	if err := rejectClientOnboardDateSource(map[string]any{"onboard_date_source": "manual"}); err == nil {
		t.Fatal("client-provided source must be rejected")
	}
	if err := rejectClientOnboardDateSource(map[string]any{"onboard_date": "2026-09-01"}); err != nil {
		t.Fatalf("a date without a forged source should be accepted: %v", err)
	}
}
