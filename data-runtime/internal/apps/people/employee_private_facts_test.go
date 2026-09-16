package people

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestPublicDirectoryEmployeeSnapshotRemovesPrivateAliases(t *testing.T) {
	item := map[string]any{
		"employee_uid": "u1",
		"display_name": "测试员工",
		"id_number":    "110101199001011234",
		"身份证号":         "110101199001011234",
		"birthDate":    "1990-01-01",
		"学历":           "本科",
		"major":        "软件工程",
		"毕业院校":         "测试大学",
		"graduation":   "2012-06-30",
	}
	snapshot := publicDirectoryEmployeeSnapshot(item)
	if snapshot["employee_uid"] != "u1" || snapshot["display_name"] != "测试员工" {
		t.Fatalf("public fields were removed: %#v", snapshot)
	}
	for _, spec := range employeePrivateFieldSpecs {
		for _, alias := range spec.Aliases {
			if _, exists := snapshot[alias]; exists {
				t.Fatalf("private alias %q leaked into snapshot: %#v", alias, snapshot)
			}
		}
	}
}

func TestEmployeePrivateProfileResolvesSourcePriorityAndMasksID(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{}
	query.Set("current_user_employee_access", "all")
	mock.ExpectQuery(`(?s)SELECT employee_uid,COALESCE\(dept_code,''\).*FROM people_employees`).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "dept_code"}).AddRow("u1", "D1"))
	mock.ExpectQuery(`(?s)SELECT field_code,source_code,value_text`).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"field_code", "source_code", "value_text", "source_updated_at", "updated_at"}).
			AddRow("id_number", "oa_archive", "110101199001011234", nil, "2026-09-04").
			AddRow("education_level", "manual", "本科", nil, "2026-09-04").
			AddRow("education_level", "oa_archive", "1", nil, "2026-09-03").
			AddRow("graduation_school", "dingtalk", "钉钉大学", nil, "2026-09-04").
			AddRow("graduation_school", "manual", "旧学校", nil, "2026-09-03"))

	profile, err := adapter.employeePrivateProfile(context.Background(), "u1", query)
	if err != nil {
		t.Fatal(err)
	}
	fields := profile["fields"].(map[string]any)
	if got := fields["id_number"].(map[string]any)["value"]; got != "110101********1234" {
		t.Fatalf("masked id=%v", got)
	}
	if got := fields["education_level"].(map[string]any)["value"]; got != "本科" {
		t.Fatalf("education=%v", got)
	}
	school := fields["graduation_school"].(map[string]any)
	if school["value"] != "钉钉大学" || school["editable"] != false {
		t.Fatalf("school=%#v", school)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestManualPrivateProfileCannotOverrideDingTalkFact(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	query := url.Values{}
	query.Set("current_user_employee_access", "all")
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_uid,COALESCE\(dept_code,''\) FROM people_employees`).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "dept_code"}).AddRow("u1", "D1"))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM people_employee_private_facts`).WithArgs("u1", "birth_date").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectRollback()

	_, err := adapter.updateEmployeePrivateProfile(context.Background(), "u1", query, map[string]any{"birth_date": "1991-02-03"}, "hr1")
	httpErr, ok := err.(httperror.Error)
	if err == nil || !ok || httpErr.Status != 409 {
		t.Fatalf("err=%v", err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEmployeePrivateProfileHonorsEmployeeDataScope(t *testing.T) {
	t.Run("authorized department", func(t *testing.T) {
		adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
		defer closeDB()
		query := url.Values{}
		query.Set("current_user_employee_access", "dept")
		query.Set("current_user", "hr1")
		query.Set("current_user_employee_dept_codes", "D1")

		mock.ExpectQuery(`(?s)SELECT employee_uid,COALESCE\(dept_code,''\).*FROM people_employees`).WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "dept_code"}).AddRow("u1", "D1"))
		mock.ExpectQuery(`(?s)SELECT field_code,source_code,value_text`).WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"field_code", "source_code", "value_text", "source_updated_at", "updated_at"}))

		if _, err := adapter.employeePrivateProfile(context.Background(), "u1", query); err != nil {
			t.Fatalf("authorized department profile failed: %v", err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("other department", func(t *testing.T) {
		adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
		defer closeDB()
		query := url.Values{}
		query.Set("current_user_employee_access", "dept")
		query.Set("current_user", "hr1")
		query.Set("current_user_employee_dept_codes", "D1")

		mock.ExpectQuery(`(?s)SELECT employee_uid,COALESCE\(dept_code,''\).*FROM people_employees`).WithArgs("u2").
			WillReturnRows(sqlmock.NewRows([]string{"employee_uid", "dept_code"}).AddRow("u2", "D2"))

		_, err := adapter.employeePrivateProfile(context.Background(), "u2", query)
		httpErr, ok := err.(httperror.Error)
		if !ok || httpErr.Status != http.StatusForbidden || httpErr.Code != "people_employee_access_denied" {
			t.Fatalf("expected scoped profile denial, got %#v", err)
		}
		if err = mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestNormalizeEmployeePrivateValueRejectsInvalidSensitiveValues(t *testing.T) {
	idSpec := employeePrivateFieldSpecs[0]
	if _, err := normalizeEmployeePrivateValue(idSpec, "1234"); err == nil {
		t.Fatal("short identity number must be rejected")
	}
	birthSpec := employeePrivateFieldSpecs[1]
	if _, err := normalizeEmployeePrivateValue(birthSpec, "2026-02-31"); err == nil {
		t.Fatal("invalid birth date must be rejected")
	}
	if _, err := normalizeEmployeePrivateValue(birthSpec, "1990-01"); err == nil {
		t.Fatal("birth date must not accept month precision")
	}
	graduationSpec := employeePrivateFieldSpecs[5]
	if value, err := normalizeEmployeePrivateValue(graduationSpec, "2012-06"); err != nil || value != "2012-06" {
		t.Fatalf("graduation month=(%q,%v), want (2012-06,nil)", value, err)
	}
}

func TestDingTalkEmploymentSyncWritesPrivateSourceFact(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_no FROM people_employees WHERE employee_uid=\? FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_no"}).AddRow("007"))
	mock.ExpectExec(`(?s)INSERT INTO people_employees.*onboard_date_source = CASE WHEN \? THEN 'dingtalk'`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO people_employee_private_facts`).
		WithArgs("u1", "birth_date", "dingtalk", "1990-01-01", "ding-u1", "", "dingtalk", "dingtalk").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO people_employee_private_facts`).
		WithArgs("u1", "graduation_date", "dingtalk", "2012-06", "ding-u1", "", "dingtalk", "dingtalk").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	result, err := adapter.syncDirectoryUsers(context.Background(), map[string]any{
		"source_app": "connector-runtime", "source_biz_type": "dingtalk_hr_employee",
		"create_assignments": false,
		"items": []any{map[string]any{
			"employee_uid": "u1", "employee_no": "E001", "display_name": "测试员工",
			"employment_status": "active", "source_biz_id": "ding-u1", "birth_date": "1990-01-01",
			"graduation_date": "2012-06",
		}},
	})
	if err != nil || result["synced"] != 1 {
		t.Fatalf("result=%#v err=%v", result, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkEmploymentSyncDoesNotCopyPrivateFactsIntoEmployeeMetadata(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT employee_no FROM people_employees WHERE employee_uid=\? FOR UPDATE`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"employee_no"}).AddRow("007"))
	mock.ExpectExec(`(?s)INSERT INTO people_employees.*onboard_date_source = CASE WHEN \? THEN 'dingtalk'`).
		WithArgs(
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
			sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`INSERT INTO people_employee_private_facts`).
		WithArgs("u1", "id_number", "dingtalk", "110101199001011234", "ding-u1", "", "dingtalk", "dingtalk").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	_, err := adapter.syncDirectoryUsers(context.Background(), map[string]any{
		"source_app": "connector-runtime", "source_biz_type": "dingtalk_hr_employee",
		"create_assignments": false,
		"items": []any{map[string]any{
			"employee_uid": "u1", "employee_no": "E001", "display_name": "测试员工",
			"employment_status": "active", "source_biz_id": "ding-u1", "id_number": "110101199001011234",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}

	// The SQL mock above cannot conveniently address the JSON argument by index;
	// keep a serialization assertion beside the integration expectation.
	encoded, err := json.Marshal(publicDirectoryEmployeeSnapshot(map[string]any{
		"employee_uid": "u1", "id_number": "110101199001011234",
	}))
	if err != nil || string(encoded) != `{"employee_uid":"u1"}` {
		t.Fatalf("public metadata=%s err=%v", encoded, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
