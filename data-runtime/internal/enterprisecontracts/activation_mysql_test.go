package enterprisecontracts

import (
	"context"

	"database/sql"
	"fmt"
	"net/url"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	altocapp "github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"time"

	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestRegisteredActivationMySQL(t *testing.T) {
	socket := os.Getenv("HZY_REGISTERED_ACTIVATION_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL required")
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
	exec := func(db *sql.DB, q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatal(err)
		}
	}
	name := "hzy_contract_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	exec(root, "CREATE DATABASE "+name)
	defer exec(root, "DROP DATABASE "+name)
	mc.DBName = name
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../altoc/docs/altoc_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	tables := regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1)
	if len(tables) < 30 {
		t.Fatal("canonical schema missing")
	}
	for _, table := range tables {
		exec(db, table[0])
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(5)
	var port int
	if err = root.QueryRow("SELECT @@port").Scan(&port); err != nil {
		t.Fatal(err)
	}
	secret := uuid.NewString()
	exec(root, "CREATE USER 'hzy_contract'@'127.0.0.1' IDENTIFIED BY '"+secret+"'")
	defer exec(root, "DROP USER 'hzy_contract'@'127.0.0.1'")
	exec(root, "GRANT ALL ON "+name+".* TO 'hzy_contract'@'127.0.0.1'")
	base, err := compat.New(compat.Config{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: "hzy_contract", Password: secret, Database: name}})
	if err != nil {
		t.Fatal(err)
	}
	defer base.DB().Close()
	a := &altocapp.Adapter{Adapter: base}
	ctx := context.Background()
	exec(db, "INSERT INTO customer(id,code,name,owner_user_id) VALUES(1,'CU-1','Customer','person-a')")
	exec(db, "INSERT INTO contract(id,code,name,customer_id,owner_user_id) VALUES(1,'CT-1','Contract',1,'person-a')")
	exec(db, "INSERT INTO contract_line(code,contract_id,line_no,line_type,name,project_policy) VALUES('LINE-1',1,1,'implementation','Delivery','required')")
	exec(db, "INSERT INTO contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(1,1,'Signed','advance',20,'contract_signed')")
	altocTables := map[string]string{}
	renames := []string{}
	for _, table := range tables {
		altocTables[table[1]] = "altoc_" + table[1]
		renames = append(renames, "`"+table[1]+"` TO `altoc_"+table[1]+"`")
	}
	exec(db, "RENAME TABLE "+strings.Join(renames, ","))
	sourceAims, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	needed := map[string]bool{"service_command_receipt": true, "integration_operation": true, "integration_operation_attempt": true, "integration_operation_dead_letter_actionable": true, "approval_records": true}
	for _, name := range ActivationAimsViews() {
		needed[name] = true
	}
	aimsTables := map[string]string{}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, table := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(sourceAims), -1) {
		if !needed[table[1]] {
			continue
		}
		physical := "aims_" + table[1]
		aimsTables[table[1]] = physical
		ddl := strings.Replace(table[0], table[1], physical, 1)
		for logical := range needed {
			ddl = strings.ReplaceAll(ddl, "REFERENCES `"+logical+"`", "REFERENCES `aims_"+logical+"`")
			ddl = strings.ReplaceAll(ddl, "REFERENCES "+logical+" (", "REFERENCES aims_"+logical+" (")
			ddl = strings.ReplaceAll(ddl, "REFERENCES "+logical+"", "REFERENCES aims_"+logical)
		}

		for _, prefix := range []string{"chk_scr_", "chk_iop_", "chk_iopdla_", "chk_ioa_", "chk_approval_", "fk_iopdla_", "fk_ioa_", "fk_approval_"} {
			ddl = strings.ReplaceAll(ddl, prefix, "aims_"+prefix)
		}
		exec(db, ddl)
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(5)
	// A conflicting domain audit table must not receive Altoc's audit rows.
	exec(db, "CREATE TABLE aims_audit_log LIKE altoc_audit_log")
	aimsTables["audit_log"] = "aims_audit_log"
	var instance string
	db.QueryRow("SELECT @@server_uuid").Scan(&instance)
	binding := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "isolated", RuntimeDeployment: "runtime-test"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: name}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"altoc": {OwnerDeployment: "enterprise-test", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified, Tables: altocTables}, "aims": {OwnerDeployment: "enterprise-test", Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified, Tables: aimsTables}}}
	exec(db, "CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec(db, "INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','isolated','runtime-test','v1',0)")
	for domain, views := range map[string][]string{"altoc": ActivationAltocViews(), "aims": MilestoneReceivableAimsViews()} {
		plan, err := e.PlanCompatibilityViews(ctx, db, binding, domain, views)
		if err != nil {
			t.Fatal(err)
		}
		if err = e.ApplyCompatibilityViews(ctx, db, binding, domain, views, plan.ReviewHash); err != nil {
			t.Fatal(err)
		}
	}
	exec(db, "UPDATE enterprise_schema_registry SET generation=1")
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, binding); err != nil {
		t.Fatal(err)
	}
	defer registry.Close()
	service, err := NewActivationService(ctx, registry, binding, DeploymentBinding{AltocDeployment: "altoc-test", AimsDeployment: "aims-test", AltocClient: "altoc.runtime"}, a, &aimsapp.Adapter{Adapter: base})
	if err != nil {
		t.Fatal(err)
	}
	milestoneService, err := NewMilestoneReceivableService(ctx, registry, binding, DeploymentBinding{AltocDeployment: "altoc-test", AimsDeployment: "aims-test", AltocClient: "altoc.runtime"}, a, &aimsapp.Adapter{Adapter: base})
	if err != nil {
		t.Fatalf("milestone receivable registry core: %v", err)
	}

	// A write registration cannot silently assume scheduler consumption ownership.
	badBinding := binding
	badBinding.Domains = map[string]e.DomainBinding{}
	for k, v := range binding.Domains {
		badBinding.Domains[k] = v
	}
	d := badBinding.Domains["altoc"]
	d.Scheduler = e.PathDisabled
	badBinding.Domains["altoc"] = d
	restricted := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return sql.Open("mysql", mc.FormatDSN()) })
	if err = restricted.Register(ctx, badBinding); err != nil {
		t.Fatal(err)
	}
	if _, err = NewActivationService(ctx, restricted, badBinding, DeploymentBinding{AltocDeployment: "altoc-test", AimsDeployment: "aims-test", AltocClient: "altoc.runtime"}, a, &aimsapp.Adapter{Adapter: base}); err == nil {
		t.Fatal("writer assumed scheduler authority")
	}
	restricted.Close()
	identity := ActivationIdentity{Key: binding.Key, ActorUID: "person-a", RequestID: "request-a", IdempotencyKey: "activation-key"}
	permit := testActivationAuthorizer(func(ctx context.Context, tx *sql.Tx, id ActivationAuthorizationIdentity) (ActivationGrant, error) {
		var owner string
		if err := tx.QueryRowContext(ctx, "SELECT owner_user_id FROM contract WHERE code=?", id.ContractCode).Scan(&owner); err != nil {
			return ActivationGrant{}, err
		}
		return ActivationGrant{Identity: id, ExpiresAt: time.Now().Add(10 * time.Second), AltocContractEdit: owner == id.ActorUID, AimsProjectWrite: true, AltocAccess: "self"}, nil
	})
	wrong := identity
	wrong.Key.Tenant = "tenant-b"
	if _, err = service.Activate(ctx, wrong, "CT-1", permit); err == nil {
		t.Fatal("wrong tenant accepted")
	}
	expired := testActivationAuthorizer(func(ctx context.Context, tx *sql.Tx, id ActivationAuthorizationIdentity) (ActivationGrant, error) {
		g, err := permit.AuthorizeContractActivation(ctx, tx, id)
		g.ExpiresAt = time.Now().Add(-time.Second)
		return g, err
	})
	if _, err = service.Activate(ctx, identity, "CT-1", expired); err == nil {
		t.Fatal("expired grant accepted")
	}
	denied := testActivationAuthorizer(func(ctx context.Context, tx *sql.Tx, id ActivationAuthorizationIdentity) (ActivationGrant, error) {
		g, err := permit.AuthorizeContractActivation(ctx, tx, id)
		g.AimsProjectWrite = false
		return g, err
	})
	if _, err = service.Activate(ctx, identity, "CT-1", denied); err == nil {
		t.Fatal("missing Aims permission accepted")
	}
	if _, err = service.Activate(ctx, identity, "CT-1", permit); err != nil {
		t.Fatal(err)
	}

	exec(db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_user_id) VALUES(2,'CT-AA04','AA04',1,'person-a')")
	exec(db, "INSERT INTO altoc_contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(2,2,'AA04 term','advance',20,'contract_signed')")
	exec(db, "INSERT INTO altoc_receivable_plan(code,contract_id,payment_term_id,customer_id,plan_name,plan_type,status,amount) VALUES('RP-AA04',2,2,1,'AA04','advance','pending',20)")
	// AA-04: a Workflow-authenticated callback drives source fact, target receipt and ACK.
	insertCallbackFixture := func(project, request string, term int64, instance string) {
		exec(db, fmt.Sprintf("INSERT INTO aims_projects(project_code,name,short_name,category,lifecycle_status,leader_uid,created_by,contract_code) VALUES('%s','P','P','delivery','active','pm-1','pm-1','CT-AA04')", project))
		var projectID int64
		if err := db.QueryRow("SELECT id FROM aims_projects WHERE project_code=?", project).Scan(&projectID); err != nil {
			t.Fatal(err)
		}
		exec(db, fmt.Sprintf("INSERT INTO aims_milestones(project_id,name,status,payment_term_id,sort_order,created_by) VALUES(%d,'M','active',%d,1,'pm-1')", projectID, term))
		var milestoneID int64
		if err := db.QueryRow("SELECT id FROM aims_milestones WHERE project_id=?", projectID).Scan(&milestoneID); err != nil {
			t.Fatal(err)
		}
		exec(db, fmt.Sprintf("INSERT INTO aims_approval_records(request_no,milestone_owner_id,transition,requested_by,snapshot_sha256,idempotency_key,reviewer_uid,status,workflow_instance_id,project_id,project_code) VALUES('%s',%d,'active→completed','pm-1','hash-%s','key-%s','director','pending','%s',%d,'%s')", request, milestoneID, request, request, instance, projectID, project))
		var requestID int64
		if err := db.QueryRow("SELECT id FROM aims_approval_records WHERE request_no=?", request).Scan(&requestID); err != nil {
			t.Fatal(err)
		}
		exec(db, fmt.Sprintf("UPDATE aims_milestones SET completion_lock_request_id=%d WHERE id=%d", requestID, milestoneID))
	}
	callback := func(request, instance string) aimsapp.VerifiedMilestoneCompletionCallback {
		var id int64
		var milestone int64
		var project string
		if err := db.QueryRow("SELECT id,milestone_owner_id,project_code FROM aims_approval_records WHERE request_no=?", request).Scan(&id, &milestone, &project); err != nil {
			t.Fatal(err)
		}
		v, err := aimsapp.VerifiedMilestoneCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, map[string]any{"event": "flow_completed", "instance_id": instance, "app_code": "aims", "resource_code": "milestones", "action_code": "milestone_completion", "biz_id": fmt.Sprint(milestone), "status": "approved", "initiator_uid": "pm-1", io.TrustedTenantCodeKey: "tenant-a", io.TrustedDeploymentCodeKey: "aims-test", io.TrustedSourceAppKey: "aims", io.TrustedServiceClientIDKey: "aims.runtime", "form_data": map[string]any{"completionRequestId": id, "requestNo": request, "snapshotSha256": "hash-" + request, "projectDirectorUid": "director", "projectDirectorRevision": float64(1), "projectDirectorRoleCode": "project_director"}})
		if err != nil {
			t.Fatal(err)
		}
		_ = project
		return v
	}
	insertCallbackFixture("PRJ-AA04", "MCR-AA04", 2, "wf-aa04")
	wrongTenant := callback("MCR-AA04", "wf-aa04")
	wrongTenantBody := wrongTenant.Body()
	wrongTenantBody[io.TrustedTenantCodeKey] = "tenant-a"
	wrongTenantBody[io.TrustedDeploymentCodeKey] = "aims-test"
	wrongTenantBody[io.TrustedSourceAppKey] = "aims"
	wrongTenantBody[io.TrustedServiceClientIDKey] = "aims.runtime"
	wrongTenantBody[io.TrustedTenantCodeKey] = "tenant-b"
	wrongTenant, err = aimsapp.VerifiedMilestoneCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, wrongTenantBody)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = milestoneService.Complete(ctx, wrongTenant); err == nil {
		t.Fatal("AA04 cross-tenant callback accepted")
	}
	wrongDeployment := callback("MCR-AA04", "wf-aa04")
	wrongDeploymentBody := wrongDeployment.Body()
	wrongDeploymentBody[io.TrustedTenantCodeKey] = "tenant-a"
	wrongDeploymentBody[io.TrustedDeploymentCodeKey] = "aims-test"
	wrongDeploymentBody[io.TrustedSourceAppKey] = "aims"
	wrongDeploymentBody[io.TrustedServiceClientIDKey] = "aims.runtime"
	wrongDeploymentBody[io.TrustedDeploymentCodeKey] = "other-aims"
	wrongDeployment, err = aimsapp.VerifiedMilestoneCompletionCallbackFromTrustedRuntime(url.Values{"workflow_callback_verified": {"1"}}, wrongDeploymentBody)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = milestoneService.Complete(ctx, wrongDeployment); err == nil {
		t.Fatal("AA04 wrong-deployment callback accepted")
	}
	var untouched int
	db.QueryRow("SELECT COUNT(*) FROM aims_approval_records WHERE request_no='MCR-AA04' AND status='pending'").Scan(&untouched)
	if untouched != 1 {
		t.Fatal("AA04 rejected callback mutated source")
	}
	completedCallback, err := milestoneService.Complete(ctx, callback("MCR-AA04", "wf-aa04"))
	if err != nil {
		t.Fatalf("AA04 first completion: %v", err)
	}
	completedOperation, ok := completedCallback["receivableBillable"].(map[string]any)
	if !ok || completedOperation["operationStatus"] != "succeeded" {
		t.Fatal("AA04 committed callback would trigger legacy external dispatch")
	}
	var sourceSucceeded, receipts int
	db.QueryRow("SELECT COUNT(*) FROM aims_integration_operation WHERE status='succeeded'").Scan(&sourceSucceeded)
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt").Scan(&receipts)
	if sourceSucceeded != 1 || receipts != 1 {
		t.Fatalf("AA04 missing source ACK/receipt: %d/%d", sourceSucceeded, receipts)
	}
	if _, err := milestoneService.Complete(ctx, callback("MCR-AA04", "wf-aa04")); err != nil {
		t.Fatalf("AA04 replay: %v", err)
	}
	var replayReceipts int
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt").Scan(&replayReceipts)
	if replayReceipts != receipts {
		t.Fatal("AA04 replay duplicated receipt")
	}
	exec(db, "INSERT INTO altoc_contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(4,2,'rollback','advance',20,'contract_signed')")
	exec(db, "INSERT INTO altoc_receivable_plan(code,contract_id,payment_term_id,customer_id,plan_name,plan_type,status,amount) VALUES('RP-AA04-ROLLBACK',2,4,1,'rollback','advance','pending',20)")
	insertCallbackFixture("PRJ-AA04-ROLLBACK", "MCR-AA04-ROLLBACK", 4, "wf-aa04-r")
	exec(db, "CREATE TRIGGER aims_ack_late_failure BEFORE UPDATE ON aims_integration_operation FOR EACH ROW BEGIN IF OLD.status='processing' AND NEW.status='succeeded' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='aa04 late ack failure'; END IF; END")
	if _, err := milestoneService.Complete(ctx, callback("MCR-AA04-ROLLBACK", "wf-aa04-r")); err == nil {
		t.Fatal("AA04 late ACK failure accepted")
	}
	exec(db, "DROP TRIGGER aims_ack_late_failure")
	var pendingApproval, activeMilestone, rolledReceipts int
	db.QueryRow("SELECT COUNT(*) FROM aims_approval_records WHERE request_no='MCR-AA04-ROLLBACK' AND status='pending'").Scan(&pendingApproval)
	db.QueryRow("SELECT COUNT(*) FROM aims_milestones m JOIN aims_approval_records a ON a.milestone_owner_id=m.id WHERE a.request_no='MCR-AA04-ROLLBACK' AND m.status='active'").Scan(&activeMilestone)
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt").Scan(&rolledReceipts)
	if pendingApproval != 1 || activeMilestone != 1 || rolledReceipts != receipts {
		t.Fatalf("AA04 late failure leaked facts: %d/%d/%d", pendingApproval, activeMilestone, rolledReceipts)
	}
	var rollbackOperations int
	if err := db.QueryRow("SELECT COUNT(*) FROM aims_integration_operation").Scan(&rollbackOperations); err != nil || rollbackOperations != 1 {
		t.Fatalf("AA04 late failure leaked source operation: %d %v", rollbackOperations, err)
	}
	var rollbackPlanStatus string
	if err := db.QueryRow("SELECT status FROM altoc_receivable_plan WHERE code='RP-AA04-ROLLBACK'").Scan(&rollbackPlanStatus); err != nil || rollbackPlanStatus != "pending" {
		t.Fatalf("AA04 late failure changed receivable state: %q %v", rollbackPlanStatus, err)
	}
	exec(db, "INSERT INTO altoc_contract(id,code,name,customer_id,owner_user_id) VALUES(3,'CT-AA04-WRONG','Wrong',1,'person-a')")
	exec(db, "INSERT INTO altoc_contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(3,3,'wrong','advance',20,'contract_signed')")
	exec(db, "INSERT INTO altoc_receivable_plan(code,contract_id,payment_term_id,customer_id,plan_name,plan_type,status,amount) VALUES('RP-AA04-WRONG',3,3,1,'wrong','advance','pending',20)")
	insertCallbackFixture("PRJ-AA04-WRONG", "MCR-AA04-WRONG", 3, "wf-aa04-wrong")
	if _, err := milestoneService.Complete(ctx, callback("MCR-AA04-WRONG", "wf-aa04-wrong")); err == nil {
		t.Fatal("AA04 cross-contract payment term accepted")
	}
	var wrongApproval int
	db.QueryRow("SELECT COUNT(*) FROM aims_approval_records WHERE request_no='MCR-AA04-WRONG' AND status='pending'").Scan(&wrongApproval)
	if wrongApproval != 1 {
		t.Fatal("AA04 cross-contract callback mutated source")
	}
	var count int
	db.QueryRow("SELECT COUNT(*) FROM aims_audit_log").Scan(&count)
	if count != 0 {
		t.Fatal("Aims audit mutated")
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_audit_log").Scan(&count)
	if count == 0 {
		t.Fatal("Altoc audit mapping unused")
	}
	// Persistent generation changes wait until the active authorized writer commits.
	entered, release := make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	blocked := testActivationAuthorizer(func(ctx context.Context, tx *sql.Tx, id ActivationAuthorizationIdentity) (ActivationGrant, error) {
		close(entered)
		<-release
		return permit.AuthorizeContractActivation(ctx, tx, id)
	})
	go func() { _, err := service.Activate(ctx, identity, "CT-1", blocked); done <- err }()
	<-entered
	updated := make(chan error, 1)
	go func() { _, err := db.Exec("UPDATE enterprise_schema_registry SET generation=2"); updated <- err }()
	select {
	case err := <-updated:
		t.Fatalf("generation did not wait: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	close(release)
	if err = <-done; err != nil {
		t.Fatal(err)
	}
	if err = <-updated; err != nil {
		t.Fatal(err)
	}
	if _, err = service.Activate(ctx, identity, "CT-1", permit); err == nil {
		t.Fatal("stale generation wrote")
	}
}

type testActivationAuthorizer func(context.Context, *sql.Tx, ActivationAuthorizationIdentity) (ActivationGrant, error)

func (f testActivationAuthorizer) AuthorizeContractActivation(ctx context.Context, tx *sql.Tx, id ActivationAuthorizationIdentity) (ActivationGrant, error) {
	return f(ctx, tx, id)
}
