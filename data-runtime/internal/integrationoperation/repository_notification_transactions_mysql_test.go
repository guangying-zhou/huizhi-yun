package integrationoperation

import (
	"context"
	"database/sql"
	"testing"
)

// Invoked by the actual mapped-outbox MySQL fixture, never by a mock adapter.
func assertSharedNotificationRollback(t *testing.T, db *sql.DB, query, id string, mutation func(*sql.Tx) error) {
	t.Helper()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if err = mutation(tx); err != nil {
		t.Fatal(err)
	}
	var visible int
	if err = db.QueryRow(query, id).Scan(&visible); err != nil || visible != 0 {
		t.Fatal("shared method committed early", visible, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(query, id).Scan(&visible); err != nil || visible != 0 {
		t.Fatal("notification mark survived rollback", visible, err)
	}
}
