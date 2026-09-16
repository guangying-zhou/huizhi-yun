package aims

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestMilestoneCycleSnapshotInsertBindsConfirmedAtToServerTimestamp(t *testing.T) {
	if got := strings.Count(milestoneCycleSnapshotInsertSQL, "?"); got != 24 {
		t.Fatalf("snapshot INSERT placeholders = %d, want 24", got)
	}
	if !strings.Contains(milestoneCycleSnapshotInsertSQL, "exception_due_date, confirmed_by, confirmed_at") ||
		!strings.Contains(milestoneCycleSnapshotInsertSQL, "?, ?, CURRENT_TIMESTAMP, ?, ?, ?") {
		t.Fatal("snapshot INSERT must bind confirmed_by, use the server timestamp for confirmed_at, then bind SLA/cost/idempotency")
	}
}

func TestCarryoverFreezesOriginBeforeMovingMilestone(t *testing.T) {
	originIndex := strings.Index(carryoverWorkItemsSQL, "carryover_origin_milestone_id =")
	moveIndex := strings.Index(carryoverWorkItemsSQL, "milestone_id = ?")
	if originIndex < 0 || moveIndex < 0 || originIndex >= moveIndex {
		t.Fatalf("carryover SQL must freeze the source milestone before reassignment:\n%s", carryoverWorkItemsSQL)
	}
	if !strings.Contains(carryoverWorkItemsSQL, "carryover_count + 1 >= 3") {
		t.Fatal("carryover SQL must flag governance abnormality on the third consecutive carryover")
	}
}

func TestServiceMilestoneRolloverPath(t *testing.T) {
	projectCode, milestoneID, ok := serviceMilestoneRolloverPath("/v1/aims/service/projects/PRJ%2F1/milestones/42:rollover")
	if !ok {
		t.Fatal("expected rollover path to parse")
	}
	if projectCode != "PRJ/1" || milestoneID != 42 {
		t.Fatalf("parsed = %q/%d", projectCode, milestoneID)
	}
}

