package productcenter

import (
	"context"
	"database/sql"
	"errors"
	"github.com/DATA-DOG/go-sqlmock"
	"testing"
)

func TestSharedRequestMergeEarlyFailureRollsBack(t *testing.T) {
	for _, action := range []string{"wrong", "product_requests:merge"} {
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
			_, err = MergeProductRequestInTransaction(context.Background(), tx, CommandIdentity{Action: action}, AuthorizationPermit{}, RequestMerge{})
			if err == nil {
				t.Fatal("invalid merge accepted")
			}
			if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
				t.Fatal("failed merge left shared transaction committable", err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
