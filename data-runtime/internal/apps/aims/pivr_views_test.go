package aims

import (
	"context"
	"math"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestServiceLineHistoryAggregatesVisibleServiceYears(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT p\.id, p\.project_code, p\.name, p\.lifecycle_status,.*FROM aims_projects p.*p\.service_line_code = \?.*ORDER BY p\.service_period_seq ASC`).
		WithArgs("CUS-OPS", "gavin", "gavin", "gavin", "gavin").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "project_code", "name", "lifecycle_status", "service_line_code", "service_period_seq",
			"service_period_start", "service_period_end", "service_period_label", "total_work_items",
			"completed_work_items", "total_hours", "sla_ticket_count", "sla_met_count",
		}).
			AddRow(101, "CUS-OPS-2025", "客户运营 2025", "completed", "CUS-OPS", 1, "2025-01-01", "2025-12-31", "2025", 10, 9, 100.5, 5, 5).
			AddRow(102, "CUS-OPS-2026", "客户运营 2026", "active", "CUS-OPS", 2, "2026-01-01", "2026-12-31", "2026", 20, 18, 200.0, 10, 9))

	result, err := adapter.serviceLineHistory(context.Background(), "CUS-OPS", url.Values{"current_user": {"gavin"}})
	if err != nil {
		t.Fatalf("serviceLineHistory: %v", err)
	}
	items, ok := result["items"].([]map[string]any)
	if !ok || len(items) != 2 {
		t.Fatalf("items = %#v, want two service years", result["items"])
	}
	cumulative, ok := result["cumulative"].(map[string]any)
	if !ok {
		t.Fatalf("cumulative = %#v", result["cumulative"])
	}
	if cumulative["projectCount"] != 2 || cumulative["totalWorkItems"] != int64(30) || cumulative["completedWorkItems"] != int64(27) {
		t.Fatalf("unexpected cumulative counts: %#v", cumulative)
	}
	if got := cumulative["totalHours"].(float64); math.Abs(got-300.5) > 0.0001 {
		t.Fatalf("totalHours = %v, want 300.5", got)
	}
	if cumulative["slaTicketCount"] != int64(15) || cumulative["slaMetCount"] != int64(14) {
		t.Fatalf("unexpected SLA counts: %#v", cumulative)
	}
	if got := cumulative["slaAchievementRate"].(float64); math.Abs(got-14.0/15.0) > 0.0001 {
		t.Fatalf("slaAchievementRate = %v, want %v", got, 14.0/15.0)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
