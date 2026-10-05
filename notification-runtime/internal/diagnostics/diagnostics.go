package diagnostics

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

type Snapshot struct {
	CollectedAt   string         `json:"collectedAt"`
	DatabaseBytes int64          `json:"databaseBytes"`
	Deliveries    map[string]int `json:"deliveries"`
	PeopleJobs    map[string]int `json:"peopleJobs"`
}

func Collect(ctx context.Context, path string) (Snapshot, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return Snapshot{}, err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return Snapshot{}, err
	}
	dsn := (&url.URL{Scheme: "file", Path: filepath.ToSlash(absolute)}).String() + "?mode=ro&_pragma=busy_timeout(2000)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return Snapshot{}, err
	}
	defer db.Close()
	snapshot := Snapshot{
		CollectedAt:   time.Now().UTC().Format(time.RFC3339Nano),
		DatabaseBytes: info.Size(),
		Deliveries:    map[string]int{},
		PeopleJobs:    map[string]int{},
	}
	if err := collectStatuses(ctx, db, "notification_delivery_ledger", snapshot.Deliveries); err != nil {
		return Snapshot{}, fmt.Errorf("collect delivery metrics: %w", err)
	}
	if err := collectStatuses(ctx, db, "connector_people_sync_jobs", snapshot.PeopleJobs); err != nil {
		return Snapshot{}, fmt.Errorf("collect People job metrics: %w", err)
	}
	return snapshot, nil
}

func collectStatuses(ctx context.Context, db *sql.DB, table string, target map[string]int) error {
	rows, err := db.QueryContext(ctx, `SELECT status,COUNT(*) FROM `+table+` GROUP BY status`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return err
		}
		target[status] = count
	}
	return rows.Err()
}
