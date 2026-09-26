package unified

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
)

func verifyCompletionWriterContracts(t *testing.T, root, db *sql.DB, schema, source string) {
	t.Helper()
	ctx := context.Background()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	var port int
	var instance string
	if err := root.QueryRowContext(ctx, "SELECT @@port,@@server_uuid").Scan(&port, &instance); err != nil {
		t.Fatal(err)
	}
	username := "int202_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	secret := uuid.NewString()
	if _, err := root.ExecContext(ctx, "CREATE USER '"+username+"'@'127.0.0.1' IDENTIFIED BY '"+secret+"'"); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := root.ExecContext(ctx, "DROP USER '"+username+"'@'127.0.0.1'"); err != nil {
			t.Error(err)
		}
	}()
	if _, err := root.ExecContext(ctx, "GRANT ALL ON "+quoted(schema)+".* TO '"+username+"'@'127.0.0.1'"); err != nil {
		t.Fatal(err)
	}
	adapter, err := aims.New(config.AimsConfig{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: username, Password: secret, Database: schema}})
	if err != nil {
		t.Fatal(err)
	}
	defer adapter.DB().Close()
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(100),environment_code VARCHAR(100),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT UNSIGNED) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'T1','test','aims-test','v1',1)")
	tables := map[string]string{}
	for _, match := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(source, -1) {
		tables[match[1]] = match[1]
	}
	if tables["work_item_completion_requests"] == "" {
		t.Fatal("canonical completion candidate missing")
	}
	binding := e.Binding{Key: e.BindingKey{Tenant: "T1", Environment: "test", RuntimeDeployment: "aims-test"}, Storage: e.Storage{InstanceID: instance, Address: fmt.Sprintf("127.0.0.1:%d", port), Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-test", Tables: tables, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return adapter.DB(), nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	if err = adapter.ConfigureEnterpriseWrites(ctx, registry, binding, "enterprise-test", "aims-test"); err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO aims_projects(id,project_code,name,short_name,category,leader_uid,lifecycle_status,created_by) VALUES(800,'COMP','Completion','CMP','routine','U1','active','U1')")
	exec("INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(800,'U1','manager','active')")
	exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(8000,800,8000,'COMP-8000','target','task','Complete target','in_progress')")
	exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,parent_id) VALUES(8001,800,8001,'COMP-8001','matter','task','Child','completed',8000)")
	_, version, err := adapter.EnterpriseWorkItemEditableSnapshot(ctx, "8000")
	if err != nil {
		t.Fatal(err)
	}
	identity := aims.EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: "migration-completion", IdempotencyKey: "completion-real-writer"}
	if _, err = adapter.RequestEnterpriseWorkItemCompletion(ctx, identity, "800", "8000", map[string]any{"expectedVersion": version}); err != nil {
		t.Fatal(err)
	}
	check := func(valid bool) {
		t.Helper()
		issues, err := inspectCompletionRequests(ctx, db, schema)
		if err != nil {
			t.Fatal(err)
		}
		if (len(issues) == 0) != valid {
			t.Fatalf("completion valid=%v conflicts=%+v", valid, issues)
		}
		for _, issue := range issues {
			if len(issue.KeySHA256) != 64 || issue.RowCount != 1 {
				t.Fatalf("unsafe conflict %+v", issue)
			}
		}
	}
	check(true)
	var frozen, command []byte
	var hash, commandHash string
	if err = db.QueryRowContext(ctx, "SELECT snapshot_json,snapshot_sha256 FROM work_item_completion_requests").Scan(&frozen, &hash); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRowContext(ctx, "SELECT command_json,command_sha256 FROM integration_operation WHERE operation_code=?", completionWorkflowOperation).Scan(&command, &commandHash); err != nil {
		t.Fatal(err)
	}
	for _, mutation := range []string{"JSON_SET(snapshot_json,'$.unregistered',1)", "JSON_SET(snapshot_json,'$.item.project_id',999)", "JSON_SET(snapshot_json,'$.children[0].id',999)", "JSON_SET(snapshot_json,'$.children[0].status','in_progress')"} {
		exec("UPDATE work_item_completion_requests SET snapshot_json=" + mutation)
		check(false)
		exec("UPDATE work_item_completion_requests SET snapshot_json=?", frozen)
		check(true)
	}
	exec("UPDATE work_item_completion_requests SET snapshot_sha256=?", strings.Repeat("b", 64))
	check(false)
	exec("UPDATE work_item_completion_requests SET snapshot_sha256=?", hash)
	check(true)
	var reviewHash string
	if err = db.QueryRowContext(ctx, "SELECT review_version FROM work_item_completion_requests").Scan(&reviewHash); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE work_item_completion_requests SET review_version=?", strings.Repeat("d", 64))
	check(false)
	exec("UPDATE work_item_completion_requests SET review_version=?", reviewHash)
	check(true)
	exec("UPDATE integration_operation SET command_json=JSON_SET(command_json,'$.formData.projectId',999) WHERE operation_code=?", completionWorkflowOperation)
	check(false)
	exec("UPDATE integration_operation SET command_json=?,command_sha256=? WHERE operation_code=?", command, commandHash, completionWorkflowOperation)
	check(true)
	exec("UPDATE project_activity_logs SET actor_uid='other' WHERE action='completion_request'")
	check(false)
	exec("UPDATE project_activity_logs SET actor_uid='U1' WHERE action='completion_request'")
	check(true)
	var receiptHash string
	if err = db.QueryRowContext(ctx, "SELECT command_sha256 FROM service_command_receipt WHERE operation_code='enterprise.aims.work-items.complete.v1'").Scan(&receiptHash); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE service_command_receipt SET command_sha256=? WHERE operation_code='enterprise.aims.work-items.complete.v1'", strings.Repeat("c", 64))
	check(false)
	exec("UPDATE service_command_receipt SET command_sha256=? WHERE operation_code='enterprise.aims.work-items.complete.v1'", receiptHash)
	check(true)
	exec("UPDATE integration_operation SET source_biz_code='999' WHERE operation_code=?", completionWorkflowOperation)
	check(false)
	exec("UPDATE integration_operation SET source_biz_code=CAST((SELECT id FROM work_item_completion_requests LIMIT 1) AS CHAR) WHERE operation_code=?", completionWorkflowOperation)
	check(true)
	exec("UPDATE work_item_completion_requests SET status='running',workflow_instance_id=987654321,workflow_instance_no='WF-EXTERNAL-987654321',target_receipt_id='workflow-provider-receipt'")
	check(true)
	verifyCompletionShadowDDL(t, root, db, schema)
	exec("UPDATE integration_operation SET status='failed_permanent',version_no=2,last_error_code='workflow_route_not_found' WHERE operation_code=?", completionWorkflowOperation)
	replayIdentity := identity
	replayIdentity.IdempotencyKey = "completion-real-replay"
	replayInput := map[string]any{"expectedOperationVersion": 2, "reason": "repaired test configuration"}
	if _, err = adapter.ReplayEnterpriseWorkItemCompletion(ctx, replayIdentity, "800", "8000", replayInput); err != nil {
		t.Fatal(err)
	}
	check(true)
	if _, err = adapter.ReplayEnterpriseWorkItemCompletion(ctx, replayIdentity, "800", "8000", replayInput); err != nil {
		t.Fatal(err)
	}
	check(true)
	var replayChanges []byte
	if err = db.QueryRowContext(ctx, "SELECT changes FROM project_activity_logs WHERE action='completion_replay'").Scan(&replayChanges); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE project_activity_logs SET changes=JSON_SET(changes,'$.operationVersion',999) WHERE action='completion_replay'")
	check(false)
	exec("UPDATE project_activity_logs SET changes=? WHERE action='completion_replay'", replayChanges)
	check(true)
	var requestID int64
	if err = db.QueryRowContext(ctx, "SELECT id FROM work_item_completion_requests").Scan(&requestID); err != nil {
		t.Fatal(err)
	}
	callbackBody := map[string]any{"hzy_runtime_tenant_code": "T1", "hzy_runtime_deployment_code": "aims-test", "hzy_runtime_source_app": "aims", "hzy_runtime_service_client_id": "aims.runtime", "hzy_runtime_request_id": "migration-callback", "event": "flow_completed", "instance_id": 987654321, "instance_no": "WF-EXTERNAL-987654321", "app_code": "aims", "resource_code": "tasks", "action_code": "complete", "biz_id": "8000", "status": "approved", "initiator_uid": "U1", "approval_actor_uids": []string{"U9"}, "non_self_approval_actor_uids": []string{"U9"}, "approval_operator_uid": "U9", "idempotencyKey": "workflow:callback:987654321:flow_completed:approved", "form_data": map[string]any{"completionRequestId": requestID, "projectId": 800, "workItemId": 8000, "snapshotSha256": hash}}
	callback, err := aims.VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, callbackBody)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = adapter.ApplyWorkItemCompletionCallback(ctx, callback); err != nil {
		t.Fatal(err)
	}
	check(true)
	if _, err = adapter.ApplyWorkItemCompletionCallback(ctx, callback); err != nil {
		t.Fatal(err)
	}
	check(true)
	var resultChanges []byte
	if err = db.QueryRowContext(ctx, "SELECT changes FROM project_activity_logs WHERE action='completion_result'").Scan(&resultChanges); err != nil {
		t.Fatal(err)
	}
	for _, mutation := range []string{"JSON_SET(changes,'$.workflowInstanceId',999)", "JSON_SET(changes,'$.nonSelfApprovalActorUids',JSON_ARRAY('U1'))", "JSON_SET(changes,'$.to','in_progress')", "JSON_SET(changes,'$.unregistered',true)"} {
		exec("UPDATE project_activity_logs SET changes=" + mutation + " WHERE action='completion_result'")
		check(false)
		exec("UPDATE project_activity_logs SET changes=? WHERE action='completion_result'", resultChanges)
		check(true)
	}
	exec("UPDATE work_items SET title='Later valid historical edit' WHERE id=8001")
	check(true)
	verifyCompletionShadowDDL(t, root, db, schema) // Real approved history copied too.
	exec("CREATE TEMPORARY TABLE saved_terminal_audit AS SELECT * FROM project_activity_logs WHERE action='completion_result'")
	exec("DELETE FROM project_activity_logs WHERE action='completion_result'")
	check(false)
	exec("INSERT INTO project_activity_logs SELECT * FROM saved_terminal_audit")
	check(true)
	exec("RENAME TABLE work_item_changelog TO held_completion_changelog")
	check(false)
	exec("RENAME TABLE held_completion_changelog TO work_item_changelog")
	check(true)
	for index, status := range []string{"rejected", "cancelled"} {
		targetID := 9000 + index*10
		childID := targetID + 1
		exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(?,800,?,?,'target','task','Terminal sample','in_progress')", targetID, targetID, fmt.Sprintf("COMP-%d", targetID))
		exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status,parent_id) VALUES(?,800,?,?,'matter','task','Child','completed',?)", childID, childID, fmt.Sprintf("COMP-%d", childID), targetID)
		_, expected, err := adapter.EnterpriseWorkItemEditableSnapshot(ctx, fmt.Sprint(targetID))
		if err != nil {
			t.Fatal(err)
		}
		terminalIdentity := identity
		terminalIdentity.IdempotencyKey = "completion-" + status
		if _, err = adapter.RequestEnterpriseWorkItemCompletion(ctx, terminalIdentity, "800", fmt.Sprint(targetID), map[string]any{"expectedVersion": expected}); err != nil {
			t.Fatal(err)
		}
		var id int64
		var snapshotHash string
		if err = db.QueryRowContext(ctx, "SELECT id,snapshot_sha256 FROM work_item_completion_requests WHERE work_item_id=?", targetID).Scan(&id, &snapshotHash); err != nil {
			t.Fatal(err)
		}
		body := map[string]any{}
		for key, value := range callbackBody {
			body[key] = value
		}
		instance := 987654322 + index
		body["instance_id"] = instance
		body["instance_no"] = fmt.Sprintf("WF-%d", instance)
		body["status"] = status
		body["biz_id"] = fmt.Sprint(targetID)
		body["idempotencyKey"] = fmt.Sprintf("workflow:callback:%d:flow_completed:%s", instance, status)
		body["form_data"] = map[string]any{"completionRequestId": id, "projectId": 800, "workItemId": targetID, "snapshotSha256": snapshotHash}
		if status == "cancelled" {
			delete(body, "approval_actor_uids")
			delete(body, "non_self_approval_actor_uids")
			delete(body, "approval_operator_uid")
			body["cancellation_actor_uid"] = "U1"
		} else {
			delete(body, "non_self_approval_actor_uids")
		}
		verified, err := aims.VerifiedWorkItemCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, body)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = adapter.ApplyWorkItemCompletionCallback(ctx, verified); err != nil {
			t.Fatal(err)
		}
		check(true)
	}
	if _, err = db.ExecContext(ctx, "DELETE FROM work_items WHERE id=8001"); err != nil {
		t.Fatal(err)
	}
	check(false) // No successful deletion receipt/tombstone exists in this writer.
	t.Log("public manual replay and verified approved callback history pass; wrong terminal/replay evidence and unproved later child deletion block")
	t.Log("completion actual public writer snapshot/outbox/receipt/audit valid; mutations blocked; generated active uniqueness/composite FK shadow copy valid and external Workflow identity unchanged")
}

