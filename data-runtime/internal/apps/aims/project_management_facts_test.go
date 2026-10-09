package aims

import (
	"context"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestProjectManagementFactsReturnsVersionedTraceableRows(t *testing.T) {
	adapter, mock, closeDB := newAimsSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectQuery(`(?s)FROM project_management_fact_snapshots fact.*INNER JOIN weekly_reporting_periods period.*fact\.revision > \?.*period\.week_end >= \?.*period\.week_start <= \?.*fact\.project_code IN \(\?\).*ORDER BY fact\.revision.*LIMIT \?`).
		WithArgs(uint64(4), "2026-07-01", "2026-07-31", "PRJ-1", uint64(3)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "revision", "fact_code", "period_key", "subject_uid", "project_id", "project_code",
			"value_json", "source_refs_json", "source_sha256", "correction_of_id", "created_at",
		}).AddRow(
			uint64(10), uint64(5), "project_weekly_governance", "2026-W30", "pm-1", int64(1), "PRJ-1",
			[]byte(`{"late":false}`), []byte(`{"projectWeeklyReportVersionId":21}`), "abc", nil, "2026-07-25T12:00:00.000000Z",
		))

	result, err := adapter.projectManagementFacts(context.Background(), url.Values{
		"periodStart":   {"2026-07-01"},
		"periodEnd":     {"2026-07-31"},
		"projectCodes":  {"PRJ-1"},
		"afterRevision": {"4"},
		"limit":         {"2"},
	})
	if err != nil {
		t.Fatal(err)
	}
	items := result["items"].([]map[string]any)
	if len(items) != 1 || items[0]["revision"] != uint64(5) || items[0]["sourceSha256"] != "abc" {
		t.Fatalf("unexpected management facts: %#v", result)
	}
	if result["nextRevision"] != uint64(5) || result["hasMore"] != false {
		t.Fatalf("unexpected cursor: %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
