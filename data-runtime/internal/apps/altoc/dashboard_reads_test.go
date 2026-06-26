package altoc

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"io"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"
	"unsafe"

	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
)

const dashboardScopeDriverName = "altoc_dashboard_scope_test"

var (
	dashboardScopeDriverOnce sync.Once
	dashboardScopeCaptureMu  sync.Mutex
	dashboardScopeCapture    *dashboardScopeCaptureState
)

type capturedDashboardQuery struct {
	sql  string
	args []any
}

type dashboardScopeCaptureState struct {
	mu      sync.Mutex
	queries []capturedDashboardQuery
}

func TestDashboardKPIsApplyNonAdminScopeToAllAggregates(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()

	if _, err := adapter.dashboardKPIs(context.Background(), query); err != nil {
		t.Fatalf("dashboardKPIs returned error: %v", err)
	}

	queries := capture.snapshot()
	assertDashboardQuery(t, queries,
		[]string{"FROM opportunity o", "avg_cycle_days"},
		[]string{"o.owner_user_id = ?", "o.owner_dept_code IN", "s.pipeline_code = ?"},
		[]any{"u1", "D1", "D2", "default"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM opportunity o", "LEFT JOIN opportunity_stage s", "weighted"},
		[]string{"o.owner_user_id = ?", "o.owner_dept_code IN", "s.pipeline_code = ?"},
		[]any{"u1", "D1", "D2", "default"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM receivable_plan rp", "ar_balance"},
		[]string{"rp.owner_user_id = ?", "ct.owner_user_id = ?", "ct.owner_dept_code IN"},
		[]any{"u1", "u1", "D1", "D2"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM contract ct", "year_revenue"},
		[]string{"ct.owner_user_id = ?", "ct.owner_dept_code IN"},
		[]any{"u1", "D1", "D2"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM quotation q", "accepted"},
		[]string{"q.owner_user_id = ?", "q.owner_dept_code IN"},
		[]any{"u1", "D1", "D2"},
	)
}

func TestDashboardSummaryAppliesNonAdminScopeToAllAggregates(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()

	if _, err := adapter.dashboardSummary(context.Background(), query); err != nil {
		t.Fatalf("dashboardSummary returned error: %v", err)
	}

	queries := capture.snapshot()
	assertDashboardQuery(t, queries,
		[]string{"FROM customer cu", "active_count"},
		[]string{"cu.owner_user_id = ?", "cu.owner_dept_code IN"},
		[]any{"u1", "D1", "D2"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM `lead` l", "converted_count"},
		[]string{"l.owner_user_id = ?", "l.owner_dept_code IN"},
		[]any{"u1", "D1", "D2"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM opportunity o", "won_amount"},
		[]string{"o.owner_user_id = ?", "o.owner_dept_code IN", "os.pipeline_code = ?"},
		[]any{"u1", "D1", "D2", "default"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM contract ct", "month_amount"},
		[]string{"ct.owner_user_id = ?", "ct.owner_dept_code IN"},
		[]any{"u1", "D1", "D2"},
	)
	assertDashboardQuery(t, queries,
		[]string{"FROM receivable_plan rp", "upcoming_30d_amount"},
		[]string{"rp.owner_user_id = ?", "ct.owner_user_id = ?", "ct.owner_dept_code IN"},
		[]any{"u1", "u1", "D1", "D2"},
	)
	assertDashboardQuery(t, queries,
		[]string{"SELECT DISTINCT ct.code AS contract_code", "FROM receivable_plan rp"},
		[]string{"rp.owner_user_id = ?", "ct.owner_user_id = ?", "ct.owner_dept_code IN"},
		[]any{"u1", "u1", "D1", "D2"},
	)
}

func TestDashboardFunnelFiltersSelectedPipeline(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()
	query.Set("pipeline_code", "tog_project")

	if _, err := adapter.dashboardFunnel(context.Background(), query); err != nil {
		t.Fatalf("dashboardFunnel returned error: %v", err)
	}

	assertDashboardQuery(t, capture.snapshot(),
		[]string{"FROM opportunity_stage s", "LEFT JOIN opportunity o"},
		[]string{"o.owner_user_id = ?", "o.owner_dept_code IN", "s.pipeline_code = ?"},
		[]any{"u1", "D1", "D2", "tog_project"},
	)
}

func TestDashboardForecastFiltersSelectedPipeline(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()
	query.Set("pipeline_code", "solution")

	if _, err := adapter.dashboardForecast(context.Background(), query); err != nil {
		t.Fatalf("dashboardForecast returned error: %v", err)
	}

	assertDashboardQuery(t, capture.snapshot(),
		[]string{"FROM opportunity o", "GROUP BY o.forecast_category"},
		[]string{"o.owner_user_id = ?", "o.owner_dept_code IN", "s.pipeline_code = ?"},
		[]any{"u1", "D1", "D2", "solution"},
	)
}

func TestDashboardSalesInsightsFiltersSourceConversionByPipeline(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()
	query.Set("pipeline_code", "tog_project")

	if _, err := adapter.dashboardSalesInsights(context.Background(), query); err != nil {
		t.Fatalf("dashboardSalesInsights returned error: %v", err)
	}

	assertDashboardQuery(t, capture.snapshot(),
		[]string{"FROM `lead` l", "converted_in_pipeline"},
		[]string{"l.owner_user_id = ?", "l.owner_dept_code IN", "LEFT JOIN opportunity lo", "LEFT JOIN opportunity_stage los", "los.pipeline_code = ?"},
		[]any{"tog_project", "u1", "D1", "D2"},
	)
}

func TestDashboardSalesInsightsScopesLeadActionRisks(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()

	if _, err := adapter.dashboardSalesInsights(context.Background(), query); err != nil {
		t.Fatalf("dashboardSalesInsights returned error: %v", err)
	}

	assertDashboardQuery(t, capture.snapshot(),
		[]string{"FROM `lead` l", "no_next_action_count", "never_followed_count"},
		[]string{"l.owner_user_id = ?", "l.owner_dept_code IN"},
		[]any{"u1", "D1", "D2"},
	)
}

func TestDashboardSalesInsightsFiltersOpportunityMetricsByPipeline(t *testing.T) {
	adapter, capture := newDashboardScopeTestAdapter(t)
	query := dashboardScopeQuery()
	query.Set("pipeline_code", "solution")

	if _, err := adapter.dashboardSalesInsights(context.Background(), query); err != nil {
		t.Fatalf("dashboardSalesInsights returned error: %v", err)
	}

	queries := capture.snapshot()
	for _, tt := range []struct {
		name      string
		selectors []string
	}{
		{
			name:      "stage aging",
			selectors: []string{"FROM opportunity o", "avg_days_in_stage", "o.status = 'active'"},
		},
		{
			name:      "sign date slippage",
			selectors: []string{"FROM opportunity o", "expected_sign_date < CURDATE()", "avg_overdue_days"},
		},
		{
			name:      "action risks",
			selectors: []string{"FROM opportunity o", "no_next_action_count", "never_followed_count"},
		},
		{
			name:      "sales cycle summary",
			selectors: []string{"FROM opportunity o", "won_avg_days", "lost_avg_days"},
		},
		{
			name:      "sales cycle by source",
			selectors: []string{"FROM opportunity o", "source_type", "avg_days", "GROUP BY COALESCE(NULLIF(o.source_type"},
		},
		{
			name:      "win loss by source",
			selectors: []string{"FROM opportunity o", "won_amount", "lost_amount", "total_amount"},
		},
		{
			name:      "forecast accuracy",
			selectors: []string{"FROM opportunity o", "forecast_category", "actual_win_rate"},
		},
		{
			name:      "lost reasons",
			selectors: []string{"FROM opportunity o", "lost_reason_code", "o.status = 'lost'"},
		},
		{
			name:      "won reasons",
			selectors: []string{"FROM opportunity o", "won_reason_code", "o.status = 'won'"},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assertDashboardQuery(t, queries,
				tt.selectors,
				[]string{"o.owner_user_id = ?", "o.owner_dept_code IN", "os.pipeline_code = ?"},
				[]any{"u1", "D1", "D2", "solution"},
			)
		})
	}
}

func newDashboardScopeTestAdapter(t *testing.T) (*Adapter, *dashboardScopeCaptureState) {
	t.Helper()
	registerDashboardScopeDriver()

	capture := &dashboardScopeCaptureState{}
	restore := setDashboardScopeCapture(capture)
	t.Cleanup(restore)

	db, err := sql.Open(dashboardScopeDriverName, t.Name())
	if err != nil {
		t.Fatalf("open dashboard scope test db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	compatAdapter := &compat.Adapter{}
	dbField := reflect.ValueOf(compatAdapter).Elem().FieldByName("db")
	reflect.NewAt(dbField.Type(), unsafe.Pointer(dbField.UnsafeAddr())).Elem().Set(reflect.ValueOf(db))
	return &Adapter{Adapter: compatAdapter}, capture
}

func registerDashboardScopeDriver() {
	dashboardScopeDriverOnce.Do(func() {
		sql.Register(dashboardScopeDriverName, dashboardScopeDriver{})
	})
}

func setDashboardScopeCapture(capture *dashboardScopeCaptureState) func() {
	dashboardScopeCaptureMu.Lock()
	previous := dashboardScopeCapture
	dashboardScopeCapture = capture
	dashboardScopeCaptureMu.Unlock()
	return func() {
		dashboardScopeCaptureMu.Lock()
		dashboardScopeCapture = previous
		dashboardScopeCaptureMu.Unlock()
	}
}

func dashboardScopeQuery() url.Values {
	query := url.Values{}
	query.Set("current_user", "u1")
	query.Set("current_user_dept_codes", "D1,D2")
	return query
}

func (c *dashboardScopeCaptureState) append(query string, args []any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.queries = append(c.queries, capturedDashboardQuery{
		sql:  compactDashboardSQL(query),
		args: append([]any(nil), args...),
	})
}

func (c *dashboardScopeCaptureState) snapshot() []capturedDashboardQuery {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]capturedDashboardQuery(nil), c.queries...)
}

func assertDashboardQuery(t *testing.T, queries []capturedDashboardQuery, selectors []string, scopeParts []string, wantArgs []any) {
	t.Helper()

	for _, query := range queries {
		if !dashboardQueryMatches(query.sql, selectors) {
			continue
		}
		for _, part := range scopeParts {
			if !strings.Contains(query.sql, compactDashboardSQL(part)) {
				t.Fatalf("query matching %#v is missing scope part %q:\n%s", selectors, part, query.sql)
			}
		}
		if !reflect.DeepEqual(query.args, wantArgs) {
			t.Fatalf("query matching %#v args = %#v, want %#v", selectors, query.args, wantArgs)
		}
		return
	}
	t.Fatalf("no dashboard query matched %#v; captured:\n%s", selectors, formatCapturedDashboardQueries(queries))
}

func dashboardQueryMatches(query string, selectors []string) bool {
	for _, selector := range selectors {
		if !strings.Contains(query, compactDashboardSQL(selector)) {
			return false
		}
	}
	return true
}

func compactDashboardSQL(query string) string {
	return strings.Join(strings.Fields(query), " ")
}

func formatCapturedDashboardQueries(queries []capturedDashboardQuery) string {
	lines := make([]string, 0, len(queries))
	for _, query := range queries {
		lines = append(lines, query.sql)
	}
	return strings.Join(lines, "\n")
}

type dashboardScopeDriver struct{}

func (dashboardScopeDriver) Open(string) (driver.Conn, error) {
	return dashboardScopeConn{}, nil
}

type dashboardScopeConn struct{}

func (dashboardScopeConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("prepare is not supported by dashboard scope test driver")
}

func (dashboardScopeConn) Close() error {
	return nil
}

func (dashboardScopeConn) Begin() (driver.Tx, error) {
	return nil, errors.New("transactions are not supported by dashboard scope test driver")
}

func (dashboardScopeConn) QueryContext(_ context.Context, query string, namedArgs []driver.NamedValue) (driver.Rows, error) {
	args := make([]any, 0, len(namedArgs))
	for _, arg := range namedArgs {
		args = append(args, arg.Value)
	}

	dashboardScopeCaptureMu.Lock()
	capture := dashboardScopeCapture
	dashboardScopeCaptureMu.Unlock()
	if capture != nil {
		capture.append(query, args)
	}

	if strings.Contains(query, "information_schema.COLUMNS") {
		return &dashboardScopeRows{
			columns: []string{"COLUMN_NAME"},
			values: [][]driver.Value{
				{"id"},
				{"code"},
				{"pipeline_code"},
				{"stage_kind"},
				{"name"},
				{"sort_no"},
				{"win_rate"},
			},
		}, nil
	}

	return &dashboardScopeRows{
		columns: dashboardScopeColumns(),
		values:  [][]driver.Value{zeroDashboardScopeRow()},
	}, nil
}

func (dashboardScopeConn) CheckNamedValue(*driver.NamedValue) error {
	return nil
}

type dashboardScopeRows struct {
	columns []string
	values  [][]driver.Value
	index   int
}

func (r *dashboardScopeRows) Columns() []string {
	return r.columns
}

func (r *dashboardScopeRows) Close() error {
	return nil
}

func (r *dashboardScopeRows) Next(dest []driver.Value) error {
	if r.index >= len(r.values) {
		return io.EOF
	}
	copy(dest, r.values[r.index])
	r.index++
	return nil
}

func dashboardScopeColumns() []string {
	return []string{
		"won_count",
		"lost_count",
		"avg_cycle_days",
		"pipeline_amount",
		"weighted",
		"planned_amount",
		"received_amount",
		"overdue_amount",
		"ar_balance",
		"year_revenue",
		"total",
		"accepted",
		"active_count",
		"converted_count",
		"won_amount",
		"plan_total",
		"received_total",
		"upcoming_30d_amount",
		"month_received",
	}
}

func zeroDashboardScopeRow() []driver.Value {
	columns := dashboardScopeColumns()
	row := make([]driver.Value, len(columns))
	for i := range row {
		row[i] = int64(0)
	}
	return row
}
