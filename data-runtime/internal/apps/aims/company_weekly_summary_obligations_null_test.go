package aims

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// An obligation whose project has no reviewed weekly report comes back from the
// LEFT JOIN with NULL version columns. Publishing must classify it as missing
// instead of failing with a scan error (hzy0 W40 publish returned 500).
func TestLoadCompanySummaryObligationsAllowsMissingReviewedVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("FROM weekly_report_obligations").WithArgs(int64(1)).WillReturnRows(sqlmock.NewRows([]string{
		"id", "project_id", "project_code", "name", "responsible_uid_snapshot", "due_status", "late_flag",
		"report_id", "current_reviewed_version_id", "selected_rag", "manager_content_json", "fact_snapshot_json",
		"submitted_by", "submitted_at",
	}).
		AddRow(3, 1, "PRJ-A", "项目A", "pm1", "submitted", 0, 5, 7, "green", []byte(`{"summary":"ok"}`), []byte(`{}`), "pm1", nil).
		AddRow(4, 2, "PRJ-B", "项目B", "pm2", "missing", 1, nil, nil, nil, nil, nil, nil, nil))
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	items, err := loadCompanySummaryObligationsTx(context.Background(), tx, 1, []int64{3})
	if err != nil {
		t.Fatalf("load obligations: %v", err)
	}
	if len(items) != 2 || items[0].InclusionStatus != "included" || items[1].InclusionStatus != "missing" {
		t.Fatalf("unexpected classification: %+v", items)
	}
	if string(items[0].ManagerContent) != `{"summary":"ok"}` || items[1].ManagerContent != nil || items[1].FactSnapshot != nil {
		t.Fatalf("unexpected JSON columns: %q %q", items[0].ManagerContent, items[1].ManagerContent)
	}
}
