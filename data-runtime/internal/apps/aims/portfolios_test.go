package aims

import (
	"context"
	"net/http"
	"net/url"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestPortfoliosRuntimeListPreservesLegacyShape(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery("SELECT COUNT\\(\\*\\) AS total FROM project_portfolios pf WHERE pf.status = 'active'").
		WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(int64(1)))
	mock.ExpectQuery("(?s)SELECT pf.id, pf.code, pf.name.*FROM project_portfolios pf.*WHERE pf.status = 'active'.*ORDER BY pf.display_order ASC, pf.id ASC.*LIMIT \\? OFFSET \\?").
		WithArgs(int64(20), int64(0)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"code",
			"name",
			"description",
			"domain_code",
			"owner_uid",
			"dept_code",
			"git_group",
			"is_product_line",
			"default_category",
			"is_system",
			"display_order",
			"status",
			"created_by",
			"created_at",
			"updated_at",
			"project_count",
		}).AddRow(int64(7), "PF1", "项目集", nil, "delivery", "u1", "dept-a", "git", int64(1), "product_dev", int64(0), int64(3), "active", "u1", "2026-06-30 09:00:00", "2026-06-30 10:00:00", int64(2)))

	data, err := adapter.listPortfolios(context.Background(), url.Values{})
	if err != nil {
		t.Fatalf("expected list to pass, got %v", err)
	}
	items, ok := data["items"].([]portfolioListItem)
	if !ok || len(items) != 1 {
		t.Fatalf("items = %#v, want one portfolioListItem", data["items"])
	}
	if items[0].ID != 7 || items[0].Code != "PF1" || items[0].ProjectCount != 2 || !items[0].IsProductLine {
		t.Fatalf("item = %#v", items[0])
	}
	if data["total"] != int64(1) || data["page"] != int64(1) || data["pageSize"] != int64(20) {
		t.Fatalf("pagination = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestPortfoliosRuntimeCreateRequiresTrustedManageFlag(t *testing.T) {
	adapter, _, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	_, err := adapter.createPortfolio(
		context.Background(),
		url.Values{"current_user": {"u1"}},
		map[string]any{"code": "pf1", "name": "项目集"},
	)
	if err == nil {
		t.Fatal("expected create without trusted manage flag to fail")
	}
	if httpErr, ok := err.(httperror.Error); !ok || httpErr.Status != 403 {
		t.Fatalf("err = %#v, want 403 httperror", err)
	}
}

func TestPortfoliosRuntimeCreateUsesTrustedActor(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	// is_product_line 已降级为 default_category 的派生值，两者同列写入
	mock.ExpectExec("INSERT INTO project_portfolios").
		WithArgs("PF1", "项目集", nil, "delivery", nil, nil, "git", int64(1), "product_dev", int64(3), "u1").
		WillReturnResult(sqlmock.NewResult(77, 1))

	data, err := adapter.createPortfolio(
		context.Background(),
		url.Values{
			"current_user":                       {"u1"},
			"current_user_can_manage_portfolios": {"1"},
		},
		map[string]any{
			"code":            "pf1",
			"name":            "项目集",
			"domainCode":      "delivery",
			"gitGroup":        "git",
			"defaultCategory": "product_dev",
			"displayOrder":    float64(3),
			"current_user":    "spoofed",
		},
	)
	if err != nil {
		t.Fatalf("expected create to pass, got %v", err)
	}
	if data["id"] != int64(77) || data["code"] != "PF1" {
		t.Fatalf("data = %#v", data)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestPortfoliosRuntimeCreateMapsDuplicateCodeToConflict(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectExec("INSERT INTO project_portfolios").
		WillReturnError(&mysql.MySQLError{Number: 1062, Message: "Duplicate entry 'C-DIAG' for key 'uk_portfolio_code'"})

	_, err := adapter.createPortfolio(
		context.Background(),
		url.Values{
			"current_user":                       {"u1"},
			"current_user_can_manage_portfolios": {"1"},
		},
		map[string]any{"code": "C-DIAG", "name": "诊断项目集"},
	)
	if err == nil {
		t.Fatal("expected duplicate portfolio code to fail")
	}
	httpErr, ok := err.(httperror.Error)
	if !ok || httpErr.Status != http.StatusConflict || httpErr.Code != "portfolio_code_conflict" {
		t.Fatalf("err = %#v, want 409 portfolio_code_conflict", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}
