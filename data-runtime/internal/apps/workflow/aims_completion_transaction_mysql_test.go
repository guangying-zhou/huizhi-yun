package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	iop "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestAimsCompletionApprovalTransactionMySQL(t *testing.T) {
	socket := os.Getenv("HZY_WORKFLOW_COMPLETION_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
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
	name := "hzy_completion_tx_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	mc.DBName = name
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
	schema, err := os.ReadFile("../../../../workflow/docs/workflow_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec("SET FOREIGN_KEY_CHECKS=0")
	statements := regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(schema), -1)
	if len(statements) < 10 {
		t.Fatal("canonical Workflow schema incomplete")
	}
	for _, ddl := range statements {
		exec(ddl[0])
	}
	exec("SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(8)
	manualNodes := `[{"name":"人工审批","type":"approve","approve_mode":"any","assignees":[{"type":"user","uid":"REVIEWER"}]}]`
	exec("INSERT INTO flow_schemas(id,code,name,nodes,config,created_by) VALUES(1,'completion','Completion',?,JSON_OBJECT('allow_withdraw',true,'allow_resubmit',true),'ADMIN')", manualNodes)
	exec("INSERT INTO flow_action_defs(id,app_code,resource_code,action_code,name,created_by) VALUES(1,'aims','tasks','complete','Complete target','ADMIN')")
	exec("INSERT INTO flow_routes(id,action_def_id,flow_schema_id,name,is_default,created_by) VALUES(1,1,1,'Default',1,'ADMIN')")
	a := &Adapter{db: db, dbName: name}
	ctx := context.Background()
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRow(q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	body := func(request, item int) map[string]any {
		command := completionCommandFixture()
		command["completionRequestId"] = request
		command["workItemId"] = item
		command["workItemKey"] = fmt.Sprint("WI-", item)
		key := fmt.Sprintf("aims:work-item-completion:%d:workflow-submit:v1", request)
		command["idempotencyKey"] = key
		form := command["formData"].(map[string]any)
		form["completionRequestId"] = request
		form["workItemId"] = item
		hash, err := iop.ValidateAndDigestCommand(command)
		if err != nil {
			t.Fatal(err)
		}
		return map[string]any{"current_user": "U1", iop.TrustedTenantCodeKey: "T1", iop.TrustedDeploymentCodeKey: "WORKFLOW", iop.TrustedSourceAppKey: "workflow", iop.TrustedServiceClientIDKey: "workflow.runtime", iop.TrustedRequestIDKey: "request-1", iop.TrustedServiceCommandTenantKey: "T1", iop.TrustedServiceCommandSourceDeploymentKey: "AIMS", iop.TrustedServiceCommandTargetDeploymentKey: "WORKFLOW", iop.TrustedServiceCommandSourceAppKey: "aims", iop.TrustedServiceCommandTargetAppKey: "workflow", iop.TrustedServiceCommandSourceClientKey: "aims.runtime", "serviceCommand": map[string]any{"operationId": fmt.Sprintf("00000000-0000-4000-8000-%012d", request), "operationCode": aimsCompletionWorkflowOperationCode, "targetApp": "workflow", "requiredCapability": aimsCompletionWorkflowCapability, "idempotencyKey": key, "commandSchemaVersion": "v1", "commandSha256": hash, "command": command}}
	}
	for _, mutate := range []func(map[string]any){func(b map[string]any) { b["current_user"] = "OTHER" }, func(b map[string]any) { b[iop.TrustedServiceCommandTenantKey] = "" }, func(b map[string]any) { b[iop.TrustedServiceCommandSourceDeploymentKey] = "" }, func(b map[string]any) { b[iop.TrustedServiceCommandTargetDeploymentKey] = "" }, func(b map[string]any) { b[iop.TrustedServiceCommandSourceAppKey] = "enterprise" }, func(b map[string]any) { b["serviceCommand"].(map[string]any)["requiredCapability"] = "workflow:write" }, func(b map[string]any) {
		b["serviceCommand"].(map[string]any)["command"].(map[string]any)["callbackUrl"] = "https://untrusted.invalid"
	}} {
		b := body(1, 2)
		mutate(b)
		if _, err = a.executeAimsCompletionApproval(ctx, b); err == nil {
			t.Fatal("untrusted identity actor scope or command accepted")
		}
	}
	for _, change := range []func(map[string]any){func(b map[string]any) { b[iop.TrustedTenantCodeKey] = "T2" }, func(b map[string]any) { b[iop.TrustedDeploymentCodeKey] = "OTHER-WORKFLOW" }} {
		b := body(1, 2)
		change(b)
		if _, err := a.executeAimsCompletionApproval(ctx, b); err == nil {
			t.Fatal("nonempty wrong Runtime tenant/deployment accepted")
		}
	}
	if count("SELECT COUNT(*) FROM flow_instances") != 0 || count("SELECT COUNT(*) FROM service_command_receipt") != 0 {
		t.Fatal("negative command wrote instance or receipt")
	}

	t.Run("caller-transaction-rollback-commit-replay", func(t *testing.T) {
		for _, ddl := range statements {
			if ddl[1] == "service_command_receipt" {
				exec(strings.ReplaceAll(strings.Replace(ddl[0], "service_command_receipt", "workflow_service_command_receipt", 1), "chk_scr_", "chk_wf_scr_"))
			}
		}
		repo, err := iop.NewReceiptRepository(db, iop.WithReceiptTable("`workflow_service_command_receipt`"))
		if err != nil {
			t.Fatal(err)
		}
		command := body(80, 800)
		before, _ := json.Marshal(command)
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.executeAimsCompletionApprovalTx(ctx, tx, repo, command); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		// Uncommitted core must not leak through a separate pool connection.
		if count("SELECT COUNT(*) FROM flow_instances WHERE biz_id='800'") != 0 {
			tx.Rollback()
			t.Fatal("core committed caller transaction")
		}
		if err = tx.Rollback(); err != nil {
			t.Fatal(err)
		}
		if count("SELECT COUNT(*) FROM workflow_service_command_receipt WHERE operation_id='00000000-0000-4000-8000-000000000080'") != 0 {
			t.Fatal("receipt escaped rollback")
		}
		tx, err = db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		created, err := a.executeAimsCompletionApprovalTx(ctx, tx, repo, command)
		if err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		tx, err = db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		replay, err := a.executeAimsCompletionApprovalTx(ctx, tx, repo, command)
		if err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
		if created.Data.(map[string]any)["receiptId"] != replay.Data.(map[string]any)["receiptId"] || count("SELECT COUNT(*) FROM flow_instances WHERE biz_id='800'") != 1 {
			t.Fatal("caller-Tx replay duplicated instance")
		}
		after, _ := json.Marshal(command)
		if string(before) != string(after) {
			t.Fatal("core modified caller body/command during retries")
		}
		// Remove the disposable subcase through fixture SQL only; old assertions
		// retain their exact counts and still run on the original independent lane.
		exec("DELETE FROM flow_notification_outbox WHERE instance_id IN (SELECT id FROM flow_instances WHERE biz_id='800')")
		exec("DELETE FROM flow_tasks WHERE instance_id IN (SELECT id FROM flow_instances WHERE biz_id='800')")
		exec("DELETE FROM flow_instances WHERE biz_id='800'")
		exec("DELETE FROM workflow_service_command_receipt WHERE operation_id='00000000-0000-4000-8000-000000000080'")
	})
	first, err := a.executeAimsCompletionApproval(ctx, body(1, 2))
	if err != nil {
		t.Fatal(err)
	}
	firstData := first.Data.(map[string]any)
	firstResult := firstData["result"].(map[string]any)
	firstInstance := firstResult["instance"].(map[string]any)
	replay, err := a.executeAimsCompletionApproval(ctx, body(1, 2))
	if err != nil {
		t.Fatal("response-loss retry", err)
	}
	replayData := replay.Data.(map[string]any)
	replayInstance := replayData["result"].(map[string]any)["instance"].(map[string]any)
	if firstData["receiptId"] != replayData["receiptId"] || anyInt64(firstInstance["instance_id"]) != anyInt64(replayInstance["instance_id"]) || firstInstance["instance_no"] != replayInstance["instance_no"] || count("SELECT COUNT(*) FROM flow_instances WHERE biz_id='2'") != 1 || count("SELECT COUNT(*) FROM flow_tasks") != 1 {
		t.Fatal("same-key retry duplicated or rebound Workflow instance")
	}
	if count("SELECT COUNT(*) FROM flow_notification_outbox o JOIN flow_tasks t ON t.actionable_key = o.actionable_key WHERE o.delivery_status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(o.notification, '$.eventType')) = 'workflow.task.created' AND JSON_CONTAINS(o.notification->'$.touser', JSON_QUOTE('REVIEWER'))") != 1 {
		t.Fatal("instance start must persist exactly one durable task-created notification for the pending task")
	}
	var callbackURL string
	if err = db.QueryRow("SELECT callback_url FROM flow_instances WHERE biz_id='2'").Scan(&callbackURL); err != nil || callbackURL != aimsCompletionWorkflowCallback {
		t.Fatal("fixed callback not persisted", callbackURL, err)
	}
	changed := body(1, 2)
	changedCommand := changed["serviceCommand"].(map[string]any)["command"].(map[string]any)
	changedCommand["bizTitle"] = "Changed"
	changedHash, _ := iop.ValidateAndDigestCommand(changedCommand)
	changed["serviceCommand"].(map[string]any)["commandSha256"] = changedHash
	if _, err = a.executeAimsCompletionApproval(ctx, changed); err == nil {
		t.Fatal("same key different frozen command accepted")
	}
	// An otherwise valid create that cannot persist its succeeded receipt must
	// not leave its business row, task, or effects committed.
	exec("CREATE TRIGGER completion_receipt_fail BEFORE UPDATE ON service_command_receipt FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated receipt failure'")
	_, err = a.executeAimsCompletionApproval(ctx, body(2, 3))
	exec("DROP TRIGGER completion_receipt_fail")
	if err == nil || count("SELECT COUNT(*) FROM flow_instances WHERE biz_id='3'") != 0 || count("SELECT COUNT(*) FROM service_command_receipt WHERE operation_id='00000000-0000-4000-8000-000000000002'") != 0 {
		t.Fatal("receipt failure leaked Workflow instance/task/receipt", err)
	}
	if _, err = a.executeAimsCompletionApproval(ctx, body(2, 3)); err != nil {
		t.Fatal("retry after receipt rollback", err)
	}
	newMatterBody := func() map[string]any {
		matterBody := body(10, 20)
		matterEnvelope := matterBody["serviceCommand"].(map[string]any)
		matterCommand := matterEnvelope["command"].(map[string]any)
		matterCommand["kind"] = "matter"
		matterCommand["formData"].(map[string]any)["kind"] = "matter"
		matterCommand["formData"].(map[string]any)["evidenceSummary"] = map[string]any{"deliverableCount": 1, "requiredDeliverableCount": 1, "commitCount": 0, "timeEntryCount": 1}
		matterKey := "aims:work-item-completion:matter:10:workflow-submit:v2"
		matterCommand["idempotencyKey"] = matterKey
		matterEnvelope["idempotencyKey"] = matterKey
		matterEnvelope["commandSchemaVersion"] = "v2"
		var digestErr error
		matterEnvelope["commandSha256"], digestErr = iop.ValidateAndDigestCommand(matterCommand)
		if digestErr != nil {
			t.Fatal(digestErr)
		}
		return matterBody
	}
	wrongSchema := body(11, 21)
	wrongEnvelope := wrongSchema["serviceCommand"].(map[string]any)
	wrongCommand := wrongEnvelope["command"].(map[string]any)
	wrongCommand["kind"] = "matter"
	wrongCommand["formData"].(map[string]any)["kind"] = "matter"
	wrongCommand["formData"].(map[string]any)["evidenceSummary"] = map[string]any{"deliverableCount": 1, "requiredDeliverableCount": 1, "commitCount": 0, "timeEntryCount": 1}
	wrongEnvelope["commandSha256"], _ = iop.ValidateAndDigestCommand(wrongCommand)
	if _, err = a.executeAimsCompletionApproval(ctx, wrongSchema); err == nil {
		t.Fatal("matter kind with target v1 schema accepted")
	}
	matterFirst, err := a.executeAimsCompletionApproval(ctx, newMatterBody())
	if err != nil {
		t.Fatal("matter workflow request", err)
	}
	matterReplay, err := a.executeAimsCompletionApproval(ctx, newMatterBody())
	if err != nil || matterFirst.Data.(map[string]any)["receiptId"] != matterReplay.Data.(map[string]any)["receiptId"] || count("SELECT COUNT(*) FROM flow_instances WHERE biz_id='20' AND JSON_UNQUOTE(JSON_EXTRACT(form_data,'$.kind'))='matter'") != 1 {
		t.Fatal("matter replay duplicated or lost kind", err)
	}
	// Automatic self approval is the real existing workflow behavior; this
	// action must reject it transactionally, not create an unresolvable review.
	autoNodes := `[{"name":"自动自审批","type":"approve","approve_mode":"any","assignees":[{"type":"initiator"}]}]`
	exec("UPDATE flow_schemas SET nodes=? WHERE id=1", autoNodes)
	_, err = a.executeAimsCompletionApproval(ctx, body(3, 4))
	if err == nil || count("SELECT COUNT(*) FROM flow_instances WHERE biz_id='4'") != 0 || count("SELECT COUNT(*) FROM service_command_receipt WHERE operation_id='00000000-0000-4000-8000-000000000003'") != 0 {
		t.Fatal("automatic approval route did not roll back create and receipt", err)
	}
	exec("UPDATE flow_schemas SET nodes=? WHERE id=1", manualNodes)
	if _, err = a.executeAimsCompletionApproval(ctx, body(3, 4)); err != nil {
		t.Fatal("route corrected retry", err)
	}
	// Verify formal cancellation effects from the real owner-only command, not
	// a fabricated approval actor or callback payload.
	cancelled, _, err := a.cancelInstance(ctx, fmt.Sprint(firstInstance["instance_id"]), map[string]any{"current_user": "U1"})
	if err != nil {
		t.Fatal("actual withdraw", err)
	}
	if cancelled.Effects == nil || len(cancelled.Effects.Callbacks) != 1 || cancelled.Effects.Callbacks[0].Payload["cancellation_actor_uid"] != "U1" {
		raw, _ := json.Marshal(cancelled.Effects)
		t.Fatal("withdraw callback missing trusted actor", string(raw))
	}
	if count("SELECT COUNT(*) FROM flow_callback_logs WHERE instance_id=? AND status='pending'", firstInstance["instance_id"]) != 1 {
		t.Fatal("withdraw callback was not transactionally persisted")
	}
}
