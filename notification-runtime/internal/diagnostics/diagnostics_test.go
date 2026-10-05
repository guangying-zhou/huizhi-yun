package diagnostics

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestCollectReturnsOnlyAggregateOperationMetrics(t *testing.T) {
	path := filepath.Join(t.TempDir(), "operations.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`
CREATE TABLE notification_delivery_ledger (status TEXT NOT NULL);
INSERT INTO notification_delivery_ledger(status) VALUES ('succeeded'),('failed');
CREATE TABLE connector_people_sync_jobs (status TEXT NOT NULL);
INSERT INTO connector_people_sync_jobs(status) VALUES ('success'),('success');`)
	if err != nil {
		t.Fatal(err)
	}
	_ = db.Close()

	snapshot, err := Collect(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Deliveries["succeeded"] != 1 || snapshot.Deliveries["failed"] != 1 || snapshot.PeopleJobs["success"] != 2 {
		t.Fatalf("unexpected snapshot: %#v", snapshot)
	}
}
