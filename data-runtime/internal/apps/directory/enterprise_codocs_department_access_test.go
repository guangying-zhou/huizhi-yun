package directory

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestEnterpriseCodocsDepartmentAccessTxLocksAndRechecksManager(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)FROM directory_departments.*dept_code=\?.*FOR SHARE`).WithArgs("D1").
		WillReturnRows(sqlmock.NewRows([]string{"leader_uid", "manager_uid", "parent_dept_code"}).AddRow(nil, "actor", nil))
	mock.ExpectQuery(`(?s)FROM directory_users.*BINARY uid=BINARY \?.*FOR SHARE`).WithArgs("actor").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("active"))
	mock.ExpectQuery(`(?s)FROM directory_user_departments.*BINARY uid=BINARY \?.*FOR SHARE`).WithArgs("actor", "D1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	role, err := (&Adapter{db: db}).EnterpriseCodocsDepartmentAccessTx(context.Background(), tx, "actor", "D1")
	if err != nil || role != CodocsDepartmentManager {
		t.Fatalf("role=%s err=%v", role, err)
	}
	tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseCodocsDepartmentRolePriorityAndDirectParent(t *testing.T) {
	cases := []struct {
		name, leader, manager, parentLeader, parentManager string
		member                                             bool
		want                                               EnterpriseCodocsDepartmentRole
	}{
		{"leader_before_manager", "actor", "actor", "", "", true, CodocsDepartmentLeader},
		{"manager_before_member", "", "actor", "", "", true, CodocsDepartmentManager},
		{"member_before_parent", "", "", "actor", "actor", true, CodocsDepartmentMember},
		{"direct_parent_manager", "", "", "", "actor", false, CodocsDepartmentParent},
		{"direct_parent_leader", "", "", "actor", "", false, CodocsDepartmentParent},
		{"uid_case_is_significant", "Actor", "ACTOR", "", "", false, CodocsDepartmentNone},
		{"unrelated", "", "", "", "", false, CodocsDepartmentNone},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			role := chooseEnterpriseCodocsDepartmentRole("actor", tc.leader, tc.manager, tc.parentLeader, tc.parentManager, tc.member)
			if role != tc.want {
				t.Fatalf("role=%s want=%s", role, tc.want)
			}
		})
	}
	if CodocsDepartmentLeader.CanWrite() || CodocsDepartmentParent.CanWrite() || CodocsDepartmentMember.CanManage() || !CodocsDepartmentManager.CanManage() {
		t.Fatal("department role permissions changed")
	}
}

func TestEnterpriseCodocsDepartmentAccessReadsCurrentDirectoryFacts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`(?s)SELECT d\.leader_uid,d\.manager_uid,parent\.leader_uid,parent\.manager_uid.*parent\.org_type='department'`).
		WithArgs("D1").WillReturnRows(sqlmock.NewRows([]string{"leader_uid", "manager_uid", "parent_leader_uid", "parent_manager_uid"}).AddRow(nil, "actor", nil, nil))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY u\.uid=BINARY \?`).WithArgs("actor").WillReturnRows(sqlmock.NewRows([]string{"active"}).AddRow(true))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY ud\.uid=BINARY \?`).WithArgs("actor", "D1").WillReturnRows(sqlmock.NewRows([]string{"member"}).AddRow(false))
	role, err := (&Adapter{db: db}).EnterpriseCodocsDepartmentAccess(context.Background(), "actor", "D1")
	if err != nil || role != CodocsDepartmentManager {
		t.Fatalf("role=%s err=%v", role, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseCodocsDepartmentAccessFailsClosedOnMembershipError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT d\.leader_uid,d\.manager_uid,parent\.leader_uid,parent\.manager_uid`).
		WithArgs("D1").WillReturnRows(sqlmock.NewRows([]string{"leader_uid", "manager_uid", "parent_leader_uid", "parent_manager_uid"}).AddRow("actor", nil, nil, nil))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY u\.uid=BINARY \?`).WithArgs("actor").WillReturnRows(sqlmock.NewRows([]string{"active"}).AddRow(true))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY ud\.uid=BINARY \?`).WithArgs("actor", "D1").WillReturnError(errors.New("directory unavailable"))
	if _, err := (&Adapter{db: db}).EnterpriseCodocsDepartmentAccess(context.Background(), "actor", "D1"); err == nil {
		t.Fatal("leader role must not mask Directory failure")
	}
}

func TestEnterpriseCodocsDepartmentAccessInactiveActorIsNone(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(`SELECT d\.leader_uid,d\.manager_uid,parent\.leader_uid,parent\.manager_uid`).
		WithArgs("D1").WillReturnRows(sqlmock.NewRows([]string{"leader_uid", "manager_uid", "parent_leader_uid", "parent_manager_uid"}).AddRow("actor", "actor", nil, nil))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY u\.uid=BINARY \?`).WithArgs("actor").WillReturnRows(sqlmock.NewRows([]string{"active"}).AddRow(false))
	role, err := (&Adapter{db: db}).EnterpriseCodocsDepartmentAccess(context.Background(), "actor", "D1")
	if err != nil || role != CodocsDepartmentNone {
		t.Fatalf("role=%s err=%v", role, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseCodocsDepartmentAccessNonDepartmentParentIsIgnored(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// The joined parent columns are null when the immediate parent is a
	// committee. The SQL predicate must not promote its leader or manager.
	mock.ExpectQuery(`(?s)LEFT JOIN directory_departments parent.*parent\.org_type='department'`).
		WithArgs("D1").WillReturnRows(sqlmock.NewRows([]string{"leader_uid", "manager_uid", "parent_leader_uid", "parent_manager_uid"}).AddRow(nil, nil, nil, nil))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY u\.uid=BINARY \?`).WithArgs("actor").WillReturnRows(sqlmock.NewRows([]string{"active"}).AddRow(true))
	mock.ExpectQuery(`(?s)SELECT EXISTS\(.*BINARY ud\.uid=BINARY \?`).WithArgs("actor", "D1").WillReturnRows(sqlmock.NewRows([]string{"member"}).AddRow(false))
	role, err := (&Adapter{db: db}).EnterpriseCodocsDepartmentAccess(context.Background(), "actor", "D1")
	if err != nil || role != CodocsDepartmentNone {
		t.Fatalf("role=%s err=%v", role, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
