package workflow

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWorkflowBoundedOutboxMigrationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_WORKFLOW_OUTBOX_MIGRATION_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe temporary MySQL socket")
	}
	cfg := mysql.NewConfig()
	cfg.User, cfg.Net, cfg.Addr = "root", "unix", socket
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "workflow_outbox_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(statement string) {
		t.Helper()
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	// The pre-013 columns relevant to ALTER and stored state, without unrelated
	// flow tables: a real DDL run against a clean disposable MySQL instance.
	exec(`CREATE TABLE flow_notification_outbox (
		id BIGINT UNSIGNED PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL,
		delivery_status ENUM('pending','delivered') NOT NULL DEFAULT 'pending',
		attempt_count INT UNSIGNED NOT NULL DEFAULT 0, last_attempt_at DATETIME NULL,
		delivered_at DATETIME NULL)`)
	exec(`CREATE TABLE flow_actionable_outbox (
		id BIGINT UNSIGNED PRIMARY KEY, actionable_key VARCHAR(191) NOT NULL,
		prerequisite_notifications JSON NOT NULL,
		delivery_status ENUM('pending','delivered') NOT NULL DEFAULT 'pending',
		attempt_count INT UNSIGNED NOT NULL DEFAULT 0, last_attempt_at DATETIME NULL,
		delivered_at DATETIME NULL)`)
	exec(`CREATE TABLE flow_callback_logs (
		id BIGINT UNSIGNED PRIMARY KEY, idempotency_key VARCHAR(191) NOT NULL,
		status ENUM('success','failed','pending') NOT NULL DEFAULT 'pending',
		attempts INT NOT NULL DEFAULT 0, next_attempt_at DATETIME NULL,
		last_error TEXT NULL)`)
	exec(`INSERT INTO flow_notification_outbox VALUES (1,'notification:key:1','pending',3,NULL,NULL),(2,'notification:key:2','delivered',1,NULL,NOW())`)
	exec(`INSERT INTO flow_actionable_outbox VALUES (1,'old:key','[]','pending',4,NULL,NULL)`)
	exec(`INSERT INTO flow_callback_logs (id,idempotency_key,status,attempts,next_attempt_at) VALUES (1,'callback:key:1','failed',19,NULL)`)

	migration := filepath.Join("..", "..", "..", "..", "workflow", "docs", "migrations")
	for _, file := range []string{"013_bounded_delivery_outbox.sql", "013_bounded_delivery_outbox_verify.sql", "014_delivery_recovery_attribution.sql", "014_delivery_recovery_attribution_verify.sql"} {
		content, readErr := os.ReadFile(filepath.Join(migration, file))
		if readErr != nil {
			t.Fatal(readErr)
		}
		var sqlLines []string
		for _, line := range strings.Split(string(content), "\n") {
			if !strings.HasPrefix(strings.TrimSpace(line), "--") {
				sqlLines = append(sqlLines, line)
			}
		}
		for _, statement := range strings.Split(strings.Join(sqlLines, "\n"), ";") {
			statement = strings.TrimSpace(statement)
			if statement == "" {
				continue
			}
			if strings.HasSuffix(file, "_verify.sql") {
				var result string
				if err := db.QueryRow(statement).Scan(&result); err != nil || result != "PASS" {
					t.Fatalf("%s verification: result=%q error=%v", file, result, err)
				}
			} else {
				exec(statement)
			}
		}
	}

	var key, status string
	var attempts, version int
	var dependency sql.NullInt64
	if err := db.QueryRow(`SELECT idempotency_key,delivery_status,attempt_count,version_no FROM flow_notification_outbox WHERE id=1`).Scan(&key, &status, &attempts, &version); err != nil || key != "notification:key:1" || status != "pending" || attempts != 3 || version != 1 {
		t.Fatalf("notification state changed: %q %q %d %d %v", key, status, attempts, version, err)
	}
	if err := db.QueryRow(`SELECT depends_on_notification_outbox_id,delivery_status,attempt_count,version_no FROM flow_actionable_outbox WHERE id=1`).Scan(&dependency, &status, &attempts, &version); err != nil || dependency.Valid || status != "pending" || attempts != 4 || version != 1 {
		t.Fatalf("legacy dependency inferred or state changed: %+v %q %d %d %v", dependency, status, attempts, version, err)
	}
	if err := db.QueryRow(`SELECT idempotency_key,status,attempts,version_no FROM flow_callback_logs WHERE id=1`).Scan(&key, &status, &attempts, &version); err != nil || key != "callback:key:1" || status != "failed" || attempts != 19 || version != 1 {
		t.Fatalf("callback state changed: %q %q %d %d %v", key, status, attempts, version, err)
	}
	exec(`UPDATE flow_actionable_outbox SET depends_on_notification_outbox_id=1,delivery_status='abandoned',abandoned_at=NOW(),version_no=2 WHERE id=1`)
	exec(`UPDATE flow_notification_outbox SET delivery_status='abandoned',abandoned_at=NOW() WHERE id=1`)
	exec(`UPDATE flow_callback_logs SET status='abandoned',abandoned_at=NOW() WHERE id=1`)
	var pending int
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_actionable_outbox WHERE delivery_status='pending'`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("old binary would claim abandoned effect: %d %v", pending, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_notification_outbox WHERE delivery_status='pending'`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("old binary would claim abandoned notification: %d %v", pending, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_callback_logs WHERE status IN ('pending','failed') AND attempts < 20`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("old binary would claim abandoned callback: %d %v", pending, err)
	}
	exec(`INSERT INTO flow_delivery_audit(delivery_kind,effect_id,event_code,prior_status,next_status,prior_version_no,next_version_no,attempt_count,actor_code,reason_code,tenant_code,deployment_code) VALUES('actionable',1,'abandon','pending','abandoned',1,2,12,'workflow.runtime','actionable_not_found','C000001','test-workflow')`)

	// Exercise the actual claim query after 013. A delivered dependency from a
	// different instance must never release this instance's lifecycle effect.
	exec(`ALTER TABLE flow_notification_outbox
		ADD COLUMN instance_id BIGINT NULL, ADD COLUMN action_id BIGINT NULL,
		ADD COLUMN actionable_key VARCHAR(191) NULL, ADD COLUMN notification JSON NULL,
		ADD COLUMN created_at DATETIME NULL, ADD COLUMN updated_at DATETIME NULL`)
	exec(`ALTER TABLE flow_actionable_outbox
		ADD COLUMN instance_id BIGINT NULL, ADD COLUMN action_id BIGINT NULL,
		ADD COLUMN expected_version VARCHAR(191) NULL, ADD COLUMN next_version VARCHAR(191) NULL,
		ADD COLUMN next_state VARCHAR(32) NULL, ADD COLUMN recipients JSON NULL,
		ADD COLUMN created_at DATETIME NULL, ADD COLUMN updated_at DATETIME NULL`)
	exec(`ALTER TABLE flow_callback_logs ADD COLUMN created_at DATETIME NULL, ADD COLUMN updated_at DATETIME NULL`)
	exec(`INSERT INTO flow_notification_outbox
		(id,idempotency_key,instance_id,action_id,actionable_key,delivery_status,notification)
		VALUES
		(3,'cross-instance',99,7,'workflow:tasks:next','delivered','{}'),
		(4,'same-instance',100,7,'workflow:tasks:next','pending','{}')`)
	exec(`INSERT INTO flow_actionable_outbox
		(id,instance_id,action_id,actionable_key,expected_version,next_version,next_state,recipients,prerequisite_notifications,depends_on_notification_outbox_id)
		VALUES
		(3,100,7,'workflow:tasks:old','v1','v2','resolved','["u1"]','[]',3),
		(4,100,7,'workflow:tasks:old','v1','v2','resolved','["u1"]','[]',4)`)
	adapter := &Adapter{db: db}
	claim, _, err := adapter.pendingActionableLifecycleOutbox(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(claim.Data.([]WorkflowActionableLifecycle)); got != 0 {
		t.Fatalf("cross-instance or pending notification released lifecycle: %d", got)
	}
	exec(`UPDATE flow_notification_outbox SET delivery_status='delivered' WHERE id=4`)
	claim, _, err = adapter.pendingActionableLifecycleOutbox(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	effects := claim.Data.([]WorkflowActionableLifecycle)
	if len(effects) != 1 || effects[0].EffectID != 4 {
		t.Fatalf("only same-instance delivered dependency may release lifecycle: %#v", effects)
	}

	// Two NULL action IDs are not evidence of the same action. An unrelated
	// undelivered notification must not hold a lifecycle without a frozen
	// dependency or matching actionable key.
	exec(`INSERT INTO flow_notification_outbox
		(id,idempotency_key,instance_id,action_id,actionable_key,delivery_status,notification)
		VALUES (5,'unrelated-null-action',100,NULL,'workflow:tasks:unrelated','pending','{}')`)
	exec(`INSERT INTO flow_actionable_outbox
		(id,instance_id,action_id,actionable_key,expected_version,next_version,next_state,recipients,prerequisite_notifications)
		VALUES (6,100,NULL,'workflow:tasks:other','v1','v2','resolved','["u1"]','[]')`)
	claim, _, err = adapter.pendingActionableLifecycleOutbox(context.Background(), 100)
	if err != nil {
		t.Fatal(err)
	}
	effects = claim.Data.([]WorkflowActionableLifecycle)
	if len(effects) != 2 || effects[0].EffectID != 4 || effects[1].EffectID != 6 {
		t.Fatalf("unrelated NULL action notification blocked lifecycle: %#v", effects)
	}

	// The read-only blocked count uses the same dependency and notification
	// predicates as the claim query. An abandoned prerequisite stays pending
	// and is counted even though its lifecycle attempt budget does not advance.
	exec(`UPDATE flow_notification_outbox SET instance_id=100 WHERE id=1`)
	exec(`UPDATE flow_actionable_outbox SET delivery_status='pending', instance_id=100, depends_on_notification_outbox_id=1 WHERE id=1`)
	var blocked, abandoned int
	if err := db.QueryRow(`
		SELECT COUNT(*), COALESCE(SUM(CASE WHEN dependency.instance_id = o.instance_id
			AND dependency.delivery_status = 'abandoned' THEN 1 ELSE 0 END), 0)
		FROM flow_actionable_outbox o
		LEFT JOIN flow_notification_outbox dependency ON dependency.id = o.depends_on_notification_outbox_id
		WHERE o.delivery_status = 'pending'
		  AND ((o.depends_on_notification_outbox_id IS NOT NULL
			AND (dependency.id IS NULL OR dependency.instance_id <> o.instance_id OR dependency.delivery_status <> 'delivered'))
			OR EXISTS (SELECT 1 FROM flow_notification_outbox n WHERE n.instance_id = o.instance_id
				AND (n.actionable_key = o.actionable_key OR (o.action_id IS NOT NULL AND n.action_id = o.action_id))
				AND n.delivery_status <> 'delivered'))
	`).Scan(&blocked, &abandoned); err != nil || blocked != 2 || abandoned != 1 {
		t.Fatalf("blocked dependency count must include abandoned prerequisite: blocked=%d abandoned=%d error=%v", blocked, abandoned, err)
	}
	statusResponse, _, err := adapter.workflowDeliveryStatus(context.Background(), "C000001", "test-workflow")
	if err != nil {
		t.Fatal(err)
	}
	statusData := statusResponse.Data.(map[string]any)
	if statusData["dependencyBlocked"] != int64(2) || statusData["abandonedDependencyBlocked"] != int64(1) {
		t.Fatalf("diagnostic dependency counts disagree with claim predicate: %#v", statusData)
	}

	// At the exact threshold, all three types transition atomically to a
	// terminal state with fixed-code audit. A repeated failure cannot revive
	// them or add another audit event.
	exec(`INSERT INTO flow_notification_outbox
		(id,idempotency_key,delivery_status,attempt_count,instance_id,actionable_key,notification)
		VALUES (7,'bounded-notification','pending',11,100,'workflow:tasks:bounded','{}')`)
	exec(`INSERT INTO flow_actionable_outbox
		(id,actionable_key,prerequisite_notifications,delivery_status,attempt_count,instance_id)
		VALUES (8,'workflow:tasks:bounded','[]','pending',11,100)`)
	exec(`INSERT INTO flow_callback_logs (id,idempotency_key,status,attempts)
		VALUES (2,'bounded-callback','failed',19)`)
	trusted := map[string]any{
		"code": "actionable_not_found", "http_status": 404,
		"hzy_runtime_tenant_code": "C000001", "hzy_runtime_deployment_code": "test-workflow", "hzy_runtime_service_client_id": "workflow.runtime", "expectedEffectVersion": int64(1),
	}
	if _, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "7", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.failActionableLifecycleOutbox(context.Background(), "8", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.failWorkflowCallback(context.Background(), "2", trusted); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		table, statusColumn, attemptsColumn string
		id                                  int
	}{
		{"flow_notification_outbox", "delivery_status", "attempt_count", 7},
		{"flow_actionable_outbox", "delivery_status", "attempt_count", 8},
		{"flow_callback_logs", "status", "attempts", 2},
	} {
		var resultStatus, reason string
		var count, rowVersion, httpStatus int
		query := "SELECT " + item.statusColumn + "," + item.attemptsColumn + ",version_no,last_error_code,last_http_status FROM " + item.table + " WHERE id=?"
		if err := db.QueryRow(query, item.id).Scan(&resultStatus, &count, &rowVersion, &reason, &httpStatus); err != nil || resultStatus != "abandoned" || rowVersion != 2 || reason != "actionable_not_found" || httpStatus != 404 {
			t.Fatalf("bounded failure for %s: status=%q attempts=%d version=%d reason=%q http=%d err=%v", item.table, resultStatus, count, rowVersion, reason, httpStatus, err)
		}
		if (item.table == "flow_callback_logs" && count != 20) || (item.table != "flow_callback_logs" && count != 12) {
			t.Fatalf("wrong terminal attempt count for %s: %d", item.table, count)
		}
	}
	if _, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "7", trusted); err != nil {
		t.Fatal(err)
	}
	var auditCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit WHERE event_code='abandon' AND effect_id IN (2,7,8)`).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatalf("expected one abandon audit per terminal effect: %d %v", auditCount, err)
	}
	recovery := map[string]any{
		"hzy_runtime_tenant_code": "C000001", "hzy_runtime_deployment_code": "test-workflow",
		"hzy_runtime_service_client_id": "workflow.maintenance", "hzy_runtime_credential_id": int64(41),
		"hzy_runtime_request_id": "recovery-test-1", "reason": "operator approved bounded recovery", "expectedVersion": int64(2),
	}
	recovery["expectedVersion"] = int64(1)
	if _, _, err := adapter.recoverWorkflowDelivery(context.Background(), workflowNotificationDelivery, "7", recovery); err == nil {
		t.Fatal("stale recovery version accepted")
	} else if known, ok := err.(httperror.Error); !ok || known.Status != 409 {
		t.Fatalf("stale recovery should be 409, got %v", err)
	}
	recovery["expectedVersion"] = int64(2)
	for _, item := range []struct {
		kind  workflowDeliveryKind
		id    string
		table string
		key   string
	}{
		{workflowNotificationDelivery, "7", "flow_notification_outbox", "bounded-notification"},
		{workflowActionableDelivery, "8", "flow_actionable_outbox", "workflow:tasks:bounded"},
		{workflowCallbackDelivery, "2", "flow_callback_logs", "bounded-callback"},
	} {
		if _, _, err := adapter.recoverWorkflowDelivery(context.Background(), item.kind, item.id, recovery); err != nil {
			t.Fatal(err)
		}
		var restoredStatus, restoredKey string
		var restoredAttempts, restoredVersion int
		keyColumn := "idempotency_key"
		if item.kind.label == "actionable" {
			keyColumn = "actionable_key"
		}
		query := "SELECT " + item.kind.statusColumn + "," + item.kind.attemptColumn + ",version_no," + keyColumn + " FROM " + item.table + " WHERE id=?"
		if err := db.QueryRow(query, item.id).Scan(&restoredStatus, &restoredAttempts, &restoredVersion, &restoredKey); err != nil || restoredStatus != "pending" || restoredAttempts != 0 || restoredVersion != 3 || restoredKey != item.key {
			t.Fatalf("recovery changed key or failed to reset retry: %s %q %d %d %q %v", item.table, restoredStatus, restoredAttempts, restoredVersion, restoredKey, err)
		}
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit WHERE event_code='recover' AND actor_code='workflow.maintenance' AND credential_id=41 AND request_id='recovery-test-1' AND recovery_reason='operator approved bounded recovery' AND reason_code='manual_recovery' AND prior_version_no=2 AND next_version_no=3`).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatalf("expected exactly one recovery audit per effect: %d %v", auditCount, err)
	}
	trusted["expectedEffectVersion"] = int64(3)
	if _, _, err := adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "7", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.acknowledgeActionableLifecycleOutbox(context.Background(), "8", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.acknowledgeWorkflowCallback(context.Background(), "2", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "7", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "7", trusted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit WHERE event_code='ack' AND effect_id IN (2,7,8)`).Scan(&auditCount); err != nil || auditCount != 3 {
		t.Fatalf("ack replay duplicated audit: %d %v", auditCount, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit WHERE delivery_kind='notification' AND effect_id=7 AND event_code IN ('retry','abandon')`).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("failure after acknowledgement changed retry budget: %d %v", auditCount, err)
	}

	exec(`INSERT INTO flow_notification_outbox
		(id,idempotency_key,delivery_status,attempt_count,instance_id,actionable_key,notification)
		VALUES (9,'concurrent-notification','pending',11,100,'workflow:tasks:concurrent','{}')`)
	trusted["expectedEffectVersion"] = int64(1)
	var race sync.WaitGroup
	race.Add(2)
	go func() {
		defer race.Done()
		if _, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "9", trusted); err != nil {
			t.Errorf("concurrent fail: %v", err)
		}
	}()
	go func() {
		defer race.Done()
		_, _, _ = adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "9", trusted)
	}()
	race.Wait()
	var racedStatus string
	var racedVersion int
	if err := db.QueryRow(`SELECT delivery_status,version_no FROM flow_notification_outbox WHERE id=9`).Scan(&racedStatus, &racedVersion); err != nil || racedVersion != 2 || (racedStatus != "delivered" && racedStatus != "abandoned") {
		t.Fatalf("concurrent fail/ack produced invalid state: %s version=%d err=%v", racedStatus, racedVersion, err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit WHERE delivery_kind='notification' AND effect_id=9`).Scan(&auditCount); err != nil || auditCount != 1 {
		t.Fatalf("concurrent fail/ack must have one state transition audit: %d %v", auditCount, err)
	}

	// Both workers observed the same version before either reported a failed
	// external attempt. Only one failure may consume the retry budget, for all
	// three durable effect kinds, including just before the terminal threshold.
	exec(`INSERT INTO flow_notification_outbox
		(id,idempotency_key,delivery_status,attempt_count,instance_id,actionable_key,notification)
		VALUES (10,'same-attempt-notification','pending',10,100,'workflow:tasks:same-attempt','{}')`)
	exec(`INSERT INTO flow_actionable_outbox
		(id,actionable_key,prerequisite_notifications,delivery_status,attempt_count,instance_id)
		VALUES (11,'workflow:tasks:same-attempt','[]','pending',10,100)`)
	exec(`INSERT INTO flow_callback_logs (id,idempotency_key,status,attempts)
		VALUES (3,'same-attempt-callback','failed',18)`)
	for _, item := range []struct {
		kind     workflowDeliveryKind
		id       string
		status   string
		attempts int
	}{
		{workflowNotificationDelivery, "10", "pending", 11},
		{workflowActionableDelivery, "11", "pending", 11},
		{workflowCallbackDelivery, "3", "failed", 19},
	} {
		var pair sync.WaitGroup
		results := make(chan map[string]any, 2)
		errors := make(chan error, 2)
		pair.Add(2)
		for i := 0; i < 2; i++ {
			go func() {
				defer pair.Done()
				response, _, err := adapter.failWorkflowDelivery(context.Background(), item.kind, item.id, trusted)
				if err != nil {
					errors <- err
					return
				}
				results <- response.Data.(map[string]any)
			}()
		}
		pair.Wait()
		close(results)
		close(errors)
		for err := range errors {
			t.Fatalf("same observed version fail returned error for %s: %v", item.kind.label, err)
		}
		conflicts := 0
		for result := range results {
			if result["versionConflict"] == true {
				conflicts++
			}
		}
		if conflicts != 1 {
			t.Fatalf("expected one stale failure checkpoint for %s, got %d", item.kind.label, conflicts)
		}
		var status string
		var attempts, version, audits int
		query := "SELECT " + item.kind.statusColumn + "," + item.kind.attemptColumn + ",version_no FROM " + item.kind.table + " WHERE id=?"
		if err := db.QueryRow(query, item.id).Scan(&status, &attempts, &version); err != nil || status != item.status || attempts != item.attempts || version != 2 {
			t.Fatalf("duplicate fail consumed retry budget for %s: status=%s attempts=%d version=%d err=%v", item.kind.label, status, attempts, version, err)
		}
		if err := db.QueryRow(`SELECT COUNT(*) FROM flow_delivery_audit WHERE delivery_kind=? AND effect_id=? AND event_code='retry'`, item.kind.label, item.id).Scan(&audits); err != nil || audits != 1 {
			t.Fatalf("duplicate fail wrote audit for %s: count=%d err=%v", item.kind.label, audits, err)
		}
	}

	// Failure may checkpoint first, while another sender has already delivered
	// the same external key. Ack still wins while the effect remains pending.
	exec(`INSERT INTO flow_notification_outbox
		(id,idempotency_key,delivery_status,attempt_count,instance_id,actionable_key,notification)
		VALUES (12,'fail-then-success','pending',0,100,'workflow:tasks:fail-then-success','{}')`)
	if _, _, err := adapter.failWorkflowNotificationOutbox(context.Background(), "12", trusted); err != nil {
		t.Fatal(err)
	}
	if _, _, err := adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "12", trusted); err != nil {
		t.Fatalf("successful delivery could not ack after concurrent failure: %v", err)
	}
	if _, _, err := adapter.acknowledgeWorkflowNotificationOutbox(context.Background(), "12", trusted); err != nil {
		t.Fatalf("delivered ack replay failed: %v", err)
	}
	var finalStatus string
	var finalAttempts, finalVersion int
	if err := db.QueryRow(`SELECT delivery_status,attempt_count,version_no FROM flow_notification_outbox WHERE id=12`).Scan(&finalStatus, &finalAttempts, &finalVersion); err != nil || finalStatus != "delivered" || finalAttempts != 1 || finalVersion != 3 {
		t.Fatalf("fail/ack interleaving lost delivery: %s attempts=%d version=%d err=%v", finalStatus, finalAttempts, finalVersion, err)
	}
}
