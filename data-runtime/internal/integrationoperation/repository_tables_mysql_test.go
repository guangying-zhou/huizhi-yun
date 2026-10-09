package integrationoperation

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestMappedOutboxRepositoryMySQL(t *testing.T) {
	socket := os.Getenv("HZY_MAPPED_OUTBOX_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
	}
	mc := mysql.NewConfig()
	mc.User = "root"
	mc.Net = "unix"
	mc.Addr = socket
	mc.ParseTime = true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	schema := "hzy_mapped_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + schema + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + schema + "`")
	mc.DBName = schema
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	tables := mappedTestTables(t)
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "service_command_receipt"} {
		marker := "CREATE TABLE IF NOT EXISTS " + name + " ("
		start := strings.Index(string(ddl), marker)
		if start < 0 {
			t.Fatal(name)
		}
		end := strings.Index(string(ddl)[start:], ";\n")
		if end < 0 {
			t.Fatal("DDL terminator")
		}
		exec(mapOutboxSQL(string(ddl)[start:start+end], &tables))
	}
	exec("CREATE TABLE business_checkpoint(id VARCHAR(100) PRIMARY KEY)")
	r, err := NewRepository(db, WithOutboxTables(tables))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Millisecond)
	insert := func(tenant, key string) string {
		t.Helper()
		id := uuid.NewString()
		command := json.RawMessage(`{"assetCode":"ASSET-1"}`)
		exec("INSERT INTO u_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,next_attempt_at) VALUES(?,?,?,?,'DEPLOYMENT-A','aims','assets','assets.delivery.link_document.v1','assets.delivery.write','request','R-1',?,?,?,?)", id, key, key, tenant, key, string(command), commandDigest(t, command), now)
		return id
	}
	id := insert("TENANT-A", "first")
	insert("TENANT-B", "other")
	// Caller owns commit: both claim updates and attempt insert roll back together.
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	claim, err := r.ClaimNextInTransaction(ctx, tx, "TENANT-A", "DEPLOYMENT-A", "aims", "worker-1", now, time.Minute)
	if err != nil || claim == nil {
		t.Fatal(claim, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = db.QueryRow("SELECT COUNT(*) FROM u_attempt").Scan(&count); err != nil || count != 0 {
		t.Fatal("claim leaked", count, err)
	}
	claim, err = r.ClaimByOperationKey(ctx, "TENANT-A", "DEPLOYMENT-A", "aims", "first", "worker-1", now, time.Minute)
	if err != nil || claim == nil {
		t.Fatal(claim, err)
	}
	if claim.OperationID != id {
		t.Fatal("cross tenant claim")
	}
	stale := CompletionLease{OperationID: id, Worker: claim.Worker, FencingToken: claim.FencingToken}
	recovered, err := r.ClaimNext(ctx, "TENANT-A", "DEPLOYMENT-A", "aims", "worker-2", now.Add(2*time.Minute), time.Minute)
	if err != nil || recovered == nil {
		t.Fatal(recovered, err)
	}
	if recovered.FencingToken <= claim.FencingToken {
		t.Fatal("fence did not advance")
	}
	if _, err = r.RecordSuccess(ctx, RecordSuccessInput{Lease: stale, Now: now.Add(2 * time.Minute), HTTPStatus: 200}); !errors.Is(err, ErrStaleFencing) {
		t.Fatal("stale completion", err)
	}
	lease := CompletionLease{OperationID: id, Worker: recovered.Worker, FencingToken: recovered.FencingToken}
	success := RecordSuccessInput{Lease: lease, Now: now.Add(2*time.Minute + time.Second), HTTPStatus: 200}
	// The mutation runs after receipt state changes; error must revert all of it.
	sentinel := errors.New("checkpoint rejected")
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = r.RecordSuccessWithMutationInTransaction(ctx, tx, success, func(ctx context.Context, tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "INSERT INTO business_checkpoint VALUES('rollback')"); err != nil {
			return err
		}
		return sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	if err = tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
		t.Fatal("failed tx committable", err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM business_checkpoint").Scan(&count); err != nil || count != 0 {
		t.Fatal("mutation leaked", count, err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := r.RecordFailureInTransaction(ctx, tx, RecordFailureInput{Lease: lease, Now: success.Now, Failure: FailureInput{HTTPStatus: 503}, ErrorCode: "unavailable", ErrorSummary: "temporarily unavailable"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusRetryWait {
		t.Fatal(result)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	result, err = r.RecordSuccessWithMutation(ctx, success, func(ctx context.Context, tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, "INSERT INTO business_checkpoint VALUES('success')")
		return err
	})
	if err != nil || result.Status != StatusSucceeded {
		t.Fatal(result, err)
	}
	timeline, err := r.ListAttemptTimeline(ctx, AttemptTimelineInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: id, Limit: 20})
	if err != nil || len(timeline) != 2 {
		t.Fatal(timeline, err)
	}
	other, err := r.ListAttemptTimeline(ctx, AttemptTimelineInput{TenantCode: "TENANT-B", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: id, Limit: 20})
	if err != nil || len(other) != 0 {
		t.Fatal("timeline leaked", other, err)
	}
	if _, err = r.ListDiagnostics(ctx, DiagnosticListInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", Limit: 20}); err != nil {
		t.Fatal(err)
	}
	// Exercise mapped dead-letter materialization, publication, authorization and closure.
	deadID := insert("TENANT-A", "dead")
	exec("UPDATE u_operation SET max_attempts=1 WHERE operation_id=?", deadID)
	dead, err := r.ClaimByOperationKey(ctx, "TENANT-A", "DEPLOYMENT-A", "aims", "dead", "worker-1", now, time.Minute)
	if err != nil || dead == nil {
		t.Fatal(dead, err)
	}
	result, err = r.RecordFailure(ctx, RecordFailureInput{Lease: CompletionLease{OperationID: deadID, Worker: dead.Worker, FencingToken: dead.FencingToken}, Now: now.Add(time.Second), Failure: FailureInput{HTTPStatus: 503}, ErrorCode: "unavailable", ErrorSummary: "temporarily unavailable"})
	if err != nil || result.Status != StatusDeadLetter {
		t.Fatal(result, err)
	}
	// Shared notification entry points never commit materialization or marks.
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	sharedCandidates, err := r.ListPendingDeadLetterActionablesInTransaction(ctx, tx, "TENANT-A", "DEPLOYMENT-A", "aims", 20, now.Add(time.Second))
	if err != nil || len(sharedCandidates) != 1 {
		t.Fatal(sharedCandidates, err)
	}
	var visible int
	if err = db.QueryRow("SELECT COUNT(*) FROM u_dead_letter WHERE operation_id=?", deadID).Scan(&visible); err != nil || visible != 0 {
		t.Fatal("materialization committed early", visible, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_dead_letter WHERE operation_id=?", deadID).Scan(&visible); err != nil || visible != 0 {
		t.Fatal("materialization survived rollback", visible, err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	candidates, err := r.ListPendingDeadLetterActionablesInTransaction(ctx, tx, "TENANT-A", "DEPLOYMENT-A", "aims", 20, now.Add(time.Second))
	if err != nil || len(candidates) != 1 {
		t.Fatal(candidates, err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	c := candidates[0]
	published := MarkDeadLetterActionablePublishedInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: deadID, ActionableKey: c.ActionableKey, ObjectVersion: c.ObjectVersion, NotificationID: "notification-1", Generation: c.Generation, OperationVersion: c.OperationVersion, RecipientUIDs: []string{"user-1"}, Now: now.Add(time.Second)}
	assertSharedNotificationRollback(t, db, "SELECT COUNT(*) FROM u_dead_letter WHERE operation_id=? AND publish_acked_at IS NOT NULL", deadID, func(tx *sql.Tx) error {
		ok, err := r.MarkDeadLetterActionablePublishedInTransaction(ctx, tx, published)
		if err == nil && !ok {
			t.Fatal("publish not accepted")
		}
		return err
	})
	for i := 0; i < 2; i++ {
		tx, err = db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if ok, err := r.MarkDeadLetterActionablePublishedInTransaction(ctx, tx, published); err != nil || !ok {
			t.Fatal(ok, err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	if ok, _, err := r.AuthorizeDeadLetterNotification(ctx, AuthorizeDeadLetterNotificationInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: deadID, NotificationID: "notification-1", SubjectUID: "user-1"}); err != nil || !ok {
		t.Fatal(ok, err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = r.ListPendingFailureNotificationsInTransaction(ctx, tx, "TENANT-A", "DEPLOYMENT-A", "aims", 20); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal("list closed caller transaction", err)
	}
	assertSharedNotificationRollback(t, db, "SELECT COUNT(*) FROM u_operation WHERE operation_id=? AND failure_notified_at IS NOT NULL", deadID, func(tx *sql.Tx) error {
		ok, err := r.MarkFailureNotifiedInTransaction(ctx, tx, MarkFailureNotifiedInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: deadID, NotificationID: "failure-1", Now: now.Add(time.Second)})
		if err == nil && !ok {
			t.Fatal("failure notification not accepted")
		}
		return err
	})
	if _, err = r.ListPendingFailureNotifications(ctx, "TENANT-A", "DEPLOYMENT-A", "aims", 20); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		tx, err = db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if ok, err := r.MarkFailureNotifiedInTransaction(ctx, tx, MarkFailureNotifiedInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: deadID, NotificationID: "failure-1", Now: now.Add(time.Second)}); err != nil || !ok {
			t.Fatal(ok, err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = r.Replay(ctx, ReplayInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: deadID, ExpectedVersion: c.OperationVersion, ActorUID: "user-1", Reason: "retry approved", Now: now.Add(2 * time.Second)}); err != nil {
		t.Fatal(err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if rows, err := r.ListPendingDeadLetterClosuresInTransaction(ctx, tx, "TENANT-A", "DEPLOYMENT-A", "aims", 20); err != nil || len(rows) != 1 {
		t.Fatal(rows, err)
	}
	if err = tx.Rollback(); err != nil {
		t.Fatal("closure list closed caller transaction", err)
	}
	closures, err := r.ListPendingDeadLetterClosures(ctx, "TENANT-A", "DEPLOYMENT-A", "aims", 20)
	if err != nil || len(closures) != 1 {
		t.Fatal(closures, err)
	}
	closure := closures[0]
	ack := MarkDeadLetterClosureAcknowledgedInput{TenantCode: "TENANT-A", DeploymentCode: "DEPLOYMENT-A", SourceApp: "aims", OperationID: deadID, ActionableKey: closure.ActionableKey, ExpectedVersion: closure.ExpectedVersion, NextVersion: closure.NextVersion, State: closure.State, Generation: closure.Generation, Now: now.Add(3 * time.Second)}
	assertSharedNotificationRollback(t, db, "SELECT COUNT(*) FROM u_dead_letter WHERE operation_id=? AND closure_acked_at IS NOT NULL", deadID, func(tx *sql.Tx) error {
		ok, err := r.MarkDeadLetterClosureAcknowledgedInTransaction(ctx, tx, ack)
		if err == nil && !ok {
			t.Fatal("closure not accepted")
		}
		return err
	})
	for i := 0; i < 2; i++ {
		tx, err = db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if ok, err := r.MarkDeadLetterClosureAcknowledgedInTransaction(ctx, tx, ack); err != nil || !ok {
			t.Fatal(ok, err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	// Real target receipt algorithm, replay/hash validation and business atomicity.
	receipts, err := NewReceiptRepository(db, WithReceiptOutboxTables(tables))
	if err != nil {
		t.Fatal(err)
	}
	input := validReceiptCommandInput(t)
	calls := 0
	handler := func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (ReceiptBusinessResult, error) {
		calls++
		_, err := tx.ExecContext(ctx, "INSERT INTO business_checkpoint VALUES('receipt')")
		return ReceiptBusinessResult{TargetBizType: "asset", TargetBizCode: "ASSET-1", HTTPStatus: 200}, err
	}
	first, err := receipts.Execute(ctx, input, handler)
	if err != nil || first.Existing {
		t.Fatal(first, err)
	}
	second, err := receipts.Execute(ctx, input, handler)
	if err != nil || !second.Existing || calls != 1 {
		t.Fatal(second, calls, err)
	}
	input.Command = json.RawMessage(`{"assetCode":"OTHER"}`)
	input.CommandSHA256 = commandDigest(t, input.Command)
	if _, err = receipts.Execute(ctx, input, handler); !errors.Is(err, ErrIdempotencyPayloadMismatch) {
		t.Fatal("receipt mismatch", err)
	}
	// A different tenant cannot reuse another tenant's successful receipt even
	// when presenting its operation ID; the unique operation evidence rejects it.
	isolated := validReceiptCommandInput(t)
	isolated.TrustedContext.TenantCode = "TENANT-B"
	if _, err = receipts.Execute(ctx, isolated, handler); err == nil {
		t.Fatal("cross-tenant receipt replay accepted")
	}
	if calls != 1 {
		t.Fatal("cross-tenant receipt called business handler")
	}
	isolated.OperationID = uuid.NewString()
	_, err = receipts.Execute(ctx, isolated, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (ReceiptBusinessResult, error) {
		if _, err := tx.ExecContext(ctx, "INSERT INTO business_checkpoint VALUES('receipt-rollback')"); err != nil {
			return ReceiptBusinessResult{}, err
		}
		return ReceiptBusinessResult{}, sentinel
	})
	if !errors.Is(err, sentinel) {
		t.Fatal(err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM u_receipt").Scan(&count); err != nil || count != 1 {
		t.Fatal("receipt rollback leaked", count, err)
	}
	if err = db.QueryRow("SELECT COUNT(*) FROM business_checkpoint WHERE id='receipt-rollback'").Scan(&count); err != nil || count != 0 {
		t.Fatal("receipt business rollback leaked", count, err)
	}
	t.Log("canonical four-table DDL, mapped SQL, shared rollback, lease recovery, stale fence, diagnostics, dead-letter publish/closure and receipt replay passed")
}