func TestRolloverProjectMilestoneTxReturnsExistingNextPeriod(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}

	mock.ExpectQuery(`(?s)SELECT\s+p\.id AS project_id,.*FROM milestones m\s+INNER JOIN aims_projects p ON p\.id = m\.project_id`).
		WithArgs("PRJ-1", int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id", "project_code", "leader_uid", "milestone_id", "name", "description",
			"mode", "start_date", "end_date", "status", "pivr_stage", "template_key", "recurrence_rule", "sort_order",
		}).AddRow(
			int64(100), "PRJ-1", "manager", int64(10), "2026-07 月度运维", "desc",
			"periodic", "2026-07-01", "2026-07-31", "completed", "R", "monthly_ops", "monthly", int64(9000),
		))
	mock.ExpectQuery(`(?s)SELECT \* FROM milestone_cycle_snapshots\s+WHERE idempotency_key = \?`).
		WithArgs("aims:milestone:PRJ-1:monthly_ops:2026-08-01:rollover:v1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)SELECT \*\s+FROM milestones\s+WHERE project_id = \?\s+AND template_key = \?\s+AND start_date = \?`).
		WithArgs(int64(100), "monthly_ops", "2026-08-01").
		WillReturnRows(sqlmock.NewRows([]string{"id", "project_id", "template_key", "start_date"}).
			AddRow(int64(11), int64(100), "monthly_ops", "2026-08-01"))
	mock.ExpectQuery(`(?s)SELECT \* FROM milestone_cycle_snapshots\s+WHERE source_milestone_id = \? AND next_milestone_id = \?`).
		WithArgs(int64(10), int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	result, err := rolloverProjectMilestoneTx(context.Background(), tx, "PRJ-1", int64(10), map[string]any{})
	if err != nil {
		t.Fatalf("rolloverProjectMilestoneTx: %v", err)
	}
	if result["idempotent"] != true || result["created"] != false {
		t.Fatalf("result = %#v, want idempotent existing next period", result)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestMilestonePeriodNameUsesMonthlyLabel(t *testing.T) {
	start := aimsParsePeriodDate("2026-08-01")
	if got := milestonePeriodName(start, "monthly"); got != "2026-08 月度运维" {
		t.Fatalf("milestonePeriodName = %q", got)
	}
}

func TestEvaluatePeriodCloseGateFiveChecks(t *testing.T) {
	baseStats := map[string]any{
		"incomplete_count": int64(0), "hanging_count": int64(0), "overdue_count": int64(0),
		"overdue_ticket_count": int64(0), "unconfirmed_time_count": int64(0), "total_hours": float64(8),
		"sla_ticket_count": int64(2), "sla_met_count": int64(2),
	}
	passingBody := map[string]any{
		"costConfirmed": true, "slaReviewed": true, "reviewCompleted": true,
	}
	if gate := evaluatePeriodCloseGate(baseStats, "monthly", "auto", 7, passingBody); !gate.Passed || len(gate.Checks) != 5 {
		t.Fatalf("passing gate = %#v", gate)
	}

	tests := []struct {
		name       string
		stats      map[string]any
		carryover  string
		body       map[string]any
		failedGate string
	}{
		{name: "terminal", stats: withGateStat(baseStats, "incomplete_count", int64(1)), carryover: "manual", body: passingBody, failedGate: "terminal_or_carryover"},
		{name: "overdue", stats: withGateStat(baseStats, "overdue_count", int64(1)), carryover: "auto", body: withoutGateFlag(passingBody, "overdueReviewed"), failedGate: "overdue_remediation"},
		{name: "time", stats: withGateStat(baseStats, "unconfirmed_time_count", int64(1)), carryover: "auto", body: passingBody, failedGate: "time_and_cost"},
		{name: "sla", stats: baseStats, carryover: "auto", body: withoutGateFlag(passingBody, "slaReviewed"), failedGate: "sla_review"},
		{name: "review", stats: baseStats, carryover: "auto", body: withoutGateFlag(passingBody, "reviewCompleted"), failedGate: "period_review"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gate := evaluatePeriodCloseGate(test.stats, "monthly", test.carryover, 7, test.body)
			if gate.Passed || !containsGateKey(failedPeriodCloseGateKeys(gate), test.failedGate) {
				t.Fatalf("gate = %#v, want failure %s", gate, test.failedGate)
			}
		})
	}
}

func TestPeriodCloseReviewMonthlyCanWaiveQuarterlyCannot(t *testing.T) {
	stats := map[string]any{"total_hours": float64(0), "sla_ticket_count": int64(0)}
	body := map[string]any{"reviewExempted": true}
	monthly := evaluatePeriodCloseGate(stats, "monthly", "auto", 7, body)
	if !monthly.Passed {
		t.Fatalf("monthly exemption should pass: %#v", monthly)
	}
	quarterly := evaluatePeriodCloseGate(stats, "quarterly", "auto", 7, body)
	if quarterly.Passed || periodCloseGateExceptionAllowed(quarterly, "quarterly") {
		t.Fatalf("quarterly review must not be waivable: %#v", quarterly)
	}
}

func TestPeriodCloseExceptionDateRequiresValidValue(t *testing.T) {
	if validPeriodCloseExceptionDate("") || validPeriodCloseExceptionDate("2026-02-30") || !validPeriodCloseExceptionDate("2026-09-30") {
		t.Fatal("exception date validation did not enforce a valid required date")
	}
}

func TestPeriodCloseExceptionRequiresReasonOwnerAndValidDueDateTogether(t *testing.T) {
	tests := []struct{ reason, owner, due string }{
		{reason: "待补救"},
		{reason: "待补救", owner: "u1"},
		{reason: "待补救", owner: "u1", due: "2026-02-30"},
	}
	for _, test := range tests {
		hasAny, complete, err := validatePeriodCloseExceptionFields(test.reason, test.owner, test.due)
		var httpErr httperror.Error
		if !hasAny || complete || !errors.As(err, &httpErr) || httpErr.Code != "incomplete_close_exception" {
			t.Fatalf("fields=%#v hasAny=%v complete=%v err=%#v", test, hasAny, complete, err)
		}
	}
	hasAny, complete, err := validatePeriodCloseExceptionFields("待补救", "u1", "2026-09-30")
	if !hasAny || !complete || err != nil {
		t.Fatalf("complete exception hasAny=%v complete=%v err=%v", hasAny, complete, err)
	}
}

func TestScheduledRolloverReturnsGateFailuresAsPendingTodos(t *testing.T) {
	adapter, mock, cleanup := newAimsSQLMockAdapter(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT p\.project_code, m\.id AS milestone_id.*FROM milestones m.*m\.end_date <= CURDATE\(\)`).
		WithArgs(100).
		WillReturnRows(sqlmock.NewRows([]string{"project_code", "milestone_id"}).AddRow("PRJ-1", int64(10)))
	mock.ExpectBegin()
	mock.ExpectQuery(`(?s)SELECT\s+p\.id AS project_id,.*FROM milestones m.*FOR UPDATE`).
		WithArgs("PRJ-1", int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id", "project_code", "project_name", "leader_uid", "milestone_id", "name", "description",
			"mode", "start_date", "end_date", "status", "completion_lock_request_id", "pivr_stage", "template_key",
			"recurrence_rule", "sort_order",
		}).AddRow(
			int64(100), "PRJ-1", "运维项目", "manager", int64(10), "2026-07 月度运维", "",
			"periodic", "2026-07-01", "2026-07-31", "active", nil, "R", "monthly_ops", "monthly", int64(1),
		))
	mock.ExpectQuery(`(?s)SELECT \* FROM milestone_cycle_snapshots.*WHERE idempotency_key = \?.*FOR UPDATE`).
		WithArgs("aims:milestone:PRJ-1:monthly_ops:2026-08-01:rollover:v1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)SELECT \*.*FROM milestones.*project_id = \?.*template_key = \?.*start_date = \?.*FOR UPDATE`).
		WithArgs(int64(100), "monthly_ops", "2026-08-01").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)SELECT\s+COUNT\(\*\) AS total_count,.*FROM work_items wi.*WHERE wi\.project_id = \?.*wi\.milestone_id = \?`).
		WithArgs(int64(100), int64(10), int64(100), int64(10), int64(100), int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"total_count", "completed_count", "incomplete_count", "hanging_count", "overdue_count", "total_hours",
			"unconfirmed_time_count", "sla_ticket_count", "sla_met_count", "overdue_ticket_count",
		}).AddRow(int64(1), int64(0), int64(1), int64(1), int64(1), float64(0), int64(0), int64(0), int64(0), int64(0)))
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\), COALESCE\(MAX\(pcs\.total_cost\), 0\).*FROM project_cost_summary`).
		WithArgs(int64(100), int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"count", "cost"}).AddRow(int64(0), float64(0)))
	mock.ExpectCommit()

	result, err := adapter.rolloverDueProjectMilestones(context.Background(), map[string]any{})
	if err != nil {
		t.Fatalf("rolloverDueProjectMilestones: %v", err)
	}
	if result["scanned"] != 1 || result["rolled_over"] != 0 || result["pending"] != 1 || result["failed"] != 0 {
		t.Fatalf("scheduled result = %#v", result)
	}
	pending, ok := result["pendingItems"].([]map[string]any)
	if !ok || len(pending) != 1 || pending[0]["todoType"] != "period_close_gate" {
		t.Fatalf("pendingItems = %#v", result["pendingItems"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func TestRolloverProjectMilestoneTxReplaysSnapshotByIdempotencyKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatalf("BeginTx: %v", err)
	}
	mock.ExpectQuery(`(?s)SELECT\s+p\.id AS project_id,.*FROM milestones m`).
		WithArgs("PRJ-1", int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{
			"project_id", "project_code", "leader_uid", "milestone_id", "mode", "start_date", "end_date", "status", "template_key", "recurrence_rule", "sort_order",
		}).AddRow(int64(100), "PRJ-1", "manager", int64(10), "periodic", "2026-07-01", "2026-07-31", "completed", "monthly_ops", "monthly", int64(1)))
	mock.ExpectQuery(`(?s)SELECT \* FROM milestone_cycle_snapshots\s+WHERE idempotency_key = \?`).
		WithArgs("replay-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "next_milestone_id", "idempotency_key"}).AddRow(int64(5), int64(11), "replay-1"))
	mock.ExpectQuery(`SELECT \* FROM milestones WHERE id = \? LIMIT 1`).
		WithArgs(int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(int64(11)))
	result, err := rolloverProjectMilestoneTx(context.Background(), tx, "PRJ-1", 10, map[string]any{"idempotencyKey": "replay-1"})
	if err != nil || result["idempotent"] != true {
		t.Fatalf("replay result=%#v err=%v", result, err)
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("expectations: %v", err)
	}
}

func withGateStat(source map[string]any, key string, value any) map[string]any {
	result := make(map[string]any, len(source)+1)
	for sourceKey, sourceValue := range source {
		result[sourceKey] = sourceValue
	}
	result[key] = value
	return result
}

func withoutGateFlag(source map[string]any, key string) map[string]any {
	result := make(map[string]any, len(source))
	for sourceKey, sourceValue := range source {
		if sourceKey != key {
			result[sourceKey] = sourceValue
		}
	}
	return result
}

func containsGateKey(keys []string, target string) bool {
	for _, key := range keys {
		if key == target {
			return true
		}
	}
	return false
}
