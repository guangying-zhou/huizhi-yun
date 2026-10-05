package aims

import (
	"context"
	"errors"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestDirectorWorkbenchRequiresExistingPeriod(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()
	mock.ExpectQuery("SELECT id FROM weekly_reporting_periods WHERE period_key = \\?").
		WithArgs("2026-W40").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	query := url.Values{"current_user_is_project_director": {"1"}, "current_user": {"u1"}}
	_, err := adapter.weeklyReportDirectorWorkbench(context.Background(), "2026-W40", query)
	var coded httperror.Error
	if !errors.As(err, &coded) || coded.Status != 409 || coded.Code != "weekly_reporting_period_required" {
		t.Fatalf("missing period must answer 409 weekly_reporting_period_required, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
