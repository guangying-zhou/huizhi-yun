package directory

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestLDAPSyncPreservesExistingNonLDAPNamesAndOwnership(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT position_title,primary_dept_code,user_type,display_name,real_name,source_provider FROM directory_users`).
		WithArgs("zhangsan").
		WillReturnRows(sqlmock.NewRows([]string{
			"position_title", "primary_dept_code", "user_type", "display_name", "real_name", "source_provider",
		}).AddRow("研发工程师", "RD", "employee", "张三", "张三", "people"))
	mock.ExpectExec(`(?s)INSERT INTO directory_users.*ON DUPLICATE KEY UPDATE.*display_name=CASE.*email=CASE.*position_title=CASE.*primary_dept_code=CASE.*source_provider=CASE`).
		WithArgs(
			"zhangsan", "zhangsan", "张三", "张三", "zhangsan@example.com", nil, nil, "研发工程师",
			"RD", "employee", "ldap:user:ldap-1", sqlmock.AnyArg(), "active",
		).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`(?s)INSERT INTO directory_identities`).
		WithArgs(
			"zhangsan", "ldap-1", "zhangsan", "uid=zhangsan,ou=People,dc=example,dc=com",
			"zhangsan@example.com", nil, sqlmock.AnyArg(), "active",
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	_, err = (&Adapter{db: db}).applyUser(context.Background(), map[string]any{
		"uid":        "zhangsan",
		"dn":         "uid=zhangsan,ou=People,dc=example,dc=com",
		"externalId": "ldap-1",
		"cn":         "zhangsan",
		"sn":         "zhang",
		"mail":       "zhangsan@example.com",
		"status":     "active",
	}, nil)
	if err != nil {
		t.Fatalf("applyUser: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
