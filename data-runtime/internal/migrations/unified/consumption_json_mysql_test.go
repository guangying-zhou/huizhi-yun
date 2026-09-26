package unified

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
)

// Uses the existing harness socket exclusively; CREATE DATABASE/USE statements
// from the canonical schema are never executed.
func verifyConsumptionWriterContracts(t *testing.T, root *sql.DB) {
	t.Helper()
	ctx := context.Background()
	if !strings.HasPrefix(filepath.Clean(os.Getenv("HZY_INT202_TEST_SOCKET")), "/tmp/hzy-test-mysql-") {
		t.Fatal("refusing non-isolated consumption socket")
	}
	schema := "int202_consumption_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.ExecContext(ctx, "CREATE DATABASE "+quoted(schema)+" CHARACTER SET utf8mb4 COLLATE utf8mb4_bin"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := root.ExecContext(ctx, "DROP DATABASE "+quoted(schema)); err != nil {
			t.Error(err)
		}
	}()
	config := mysql.NewConfig()
	config.User = "root"
	config.Net = "unix"
	config.Addr = os.Getenv("HZY_INT202_TEST_SOCKET")
	config.DBName = schema
	config.ParseTime = true
	db, err := sql.Open("mysql", config.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	ddl := regexp.MustCompile(`(?is)CREATE TABLE\s+.*?ENGINE\s*=\s*InnoDB[^;]*;`).FindAllString(string(source), -1)
	if len(ddl) < 50 {
		t.Fatal("canonical CREATE TABLE extraction incomplete")
	}
	for _, statement := range ddl {
		if _, err = db.ExecContext(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, e := db.ExecContext(ctx, query, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec("INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES('P-CONSUME',?,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", uuid.NewString())
	permit := func(action string) productcenter.AuthorizationPermit {
		facts, e := productcenter.LoadAuthorizationFacts(ctx, db, "P-CONSUME", "pm")
		if e != nil {
			t.Fatal(e)
		}
		return productcenter.AuthorizationPermit{Resource: "product_priorities", Action: action, Facts: facts, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}
	}
	identity := func(action, key string) productcenter.CommandIdentity {
		return productcenter.CommandIdentity{ProductCode: "P-CONSUME", ActorUID: "pm", Action: "product_priorities:" + action, IdempotencyKey: key}
	}
	zero, total, target := productcenter.Hundredths(0), productcenter.Hundredths(1000), "75"
	draft := productcenter.PlanningCycleDraft{ExpectedRevision: 1, Title: "cycle", StartsOn: "2099-01-01", EndsOn: "2099-01-31", GoalSummary: "measure", ReviewIntervalDays: 14, Budget: &productcenter.PlanningCycleBudget{Total: &total, Reserve: &zero, Reliability: &zero, Usability: &zero, Growth: &total}, Metric: &productcenter.PlanningCycleMetric{Name: "success", Unit: "percent", Direction: "increase", MeasurementMethod: "unique users", TargetValue: &target}}
	created, e := productcenter.CreatePlanningCycle(ctx, db, identity("cycle-create", "cycle"), permit("edit"), draft)
	if e != nil {
		t.Fatal(e)
	}
	var cycle struct {
		BizID string `json:"biz_id"`
	}
	if e = json.Unmarshal(created.Value, &cycle); e != nil {
		t.Fatal(e)
	}
	item := uuid.NewString()
	exec("INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,'P-CONSUME','OIDC','scope','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", item)
	candidate := productcenter.PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: item, ExpectedRevision: 2, ExpectedCycleRevision: 1, ExpectedItemRevision: 1}
	if _, e = productcenter.AddPlanningCycleCandidate(ctx, db, identity("candidate-add", "candidate"), permit("edit"), candidate); e != nil {
		t.Fatal(e)
	}
	effort := productcenter.Hundredths(800)
	baseline, _ := json.Marshal(map[string]any{"capacity": productcenter.PlanningCapacityBaseline{Version: 1, ItemBizID: item, Category: productcenter.Growth, Effort: &effort}})
	exec("UPDATE product_planning_cycles SET status='open' WHERE biz_id=?", cycle.BizID)
	exec("UPDATE product_planning_items SET lifecycle='in_delivery' WHERE biz_id=?", item)
	exec("UPDATE product_planning_cycle_items SET selection_status='selected',decision_snapshot=?", baseline)
	check := func(expectValid bool) {
		t.Helper()
		issues, e := inspectConsumptionJSON(ctx, db, schema)
		if e != nil {
			t.Fatal(e)
		}
		if (len(issues) == 0) != expectValid {
			t.Fatalf("valid=%v conflicts=%+v", expectValid, issues)
		}
		for _, issue := range issues {
			if len(issue.KeySHA256) != 64 || issue.RowCount != 1 {
				t.Fatalf("unsafe conflict %+v", issue)
			}
		}
	}
	spent := productcenter.Hundredths(325)
	confirm := productcenter.PlanningConsumptionConfirm{PlanningCycleCandidateAdd: productcenter.PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: item, ExpectedRevision: 3, ExpectedCycleRevision: 2, ExpectedItemRevision: 1}, ExpectedQueueRevision: 2, ExpectedScopeRevision: 1, Spent: &spent, Reason: "confirmed"}
	first, e := productcenter.ConfirmPlanningConsumption(ctx, db, identity("consumption-confirm", "confirm-first"), permit("assess"), confirm)
	if e != nil {
		t.Fatal(e)
	}
	check(true)
	spent = 400
	confirm.ExpectedRevision = 4
	confirm.ExpectedCycleRevision = 3
	confirm.ExpectedQueueRevision = 3
	second, e := productcenter.ConfirmPlanningConsumption(ctx, db, identity("consumption-confirm", "confirm-second"), permit("assess"), confirm)
	if e != nil {
		t.Fatal(e)
	}
	check(true)
	var result consumptionConfirmResult
	if e = json.Unmarshal(second.Value, &result); e != nil {
		t.Fatal(e)
	}
	var snapshot []byte
	if e = db.QueryRowContext(ctx, "SELECT decision_snapshot FROM product_planning_cycle_items").Scan(&snapshot); e != nil {
		t.Fatal(e)
	}
	var originalHash string
	if e = db.QueryRowContext(ctx, "SELECT request_hash FROM product_command_receipts WHERE idempotency_key='confirm-first'").Scan(&originalHash); e != nil {
		t.Fatal(e)
	}
	exec("UPDATE product_command_receipts SET request_hash=? WHERE idempotency_key='confirm-first'", strings.Repeat("b", 64))
	check(false)
	exec("UPDATE product_command_receipts SET request_hash=? WHERE idempotency_key='confirm-first'", originalHash)
	check(true)
	for _, mutation := range []string{
		"JSON_SET(decision_snapshot,'$.pending_consumption.scope_revision',99)",
		"JSON_SET(decision_snapshot,'$.pending_consumption.version',2)",
		"JSON_SET(decision_snapshot,'$.pending_consumption.spent_person_days',NULL)",
		"JSON_SET(decision_snapshot,'$.pending_consumption.unregistered',true)",
		"JSON_SET(decision_snapshot,'$.pending_consumption.item_revision',99)",
		"JSON_SET(decision_snapshot,'$.pending_consumption.item_biz_id','00000000-0000-4000-8000-000000000000')",
	} {
		exec("UPDATE product_planning_cycle_items SET decision_snapshot=" + mutation)
		check(false)
		exec("UPDATE product_planning_cycle_items SET decision_snapshot=?", snapshot)
		check(true)
	}
	// Normal subsequent revisions make pending stale; they do not corrupt history.
	exec("UPDATE product_planning_items SET revision=2,scope_revision=2 WHERE biz_id=?", item)
	check(true)
	exec("UPDATE product_planning_items SET revision=1,scope_revision=1 WHERE biz_id=?", item)
	withdraw := productcenter.PlanningWithdrawal{PlanningCycleCandidateAdd: productcenter.PlanningCycleCandidateAdd{CycleBizID: cycle.BizID, ItemBizID: item, ExpectedRevision: 5, ExpectedCycleRevision: 4, ExpectedItemRevision: 1}, ExpectedQueueRevision: 4, ConsumptionConfirmationID: result.Confirmation.ConfirmationID, Reason: "withdraw", ImpactNote: "retain measured effort", Exceptions: []productcenter.DecisionException{}}
	if _, e = productcenter.WithdrawPlanningCandidate(ctx, db, identity("withdraw", "withdraw"), permit("prioritize"), withdraw); e != nil {
		t.Fatal(e)
	}
	check(true)
	if e = db.QueryRowContext(ctx, "SELECT decision_snapshot FROM product_planning_cycle_items").Scan(&snapshot); e != nil {
		t.Fatal(e)
	}
	exec("UPDATE product_planning_items SET revision=2,scope_revision=2 WHERE biz_id=?", item)
	check(true)
	for _, mutation := range []string{
		"JSON_SET(decision_snapshot,'$.retained_consumption.spent_person_days','9.00')",
		"JSON_SET(decision_snapshot,'$.consumption_confirmation_id','00000000-0000-4000-8000-000000000000')",
		"JSON_SET(decision_snapshot,'$.retained_consumption.version',2)",
		"JSON_SET(decision_snapshot,'$.unregistered',true)",
	} {
		exec("UPDATE product_planning_cycle_items SET decision_snapshot=" + mutation)
		check(false)
		exec("UPDATE product_planning_cycle_items SET decision_snapshot=?", snapshot)
		check(true)
	}
	exec("UPDATE product_activity_logs SET actor_uid='other' WHERE action='withdraw'")
	check(false)
	exec("UPDATE product_activity_logs SET actor_uid='pm' WHERE action='withdraw'")
	check(true)
	exec("UPDATE product_activity_logs SET changes=JSON_SET(changes,'$.reason','changed') WHERE action='withdraw'")
	check(false)
	exec("UPDATE product_activity_logs SET changes=JSON_SET(changes,'$.reason','withdraw') WHERE action='withdraw'")
	check(true)
	exec("INSERT INTO product_activity_logs(object_type,object_id,product_code,action,actor_uid,revision,request_id,changes,created_at) SELECT object_type,?,product_code,action,actor_uid,revision,request_id,changes,created_at FROM product_activity_logs WHERE action='withdraw'", uuid.NewString())
	check(false)
	exec("DELETE FROM product_activity_logs WHERE action='withdraw' AND object_id<>?", cycle.BizID)
	check(true)
	var withdrawalHash string
	if e = db.QueryRowContext(ctx, "SELECT request_hash FROM product_command_receipts WHERE action='product_priorities:withdraw'").Scan(&withdrawalHash); e != nil {
		t.Fatal(e)
	}
	exec("UPDATE product_command_receipts SET request_hash=? WHERE action='product_priorities:withdraw'", strings.Repeat("c", 64))
	check(false)
	exec("UPDATE product_command_receipts SET request_hash=? WHERE action='product_priorities:withdraw'", withdrawalHash)
	check(true)
	var firstResult consumptionConfirmResult
	if e = json.Unmarshal(first.Value, &firstResult); e != nil {
		t.Fatal(e)
	}
	if firstResult.Confirmation.ConfirmationID == result.Confirmation.ConfirmationID {
		t.Fatal("replacement did not create new frozen identity")
	}
	t.Log("real writer consumption-confirm replacement and consumed withdrawal: valid/stale history accepted; hash, scope, revision, identity, schema, retained value and audit mutations blocked")
	verifyCompletionWriterContracts(t, root, db, schema, string(source))
}
