package enterprisescheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSchedulerRegistryMappedCompletionMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_SCHEDULER_TEST_SOCKET")
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
	schema := "hzy_scheduler_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	mapping := map[string]string{}
	var renames []string
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
		exec(string(ddl)[start : start+end])
		mapping[name] = "u_" + name
		renames = append(renames, "`"+name+"` TO `u_"+name+"`")
	}
	exec("RENAME TABLE " + strings.Join(renames, ","))
	schedulerCompletionTables(t, db, mapping)

	// No compatibility view: a conflicting logical table must remain untouched.
	exec("CREATE TABLE integration_operation LIKE u_integration_operation")
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-a','v1',1)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-owner", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified}}}
	ctx := context.Background()
	register := func(binding e.Binding) *e.Registry {
		t.Helper()
		r := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
		if err := r.Register(ctx, binding); err != nil {
			t.Fatal(err)
		}
		return r
	}
	registry := register(b)
	q := e.ResolveRequest{Key: b.Key, Domain: "aims", OwnerDeployment: "aims-owner", SchemaVersion: "v1", Generation: 1, Operation: e.Scheduler}
	resolved, err := registry.Resolve(q)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(q, resolved, "real-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := New(registry, b, source); err == nil {
		t.Fatal("missing completion views accepted")
	}
	schedulerCompletionViews(t, db, b)
	service, err := New(registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	identity := e.SchedulerIdentity{Tenant: "tenant-a", Deployment: "real-aims-worker", SourceApp: "aims", ClientID: "aims.runtime", Subject: "aims.runtime"}

	now := time.Now().UTC().Truncate(time.Millisecond)
	worker := "aims:aims.runtime:completion-request"
	const ticketCode = "aims.work-item.ticket-result.v1"
	const weeklyCode = "aims.company-weekly-summary.codocs-publish.v1"
	insert := func(key, code string, command map[string]any) (string, map[string]any) {
		t.Helper()
		id := uuid.NewString()
		raw, _ := json.Marshal(command)
		digest, err := io.ValidateAndDigestCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		target, bizType, bizCode := "altoc", "service_ticket", "ST-1"
		if code == weeklyCode {
			target, bizType, bizCode = "codocs", "company_weekly_summary_document", "2026-W38"
		}
		exec("INSERT INTO u_integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,next_attempt_at) VALUES(?,?,?,'tenant-a','real-aims-worker','aims',?,?,'test.capability','request','R-1',?,?,?,?)", id, key, key, target, code, key, string(raw), digest, now)
		claimed, err := service.Claim(ctx, identity, key, worker, now, time.Minute)
		if err != nil || claimed == nil {
			t.Fatal("claim", err)
		}
		return id, map[string]any{"operationId": id, "fencingToken": claimed.FencingToken, "httpStatus": 200, "targetReceiptId": uuid.NewString(), "receiptOperationId": id, "receiptOperationCode": code, "receiptIdempotencyKey": key, "receiptCommandSchemaVersion": "v1", "receiptCommandSha256": digest, "targetBizType": bizType, "targetBizCode": bizCode, "responseSummarySha256": strings.Repeat("b", 64)}
	}
	assertProcessing := func(id string) {
		t.Helper()
		var status string
		var finished int
		if err := db.QueryRow("SELECT status FROM u_integration_operation WHERE operation_id=?", id).Scan(&status); err != nil || status != "processing" {
			t.Fatal("operation mutated", status, err)
		}
		if err := db.QueryRow("SELECT COUNT(*) FROM u_integration_operation_attempt WHERE operation_id=? AND finished_at IS NOT NULL", id).Scan(&finished); err != nil || finished != 0 {
			t.Fatal("attempt mutated", finished, err)
		}
	}
	ticket := map[string]any{"ticketCode": "ST-1", "workItemKey": "WI-1", "deliveryStatus": "closed"}
	id, body := insert("ticket-success", ticketCode, ticket)
	for _, name := range []string{"tenant", "key", "worker", "fence", "target", "digest", "receipt-operation"} {
		badIdentity, badKey, badWorker := identity, "ticket-success", worker
		badBody := map[string]any{}
		for k, v := range body {
			badBody[k] = v
		}
		switch name {
		case "tenant":
			badIdentity.Tenant = "tenant-b"
		case "key":
			badKey = "other"
		case "worker":
			badWorker = "other"
		case "fence":
			badBody["fencingToken"] = uint64(999)
		case "target":
			badBody["targetBizCode"] = "ST-OTHER"
		case "digest":
			badBody["receiptCommandSha256"] = strings.Repeat("a", 64)
		case "receipt-operation":
			badBody["receiptOperationId"] = uuid.NewString()
		}
		if _, err = service.Succeed(ctx, badIdentity, badWorker, badKey, badBody, now.Add(time.Second)); err == nil {
			t.Fatal("accepted", name)
		}
		assertProcessing(id)
	}
	if _, err = service.Succeed(ctx, identity, worker, "ticket-success", body, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var status, receipt string
	if err = db.QueryRow("SELECT status,target_receipt_id FROM u_integration_operation WHERE operation_id=?", id).Scan(&status, &receipt); err != nil || status != "succeeded" || receipt != body["targetReceiptId"] {
		t.Fatal(status, receipt, err)
	}
	if _, err = service.Fail(ctx, identity, worker, "ticket-success", body, now.Add(2*time.Second)); err == nil {
		t.Fatal("late failure accepted")
	}
	// The provider commits its side effect but the first worker loses the
	// response before source ACK. A restarted worker queries the target receipt
	// by the frozen command identity and must not repeat the provider mutation.
	lostID, lostBody := insert("ticket-response-lost", ticketCode, ticket)
	mutations := 0
	targetReceipts := map[string]io.ReceiptEvidence{}
	expectedReceipt := io.ReceiptEvidence{
		OperationID: lostID, OperationCode: ticketCode, IdempotencyKey: "ticket-response-lost",
		CommandSchemaVersion: "v1", CommandSHA256: lostBody["receiptCommandSha256"].(string),
		TargetBizType: "service_ticket", TargetBizCode: "ST-1", ResponseSummarySHA256: strings.Repeat("b", 64),
	}
	firstProvider := &fakeRecoverableProvider{receipts: targetReceipts, mutations: &mutations, loseNext: true}
	if _, _, err = DeliverOrRecover(ctx, firstProvider, expectedReceipt, []byte(`{"ticketCode":"ST-1"}`)); !errors.Is(err, errFakeResponseLost) {
		t.Fatal("expected provider response loss", err)
	}
	restartedProvider := &fakeRecoverableProvider{receipts: targetReceipts, mutations: &mutations}
	recoveredReceipt, recovered, recoverErr := DeliverOrRecover(ctx, restartedProvider, expectedReceipt, []byte(`{"ticketCode":"ST-1"}`))
	if recoverErr != nil || !recovered || mutations != 1 {
		t.Fatal("target receipt recovery", recovered, mutations, recoverErr)
	}
	lostBody["targetReceiptId"] = recoveredReceipt.ReceiptID
	if _, err = service.Succeed(ctx, identity, worker, "ticket-response-lost", lostBody, now.Add(3*time.Second)); err != nil {
		t.Fatal("source ACK after receipt recovery", err)
	}
	if err = db.QueryRow("SELECT status,target_receipt_id FROM u_integration_operation WHERE operation_id=?", lostID).Scan(&status, &receipt); err != nil || status != "succeeded" || receipt != recoveredReceipt.ReceiptID {
		t.Fatal("recovered operation was not confirmed", status, receipt, err)
	}
	// Failure after outbox+attempt updates must roll back when the source checkpoint fails.
	weekly := map[string]any{"periodKey": "2026-W38", "summaryVersionId": 1, "markdownSha256": strings.Repeat("c", 64)}
	setup, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = setup.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	if _, err = setup.ExecContext(ctx, "INSERT INTO u_company_weekly_summary_versions(id,summary_id,revision_no,structured_snapshot_json,structured_sha256,markdown_content,markdown_sha256,publish_status) VALUES(1,1,1,JSON_OBJECT(),?,'fixture',?,'pending')", strings.Repeat("c", 64), strings.Repeat("c", 64)); err != nil {
		t.Fatal(err)
	}
	if _, err = setup.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatal(err)
	}
	setup.Close()
	weeklyID, weeklyBody := insert("weekly-failure", weeklyCode, weekly)
	weeklyBody["httpStatus"] = 403
	exec("CREATE TRIGGER checkpoint_failure BEFORE UPDATE ON u_company_weekly_summary_versions FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='checkpoint failure'")
	if _, err = service.Fail(ctx, identity, worker, "weekly-failure", weeklyBody, now.Add(time.Second)); err == nil {
		t.Fatal("checkpoint failure accepted")
	}
	assertProcessing(weeklyID)
	exec("DROP TRIGGER checkpoint_failure")
	if _, err = service.Fail(ctx, identity, worker, "weekly-failure", weeklyBody, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	var checkpoint string
	if err = db.QueryRow("SELECT publish_status FROM u_company_weekly_summary_versions WHERE id=1").Scan(&checkpoint); err != nil || checkpoint != "failed" {
		t.Fatal(checkpoint, err)
	}
	if err = db.QueryRow("SELECT status FROM u_integration_operation WHERE operation_id=?", weeklyID).Scan(&status); err != nil || status != "failed_permanent" {
		t.Fatal(status, err)
	}
	// Frozen receipt is valid, but absent document checkpoint fields fail only after repository writes.
	lateID, lateBody := insert("weekly-late-success", weeklyCode, weekly)
	if _, err = service.Succeed(ctx, identity, worker, "weekly-late-success", lateBody, now.Add(time.Second)); err == nil || !strings.Contains(err.Error(), "Codocs document receipt is incomplete") {
		t.Fatal("expected late source checkpoint failure", err)
	}
	assertProcessing(lateID)
	var decoys int
	if err = db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&decoys); err != nil || decoys != 0 {
		t.Fatal("logical decoy touched", decoys, err)
	}
	notificationID, notificationBody := insert("notification-dead", ticketCode, ticket)
	exec("UPDATE u_integration_operation SET max_attempts=1 WHERE operation_id=?", notificationID)
	notificationBody["httpStatus"] = 503
	if _, err = service.Fail(ctx, identity, worker, "notification-dead", notificationBody, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	// Notification operations use the same generation guard before materialization/ACK.
	checkNotificationDenied := func(who e.SchedulerIdentity) {
		t.Helper()
		if _, err := service.ListPendingFailureNotifications(ctx, who, 20); err == nil {
			t.Fatal("failure list bypassed guard")
		}
		if _, err := service.ListPendingDeadLetterActionables(ctx, who, 20, now); err == nil {
			t.Fatal("actionable list bypassed guard")
		}
		if _, err := service.ListPendingDeadLetterClosures(ctx, who, 20); err == nil {
			t.Fatal("closure list bypassed guard")
		}
		if _, err := service.MarkFailureNotified(ctx, who, io.MarkFailureNotifiedInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: who.SourceApp, OperationID: notificationID, NotificationID: "n", Now: now}); err == nil {
			t.Fatal("failure ACK bypassed guard")
		}
		if _, err := service.MarkDeadLetterActionablePublished(ctx, who, io.MarkDeadLetterActionablePublishedInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: who.SourceApp, OperationID: notificationID, Now: now}); err == nil {
			t.Fatal("publish ACK bypassed guard")
		}
		if _, err := service.MarkDeadLetterClosureAcknowledged(ctx, who, io.MarkDeadLetterClosureAcknowledgedInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: who.SourceApp, OperationID: notificationID, Now: now}); err == nil {
			t.Fatal("closure ACK bypassed guard")
		}
	}
	other := identity
	other.Tenant = "tenant-b"
	checkNotificationDenied(other)
	exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
	checkNotificationDenied(identity)
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	if _, err := service.ListPendingFailureNotifications(ctx, identity, 20); err != nil {
		t.Fatal(err)
	}
	if ok, err := service.MarkFailureNotified(ctx, identity, io.MarkFailureNotifiedInput{TenantCode: identity.Tenant, DeploymentCode: identity.Deployment, SourceApp: identity.SourceApp, OperationID: notificationID, NotificationID: "failure-committed", Now: now}); err != nil || !ok {
		t.Fatal(ok, err)
	}
	var notification string
	if err = db.QueryRow("SELECT failure_notification_id FROM u_integration_operation WHERE operation_id=?", notificationID).Scan(&notification); err != nil || notification != "failure-committed" {
		t.Fatal(notification, err)
	}

}
