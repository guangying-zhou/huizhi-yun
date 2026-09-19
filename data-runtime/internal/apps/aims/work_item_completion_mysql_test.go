package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"sync"
	"testing"
)

func testEnterpriseWorkItemCompletionMySQL(t *testing.T, ctx context.Context, db *sql.DB, a *Adapter, id EnterpriseProjectUpdateIdentity) {
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,category,leader_uid,lifecycle_status,created_by) VALUES(800,'COMP','Completion','CMP','routine','U1','active','U1')")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(800,'U1','manager','active'),(800,'U2','member','active')")
	seed := func(n int) {
		t.Helper()
		exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(?,800,? ,?,'target','task','Complete target','in_progress')", n, n, fmt.Sprint("COMP-", n))
		exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,parent_id) VALUES(?,800,?,?,'matter','task','Child','completed',?)", n+1, n+1, fmt.Sprint("COMP-", n+1), n)
	}
	version := func(n int) string {
		t.Helper()
		_, v, err := a.EnterpriseWorkItemEditableSnapshot(ctx, fmt.Sprint(n))
		if err != nil {
			t.Fatal(err)
		}
		return v
	}
	count := func(q string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRowContext(ctx, q, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	id.Personnel = nil
	seed(8000)
	input := map[string]any{"expectedVersion": version(8000)}
	for _, mutate := range []func(*EnterpriseProjectUpdateIdentity){func(v *EnterpriseProjectUpdateIdentity) { v.Tenant = "T2" }, func(v *EnterpriseProjectUpdateIdentity) { v.SourceDeployment = "other-host" }, func(v *EnterpriseProjectUpdateIdentity) { v.TargetDeployment = "other-runtime" }, func(v *EnterpriseProjectUpdateIdentity) { v.ActorUID = "U2" }} {
		bad := id
		mutate(&bad)
		bad.IdempotencyKey = "completion-denied"
		if _, err := a.RequestEnterpriseWorkItemCompletion(ctx, bad, "800", "8000", input); err == nil {
			t.Fatal("cross-bound or nonleader completion accepted")
		}
	}
	if _, err := a.RequestEnterpriseWorkItemCompletion(ctx, id, "2", "8000", input); err == nil {
		t.Fatal("cross-project completion accepted")
	}
	writer := a.enterpriseWrites
	a.enterpriseWrites = nil
	if _, err := a.RequestEnterpriseWorkItemCompletion(ctx, id, "800", "8000", input); err == nil {
		t.Fatal("missing writer accepted")
	}
	a.enterpriseWrites = writer
	exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
	if _, err := a.EnterpriseWorkItemCompletionState(ctx, "8000", "U1"); err == nil {
		t.Fatal("stale generation read completion state")
	}
	if _, err := a.RequestEnterpriseWorkItemCompletion(ctx, id, "800", "8000", input); err == nil {
		t.Fatal("stale generation accepted")
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	if count("SELECT COUNT(*) FROM work_item_completion_requests") != 0 {
		t.Fatal("denied completion leaked request")
	}
	id.IdempotencyKey = "completion-first"
	first, err := a.RequestEnterpriseWorkItemCompletion(ctx, id, "800", "8000", input)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := a.RequestEnterpriseWorkItemCompletion(ctx, id, "800", "8000", input)
	if err != nil || first["receiptId"] != replay["receiptId"] {
		t.Fatal("response-loss replay failed", err)
	}
	if _, err = a.RequestEnterpriseWorkItemCompletion(ctx, id, "800", "8000", map[string]any{"expectedVersion": "a"}); err == nil {
		t.Fatal("same key changed input accepted")
	}
	if count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=8000") != 1 || count("SELECT COUNT(*) FROM integration_operation WHERE operation_code=?", workItemCompletionWorkflowOperation) != 1 {
		t.Fatal("completion replay duplicated request or operation")
	}
	childVersion := version(8001)
	editID := id
	editID.IdempotencyKey = "completion-locked-edit"
	if _, err = a.WriteEnterpriseWorkItem(ctx, editID, "800", "8001", "edit", map[string]any{"expectedVersion": childVersion, "title": "Changed child"}); err == nil {
		t.Fatal("frozen child editable during review")
	}
	var requestID int
	var hash string
	var commandJSON []byte
	if err = db.QueryRowContext(ctx, "SELECT id,snapshot_sha256 FROM work_item_completion_requests WHERE work_item_id=8000").Scan(&requestID, &hash); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT command_json FROM integration_operation WHERE operation_code=?", workItemCompletionWorkflowOperation).Scan(&commandJSON); err != nil {
		t.Fatal(err)
	}
	var command map[string]any
	if json.Unmarshal(commandJSON, &command) != nil || !validWorkItemCompletionWorkflowCommand(command) {
		t.Fatal("frozen command invalid")
	}
	callbackBody := func(status string) map[string]any {
		b := enterpriseCompletionStatusBody(EnterpriseProjectCreateIdentity{Tenant: id.Tenant, TargetDeployment: id.TargetDeployment, ActorUID: id.ActorUID, RequestID: "callback"}, "")
		b["event"] = "flow_completed"
		b["instance_id"] = 71
		b["instance_no"] = "WF-71"
		b["app_code"] = "aims"
		b["resource_code"] = "tasks"
		b["action_code"] = "complete"
		b["biz_id"] = "8000"
		b["status"] = status
		b["initiator_uid"] = "U1"
		b["approval_actor_uids"] = []string{"U9"}
		b["non_self_approval_actor_uids"] = []string{"U9"}
		b["approval_operator_uid"] = "U9"
		b["idempotencyKey"] = fmt.Sprintf("workflow:callback:71:flow_completed:%s", status)
		b["form_data"] = map[string]any{"completionRequestId": requestID, "projectId": 800, "workItemId": 8000, "snapshotSha256": hash}
		return b
	}
	for _, mutate := range []func(map[string]any){func(b map[string]any) { b["approval_actor_uids"] = nil }, func(b map[string]any) { b["non_self_approval_actor_uids"] = []string{"U1"} }, func(b map[string]any) { b["approval_operator_uid"] = "U1" }, func(b map[string]any) { b["idempotencyKey"] = "caller-key" }} {
		b := callbackBody("approved")
		mutate(b)
		if _, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, b); err == nil {
			t.Fatal("unverified approval evidence accepted")
		}
	}
	callback, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, callbackBody("approved"))
	if err != nil {
		t.Fatal(err)
	}
	bad := callback
	bad.projectID = 2
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, bad); err == nil {
		t.Fatal("wrong project callback accepted")
	}
	bad = callback
	bad.source.TenantCode = "T2"
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, bad); err == nil {
		t.Fatal("wrong tenant callback accepted")
	}
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, callback); err != nil {
		t.Fatal("callback before ACK", err)
	}
	if result, err := a.ApplyWorkItemCompletionCallback(ctx, callback); err != nil || result["alreadyApplied"] != true {
		t.Fatal("callback replay", result, err)
	}
	tx, _, err := a.beginBoundEnterpriseTransaction(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = completeWorkItemCompletionWorkflowTx(ctx, tx, command, map[string]any{"workflowInstanceId": 71, "workflowInstanceNo": "WF-71", "targetReceiptId": "receipt-71"}); err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if count("SELECT COUNT(*) FROM work_item_completion_requests WHERE id=? AND status='approved' AND target_receipt_id='receipt-71'", requestID) != 1 {
		t.Fatal("late ACK reopened approved request")
	}
	tx, _, err = a.beginBoundEnterpriseTransaction(ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = completeWorkItemCompletionWorkflowTx(ctx, tx, command, map[string]any{"workflowInstanceId": 72, "workflowInstanceNo": "WF-72"})
	tx.Rollback()
	if err == nil {
		t.Fatal("mismatched ACK rebound request")
	}
	if count("SELECT COUNT(*) FROM project_activity_logs WHERE project_id=800 AND action='completion_result' AND actor_uid='U9'") != 1 {
		t.Fatal("approval audit actor or replay invalid")
	}
	seed(8010)
	same := version(8010)
	var wg sync.WaitGroup
	outcomes := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			cmdID := id
			cmdID.IdempotencyKey = fmt.Sprint("completion-concurrent-", i)
			_, err := a.RequestEnterpriseWorkItemCompletion(ctx, cmdID, "800", "8010", map[string]any{"expectedVersion": same})
			outcomes <- err
		}(i)
	}
	wg.Wait()
	close(outcomes)
	success := 0
	for err := range outcomes {
		if err == nil {
			success++
		}
	}
	if success != 1 || count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=8010") != 1 {
		t.Fatal("concurrent completion duplicated")
	}
	var recoveryKey string
	var frozenHash string
	var frozenJSON []byte
	if err = db.QueryRowContext(ctx, "SELECT o.operation_key,o.command_sha256,o.command_json FROM integration_operation o JOIN work_item_completion_requests r ON r.operation_key=o.operation_key WHERE r.work_item_id=8010").Scan(&recoveryKey, &frozenHash, &frozenJSON); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE integration_operation SET status='failed_permanent',version_no=2,last_error_code='workflow_route_not_found' WHERE operation_key=?", recoveryKey)
	state, err := a.EnterpriseWorkItemCompletionState(ctx, "8010", "U1")
	if err != nil {
		t.Fatal(err)
	}
	stateRequest, ok := state["request"].(map[string]any)
	if !ok || state["canReplay"] != true || state["canRequest"] != false || aimsMapText(stateRequest, "status") != "queued" || aimsMapText(stateRequest, "operation_status") != "failed_permanent" || serviceBodyInt(stateRequest, "operation_version") != 2 {
		t.Fatal("completion snapshot mixed request/queue/recovery versions", state)
	}
	recovery := map[string]any{"expectedOperationVersion": 2, "reason": "已修复审批配置"}
	recoverID := id
	recoverID.IdempotencyKey = "completion-recovery"
	for _, change := range []func(*EnterpriseProjectUpdateIdentity){func(v *EnterpriseProjectUpdateIdentity) { v.ActorUID = "U2" }, func(v *EnterpriseProjectUpdateIdentity) { v.Tenant = "T2" }, func(v *EnterpriseProjectUpdateIdentity) { v.SourceDeployment = "other-host" }, func(v *EnterpriseProjectUpdateIdentity) { v.TargetDeployment = "other-runtime" }} {
		bad := recoverID
		change(&bad)
		if _, err = a.ReplayEnterpriseWorkItemCompletion(ctx, bad, "800", "8010", recovery); err == nil {
			t.Fatal("cross-bound or nonmanager recovery accepted")
		}
	}
	if _, err = a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "2", "8010", recovery); err == nil {
		t.Fatal("cross-project recovery accepted")
	}
	if _, err = a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", map[string]any{"expectedOperationVersion": 1, "reason": "已修复审批配置"}); err == nil {
		t.Fatal("stale operation version accepted")
	}
	exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
	if _, err := a.EnterpriseWorkItemCompletionState(ctx, "8010", "U1"); err == nil {
		t.Fatal("recovery state ignored stale reader generation")
	}
	if _, err = a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", recovery); err == nil {
		t.Fatal("stale writer recovered operation")
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	exec("RENAME TABLE project_activity_logs TO recovery_hidden_audit")
	_, err = a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", recovery)
	exec("RENAME TABLE recovery_hidden_audit TO project_activity_logs")
	if err == nil || count("SELECT COUNT(*) FROM integration_operation WHERE operation_key=? AND status='failed_permanent' AND version_no=2", recoveryKey) != 1 || count("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='completion-recovery'") != 0 {
		t.Fatal("recovery audit failure leaked operation or receipt", err)
	}
	recovered, err := a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", recovery)
	if err != nil {
		t.Fatal(err)
	}
	recoveryReplay, err := a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", recovery)
	if err != nil || recoveryReplay["receiptId"] != recovered["receiptId"] {
		t.Fatal("recovery response-loss replay", err)
	}
	if _, err = a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", map[string]any{"expectedOperationVersion": 2, "reason": "另一个恢复理由"}); err == nil {
		t.Fatal("same recovery key changed payload accepted")
	}
	if count("SELECT COUNT(*) FROM integration_operation WHERE operation_key=? AND status='pending' AND version_no=3 AND command_sha256=? AND command_json=CAST(? AS JSON)", recoveryKey, frozenHash, frozenJSON) != 1 {
		t.Fatal("recovery rewrote frozen identity/command")
	}
	if count("SELECT COUNT(*) FROM project_activity_logs WHERE project_id=800 AND action='completion_replay'") != 1 {
		t.Fatal("recovery replay duplicated audit")
	}
	recoverID.IdempotencyKey = "completion-recovery-pending"
	if _, err = a.ReplayEnterpriseWorkItemCompletion(ctx, recoverID, "800", "8010", map[string]any{"expectedOperationVersion": 3, "reason": "已修复审批配置"}); err == nil {
		t.Fatal("pending operation recovered again")
	}
	seed(8050)
	exec("INSERT INTO work_item_service_ext(work_item_id,project_id,source_ticket_code) VALUES(8050,800,'ST-WITHDRAW')")
	withdrawID := id
	withdrawID.IdempotencyKey = "completion-withdraw"
	if _, err = a.RequestEnterpriseWorkItemCompletion(ctx, withdrawID, "800", "8050", map[string]any{"expectedVersion": version(8050)}); err != nil {
		t.Fatal(err)
	}
	var withdrawRequest int
	var withdrawHash string
	if err = db.QueryRowContext(ctx, "SELECT id,snapshot_sha256 FROM work_item_completion_requests WHERE work_item_id=8050").Scan(&withdrawRequest, &withdrawHash); err != nil {
		t.Fatal(err)
	}
	withdrawBody := callbackBody("cancelled")
	withdrawBody["instance_id"] = 91
	withdrawBody["instance_no"] = "WF91"
	withdrawBody["biz_id"] = "8050"
	withdrawBody["idempotencyKey"] = "workflow:callback:91:flow_completed:cancelled"
	withdrawBody["form_data"] = map[string]any{"completionRequestId": withdrawRequest, "projectId": 800, "workItemId": 8050, "snapshotSha256": withdrawHash}
	delete(withdrawBody, "approval_actor_uids")
	delete(withdrawBody, "non_self_approval_actor_uids")
	delete(withdrawBody, "approval_operator_uid")
	withdrawBody["cancellation_actor_uid"] = "OTHER"
	if _, err = VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, withdrawBody); err == nil {
		t.Fatal("noninitiator withdrawal callback accepted")
	}
	withdrawBody["cancellation_actor_uid"] = "U1"
	withdrawCallback, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, withdrawBody)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, withdrawCallback); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, withdrawCallback); err != nil {
		t.Fatal(err)
	}
	if count("SELECT COUNT(*) FROM work_item_completion_requests WHERE id=? AND status='cancelled' AND active_work_item_id IS NULL", withdrawRequest) != 1 || count("SELECT COUNT(*) FROM work_items WHERE id=8050 AND status='in_progress'") != 1 || count("SELECT COUNT(*) FROM work_item_service_ext WHERE work_item_id=8050 AND delivery_generation=2 AND last_delivery_status='processing'") != 1 {
		t.Fatal("withdraw did not unlock original state or preserve processing outbox")
	}
	withdrawID.IdempotencyKey = "completion-after-withdraw"
	if _, err = a.RequestEnterpriseWorkItemCompletion(ctx, withdrawID, "800", "8050", map[string]any{"expectedVersion": version(8050)}); err != nil {
		t.Fatal("withdraw left target permanently locked", err)
	}
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, withdrawCallback); err != nil {
		t.Fatal("old cancellation replay", err)
	}
	if count("SELECT COUNT(*) FROM work_items WHERE id=8050 AND status='in_review'") != 1 {
		t.Fatal("old cancellation changed new review")
	}
	seed(8030)
	exec("INSERT INTO work_item_service_ext(work_item_id,project_id,source_ticket_code) VALUES(8030,800,'ST-COMP')")
	serviceID := id
	serviceID.IdempotencyKey = "completion-service"
	if _, err := a.RequestEnterpriseWorkItemCompletion(ctx, serviceID, "800", "8030", map[string]any{"expectedVersion": version(8030)}); err != nil {
		t.Fatal(err)
	}
	if count("SELECT COUNT(*) FROM integration_operation WHERE operation_code=? AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.ticketCode'))='ST-COMP' AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.deliveryStatus'))='resolved'", serviceTicketDeliveryOperationCode) != 1 {
		t.Fatal("review did not atomically freeze original resolved ticket result")
	}
	var serviceRequest int
	var serviceHash string
	if err = db.QueryRowContext(ctx, "SELECT id,snapshot_sha256 FROM work_item_completion_requests WHERE work_item_id=8030").Scan(&serviceRequest, &serviceHash); err != nil {
		t.Fatal(err)
	}
	serviceBody := callbackBody("approved")
	serviceBody["instance_id"] = 81
	serviceBody["instance_no"] = "WF81"
	serviceBody["biz_id"] = "8030"
	serviceBody["idempotencyKey"] = "workflow:callback:81:flow_completed:approved"
	serviceBody["form_data"] = map[string]any{"completionRequestId": serviceRequest, "projectId": 800, "workItemId": 8030, "snapshotSha256": serviceHash}
	serviceCallback, err := VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, serviceBody)
	if err != nil {
		t.Fatal(err)
	}
	exec("RENAME TABLE project_activity_logs TO completion_callback_hidden_audit")
	_, err = a.ApplyWorkItemCompletionCallback(ctx, serviceCallback)
	exec("RENAME TABLE completion_callback_hidden_audit TO project_activity_logs")
	if err == nil || count("SELECT COUNT(*) FROM work_items WHERE id=8030 AND status='in_review'") != 1 || count("SELECT COUNT(*) FROM work_item_service_ext WHERE work_item_id=8030 AND delivery_generation=1") != 1 {
		t.Fatal("callback audit failure leaked status or ticket generation", err)
	}
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, serviceCallback); err != nil {
		t.Fatal(err)
	}
	if _, err = a.ApplyWorkItemCompletionCallback(ctx, serviceCallback); err != nil {
		t.Fatal(err)
	}
	if count("SELECT COUNT(*) FROM integration_operation WHERE operation_code=? AND JSON_UNQUOTE(JSON_EXTRACT(command_json,'$.ticketCode'))='ST-COMP'", serviceTicketDeliveryOperationCode) != 2 || count("SELECT COUNT(*) FROM work_item_service_ext WHERE work_item_id=8030 AND delivery_generation=2 AND last_delivery_status='closed'") != 1 {
		t.Fatal("approved callback/replay duplicated or missed original closed ticket result")
	}
	seed(8040)
	outboxBefore := version(8040)
	exec("CREATE TRIGGER completion_outbox_fail BEFORE INSERT ON integration_operation FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated outbox failure'")
	failedOutbox := id
	failedOutbox.IdempotencyKey = "completion-outbox-failure"
	_, err = a.RequestEnterpriseWorkItemCompletion(ctx, failedOutbox, "800", "8040", map[string]any{"expectedVersion": outboxBefore})
	exec("DROP TRIGGER completion_outbox_fail")
	if err == nil || version(8040) != outboxBefore || count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=8040") != 0 || count("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='completion-outbox-failure'") != 0 {
		t.Fatal("outbox failure leaked source mutation/receipt", err)
	}
	seed(8020)
	before := version(8020)
	exec("RENAME TABLE project_activity_logs TO completion_hidden_audit")
	failedID := id
	failedID.IdempotencyKey = "completion-audit-failure"
	_, err = a.RequestEnterpriseWorkItemCompletion(ctx, failedID, "800", "8020", map[string]any{"expectedVersion": before})
	exec("RENAME TABLE completion_hidden_audit TO project_activity_logs")
	if err == nil || version(8020) != before || count("SELECT COUNT(*) FROM work_item_completion_requests WHERE work_item_id=8020") != 0 || count("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='completion-audit-failure'") != 0 {
		t.Fatal("audit failure leaked status request outbox or receipt", err)
	}
}
