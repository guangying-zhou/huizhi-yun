package integrationoperation

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"regexp"
	"testing"
	"time"
)

func TestSharedRepositoryValidationAbortsCallerTransaction(t *testing.T) {
	cases := map[string]func(*Repository, *sql.Tx) error{
		"claim": func(r *Repository, tx *sql.Tx) error {
			_, err := r.ClaimNextInTransaction(context.Background(), tx, "", "", "", "", time.Time{}, 0)
			return err
		},
		"claim-key": func(r *Repository, tx *sql.Tx) error {
			_, err := r.ClaimByOperationKeyInTransaction(context.Background(), tx, "", "", "", "bad key", "", time.Time{}, 0)
			return err
		},
		"success": func(r *Repository, tx *sql.Tx) error {
			_, err := r.RecordSuccessWithMutationInTransaction(context.Background(), tx, RecordSuccessInput{}, nil)
			return err
		},
		"failure": func(r *Repository, tx *sql.Tx) error {
			_, err := r.RecordFailureInTransaction(context.Background(), tx, RecordFailureInput{})
			return err
		},
	}
	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			r, err := NewRepository(db)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectBegin()
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			if err = call(r, tx); err == nil {
				t.Fatal("invalid input accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failure left shared transaction committable", err)
			}
			if err = call(r, nil); err == nil {
				t.Fatal("nil transaction accepted")
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSharedEmptyClaimLeavesCommitToCaller(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r, err := NewRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 9, 13, 12, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec(regexp.QuoteMeta(recoverExpiredLeaseAttemptsSQL)).WithArgs(now, now, "TENANT-A", "DEPLOYMENT-A", "aims", now).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta(recoverExpiredLeasesSQL)).WithArgs(now, "worker-a", now, "TENANT-A", "DEPLOYMENT-A", "aims", now).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(claimNextSQL)).WithArgs("TENANT-A", "DEPLOYMENT-A", "aims", now).WillReturnRows(sqlmock.NewRows([]string{"operation_id"}))
	out, err := r.ClaimNextInTransaction(context.Background(), tx, "TENANT-A", "DEPLOYMENT-A", "aims", "worker-a", now, time.Minute)
	if err != nil || out != nil {
		t.Fatal("empty claim failed", err)
	}
	// A follow-up statement must still run under the caller's generation lock.
	mock.ExpectExec("SELECT 1").WillReturnResult(sqlmock.NewResult(0, 0))
	if _, err = tx.ExecContext(context.Background(), "SELECT 1"); err != nil {
		t.Fatal("claim closed caller transaction", err)
	}
	mock.ExpectCommit()
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
