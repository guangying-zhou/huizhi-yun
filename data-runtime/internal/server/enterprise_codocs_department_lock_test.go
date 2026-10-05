package server

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestEnterpriseCodocsDepartmentLockFailsClosedOnDirectoryFailure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin().WillReturnError(errors.New("directory offline"))
	s := &Server{directory: directoryapp.NewWithDB(db, "C000001", "", "")}
	_, release, err := s.lockEnterpriseCodocsDepartment(context.Background(), "manager", "D1")
	if release != nil {
		t.Fatal("unexpected Directory lease")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != 503 || httpErr.Code != "department_directory_unavailable" {
		t.Fatalf("err=%v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterpriseCodocsDepartmentLockRejectsCallbackBindingChange(t *testing.T) {
	for _, input := range [][2]string{{"other", "D1"}, {"manager", "D2"}} {
		if err := checkLockedEnterpriseCodocsDepartment(input[0], input[1], "manager", "D1", directoryapp.CodocsDepartmentManager); err == nil {
			t.Fatalf("binding accepted: %v", input)
		}
	}
}
