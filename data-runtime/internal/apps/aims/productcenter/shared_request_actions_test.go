package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestSharedEditProductRequestEarlyFailureRollsBack(t *testing.T) {
	for _, action := range []string{"wrong", "product_requests:edit"} {
		t.Run(action, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			_, err = EditProductRequestInTransaction(context.Background(), tx, CommandIdentity{Action: action}, AuthorizationPermit{}, RequestEdit{})
			if err == nil {
				t.Fatal("invalid action accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failed action left shared transaction committable", err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSharedDecideProductRequestEarlyFailureRollsBack(t *testing.T) {
	for _, action := range []string{"wrong", "product_requests:decide"} {
		t.Run(action, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			_, err = DecideProductRequestInTransaction(context.Background(), tx, CommandIdentity{Action: action}, AuthorizationPermit{}, RequestDecision{})
			if err == nil {
				t.Fatal("invalid action accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failed action left shared transaction committable", err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSharedAddManualRequestSourceEarlyFailureRollsBack(t *testing.T) {
	for _, action := range []string{"wrong", "product_requests:source-create"} {
		t.Run(action, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			_, err = AddManualRequestSourceInTransaction(context.Background(), tx, CommandIdentity{Action: action}, AuthorizationPermit{}, ManualRequestSource{})
			if err == nil {
				t.Fatal("invalid action accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failed action left shared transaction committable", err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSharedDeleteManualRequestSourceEarlyFailureRollsBack(t *testing.T) {
	for _, action := range []string{"wrong", "product_requests:source-delete"} {
		t.Run(action, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectRollback()
			_, err = DeleteManualRequestSourceInTransaction(context.Background(), tx, CommandIdentity{Action: action}, AuthorizationPermit{}, RequestSourceDelete{})
			if err == nil {
				t.Fatal("invalid action accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failed action left shared transaction committable", err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