func verifyCompletionShadowDDL(t *testing.T, root, db *sql.DB, source string) {
	t.Helper()
	ctx := context.Background()
	target := "int202_completion_shadow_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:16]
	if _, err := root.ExecContext(ctx, "CREATE DATABASE "+quoted(target)); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := root.ExecContext(ctx, "DROP DATABASE "+quoted(target)); err != nil {
			t.Error(err)
		}
	}()
	var name, ddl string
	if err := db.QueryRowContext(ctx, "SHOW CREATE TABLE work_item_completion_requests").Scan(&name, &ddl); err != nil {
		t.Fatal(err)
	}
	table := Table{Domain: "aims", Source: source, Name: name, Target: "aims_work_item_completion_requests", DDL: ddl}
	plan := Plan{Config: Config{Target: target}, Tables: []Table{{Domain: "aims", Name: "work_items", Target: "aims_work_items"}, table}}
	rewritten, err := rewriteDDL(table, plan)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rewritten, "REFERENCES "+qualified(target, "aims_work_items")) || !strings.Contains(rewritten, "GENERATED ALWAYS") {
		t.Fatal("generated/composite FK mapping missing")
	}
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := root.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE " + qualified(target, "aims_work_items") + " (id bigint unsigned PRIMARY KEY,project_id bigint unsigned NOT NULL,UNIQUE KEY(project_id,id)) ENGINE=InnoDB")
	exec("INSERT INTO " + qualified(target, "aims_work_items") + " VALUES(8000,800),(8001,800),(9000,900)")
	exec(rewritten)
	columns := "id,project_id,work_item_id,requested_by,snapshot_json,snapshot_sha256,review_version,status,workflow_instance_id,workflow_instance_no,target_receipt_id,operation_key,created_at,updated_at"
	table.Columns = strings.Split(columns, ",")
	table.PrimaryKey = []string{"id"}
	// Match hzy-enterprise-migrate's raw-byte connection contract. The owning
	// domain fixture uses ParseTime=true; its RFC timestamp scan is unsuitable
	// for the mechanical byte-for-byte copy/digest connection.
	copyConfig := mysql.NewConfig()
	copyConfig.User = "root"
	copyConfig.Net = "unix"
	copyConfig.Addr = os.Getenv("HZY_INT202_TEST_SOCKET")
	copyConfig.DBName = source
	copyDB, err := sql.Open("mysql", copyConfig.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer copyDB.Close()
	table.Count, table.Hash, err = digest(ctx, copyDB, qualified(source, name), table.PrimaryKey)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := qualified(target, "copy_checkpoint")
	exec("CREATE TABLE " + checkpoint + " (target_table varchar(64) PRIMARY KEY,copied_rows bigint,source_hash char(64),status varchar(32)) ENGINE=InnoDB")
	snapshot, err := copyDB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	defer snapshot.Rollback()
	connection, err := root.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	if err = copyTable(ctx, snapshot, connection, table, plan, checkpoint); err != nil {
		t.Fatal(err)
	}
	var active sql.NullInt64
	var external int64
	var externalNo string
	if err = root.QueryRowContext(ctx, "SELECT active_work_item_id,workflow_instance_id,workflow_instance_no FROM "+qualified(target, table.Target)).Scan(&active, &external, &externalNo); err != nil {
		t.Fatal(err)
	}
	var sourceStatus string
	if err = db.QueryRowContext(ctx, "SELECT status FROM work_item_completion_requests ORDER BY id LIMIT 1").Scan(&sourceStatus); err != nil {
		t.Fatal(err)
	}
	wantActive := sourceStatus == "queued" || sourceStatus == "running"
	if active.Valid != wantActive || (active.Valid && active.Int64 != 8000) || external != 987654321 || externalNo != "WF-EXTERNAL-987654321" {
		t.Fatal("generated/external identity changed")
	}
	insert := "INSERT INTO " + qualified(target, table.Target) + " (project_id,work_item_id,requested_by,snapshot_json,snapshot_sha256,review_version,status,operation_key) SELECT project_id,work_item_id,requested_by,snapshot_json,snapshot_sha256,review_version,'queued','duplicate-active' FROM " + qualified(target, table.Target) + " LIMIT 1"
	if !wantActive {
		exec(insert)
	}
	if _, err = root.ExecContext(ctx, strings.ReplaceAll(insert, "duplicate-active", "duplicate-active-2")); err == nil {
		t.Fatal("duplicate active request accepted")
	}
	if _, err = root.ExecContext(ctx, "UPDATE "+qualified(target, table.Target)+" SET project_id=900 WHERE work_item_id=8000"); err == nil {
		t.Fatal("cross-project composite reference accepted")
	}
	exec("UPDATE " + qualified(target, table.Target) + " SET status='approved'")
	exec(strings.ReplaceAll(insert, "duplicate-active", "duplicate-active-3"))
	if _, err = root.ExecContext(ctx, "DELETE FROM "+qualified(target, "aims_work_items")+" WHERE id=8000"); err == nil {
		t.Fatal("RESTRICT target removal accepted")
	}
}
