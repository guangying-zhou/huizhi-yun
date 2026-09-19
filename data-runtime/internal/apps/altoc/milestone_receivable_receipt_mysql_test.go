package altoc

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	aimsapp "github.com/huizhi-yun/data-runtime/internal/apps/aims"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestMilestoneReceivableSharedTransactionMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ALTOC_RECEIPT_SOCKET")
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
	source, err := os.ReadFile("../../../../altoc/docs/altoc_schema.sql")
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
	a := &Adapter{Adapter: base}
	exec(db, "RENAME TABLE service_command_receipt TO altoc_service_command_receipt")
	exec(db, "CREATE SQL SECURITY INVOKER VIEW service_command_receipt AS SELECT * FROM altoc_service_command_receipt")
	repo, err := io.NewReceiptRepository(db, io.WithReceiptTable("`altoc_service_command_receipt`"))
	if err != nil {
		t.Fatal(err)
	}
	exec(db, "INSERT INTO customer(id,code,name,owner_user_id) VALUES(1,'CU-1','Customer','person-a')")
	exec(db, "INSERT INTO contract(id,code,name,customer_id,owner_user_id) VALUES(1,'CT-1','Contract',1,'person-a')")
	exec(db, "INSERT INTO receivable_plan(id,code,contract_id,customer_id,payment_term_id,plan_name,amount) VALUES(1,'RP-1',1,1,1,'Accept',100)")
	operationID := uuid.NewString()
	body := func() map[string]any {
		command := map[string]any{"paymentTermId": 1, "contractCode": "CT-1", "idempotencyKey": "billable-key"}
		raw, _ := json.Marshal(command)
		hash := sha256.Sum256(raw)
		return map[string]any{io.TrustedServiceCommandTenantKey: "tenant-a", io.TrustedServiceCommandSourceDeploymentKey: "aims-test", io.TrustedServiceCommandTargetDeploymentKey: "altoc-test", io.TrustedServiceCommandSourceAppKey: "aims", io.TrustedServiceCommandTargetAppKey: "altoc", io.TrustedServiceCommandSourceClientKey: "aims.runtime", "current_user": "person-a", "current_user_scopes": []string{"altoc:receivable:mark-billable"}, io.ServiceCommandEnvelopeKey: map[string]any{"operationId": operationID, "operationCode": milestoneReceivableOperationCode, "targetApp": "altoc", "requiredCapability": milestoneReceivableRequiredCapability, "idempotencyKey": "billable-key", "commandSchemaVersion": "v1", "commandSha256": hex.EncodeToString(hash[:]), "command": command}}
	}
	ctx := context.Background()
	for _, commit := range []bool{false, true} {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.ExecuteMilestoneReceivableBillableInTransaction(ctx, tx, repo, "1", body()); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit()
		} else {
			if _, late := tx.Exec("INSERT INTO audit_log(id) VALUES(NULL)"); late == nil {
				tx.Rollback()
				t.Fatal("expected required audit fields to reject")
			}
			err = tx.Rollback()
		}
		if err != nil {
			t.Fatal(err)
		}
		var status string
		var n int
		if err = db.QueryRow("SELECT status FROM receivable_plan WHERE id=1").Scan(&status); err != nil {
			t.Fatal(err)
		}
		db.QueryRow("SELECT COUNT(*) FROM service_command_receipt").Scan(&n)
		want := "pending"
		count := 0
		if commit {
			want = "to_invoice"
			count = 1
		}
		if status != want || n != count {
			t.Fatalf("state %s receipts%d", status, n)
		}
	}
	if out, err := a.executeMilestoneReceivableBillable(ctx, "1", body()); err != nil || out["idempotent"] != true {
		t.Fatalf("old replay %v %v", out, err)
	}
	for _, kind := range []string{"path", "source", "payload", "nil-repository"} {
		tx, _ := db.BeginTx(ctx, nil)
		b := body()
		path := "1"
		r := repo
		switch kind {
		case "path":
			path = "2"
		case "source":
			b[io.TrustedServiceCommandSourceAppKey] = "assets"
		case "nil-repository":
			r = nil
		case "payload":
			env := b[io.ServiceCommandEnvelopeKey].(map[string]any)
			cmd := env["command"].(map[string]any)
			cmd["contractCode"] = "OTHER"
			raw, _ := json.Marshal(cmd)
			hash := sha256.Sum256(raw)
			env["commandSha256"] = hex.EncodeToString(hash[:])
		}
		if _, err = a.ExecuteMilestoneReceivableBillableInTransaction(ctx, tx, r, path, b); err == nil {
			tx.Rollback()
			t.Fatalf("%s accepted", kind)
		}
		var one int
		if err = tx.QueryRow("SELECT 1").Scan(&one); err != nil {
			t.Fatal("caller transaction closed", err)
		}
		tx.Rollback()
	}
	exec(db, "INSERT INTO contract_line(code,contract_id,line_no,line_type,name,project_policy) VALUES('LINE-1',1,1,'implementation','Delivery','required')")
	exec(db, "INSERT INTO contract_payment_term(id,contract_id,term_name,term_type,amount,trigger_stage_type) VALUES(2,1,'Signed','advance',20,'contract_signed')")
	activation := map[string]any{"current_user": "person-a", "idempotencyKey": "activation-key", io.TrustedTenantCodeKey: "tenant-a", io.TrustedDeploymentCodeKey: "altoc-test", io.TrustedSourceAppKey: "altoc", io.TrustedServiceClientIDKey: "altoc.runtime"}
	for _, commit := range []bool{false, true} {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.ExecuteContractActivationInTransaction(ctx, tx, "CT-1", activation); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if _, err = a.ActivateContractDeliveryInTransaction(ctx, tx, "CT-1", activation); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit()
		} else {
			if _, late := tx.Exec("INSERT INTO audit_log(id) VALUES(NULL)"); late == nil {
				t.Fatal("expected late audit failure")
			}
			err = tx.Rollback()
		}
		if err != nil {
			t.Fatal(err)
		}
		for table, want := range map[string]int{"contract_orchestration_job": 1, "integration_operation": 2, "domain_event_outbox": 1, "audit_log": 1} {
			var n int
			if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if !commit {
				want = 0
			}
			if n != want {
				t.Fatalf("activation %s %d want%d", table, n, want)
			}
		}
		var plans, steps int
		db.QueryRow("SELECT COUNT(*) FROM receivable_plan").Scan(&plans)
		db.QueryRow("SELECT COUNT(*) FROM contract_orchestration_step").Scan(&steps)
		if commit && (plans != 2 || steps == 0) || !commit && (plans != 1 || steps != 0) {
			t.Fatalf("activation plan/step rollback counts %d/%d", plans, steps)
		}
		var status string
		db.QueryRow("SELECT status FROM contract WHERE id=1").Scan(&status)
		if commit && status != "effective" || !commit && status != "draft" {
			t.Fatal("contract status", status)
		}
	}
	if out, err := a.executeContractActivation(ctx, "CT-1", activation); err != nil || out["idempotent"] != true {
		t.Fatalf("job replay %v %v", out, err)
	}
	if _, err := a.activateContractDelivery(ctx, "CT-1", activation); err != nil {
		t.Fatal("activation replay", err)
	}
	var operations int
	db.QueryRow("SELECT COUNT(*) FROM integration_operation").Scan(&operations)
	if operations != 2 {
		t.Fatal("duplicate frozen operations")
	}

	// Consume the already frozen operations against the real Aims owning handlers.
	sourceDDL, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	needed := map[string]bool{"aims_projects": true, "aims_project_members": true, "project_lifecycle_events": true, "project_counters": true, "milestones": true, "service_command_receipt": true}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	for _, table := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(sourceDDL), -1) {
		if needed[table[1]] {
			ddl := table[0]
			if table[1] == "service_command_receipt" {
				ddl = strings.Replace(ddl, "service_command_receipt", "aims_service_command_receipt", 1)
				ddl = strings.ReplaceAll(ddl, "chk_scr_", "aims_chk_scr_")
			}
			exec(db, ddl)
		}
	}
	exec(db, "SET FOREIGN_KEY_CHECKS=1")
	db.SetMaxOpenConns(5)
	for _, table := range []string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable"} {
		exec(db, "RENAME TABLE "+table+" TO altoc_"+table)
	}
	tablesMap, err := io.NewOutboxTables("`altoc_integration_operation`", "`altoc_integration_operation_attempt`", "`altoc_service_command_receipt`", "`altoc_integration_operation_dead_letter_actionable`")
	if err != nil {
		t.Fatal(err)
	}
	sourceRepo, err := io.NewRepository(db, io.WithOutboxTables(tablesMap))
	if err != nil {
		t.Fatal(err)
	}
	targetRepo, err := io.NewReceiptRepository(db, io.WithReceiptTable("`aims_service_command_receipt`"))
	if err != nil {
		t.Fatal(err)
	}
	sourceContext := io.TrustedContext{TenantCode: "tenant-a", DeploymentCode: "altoc-test", SourceApp: "altoc", ServiceClientID: "altoc.runtime", OutboxTables: &tablesMap}
	target := &aimsapp.Adapter{Adapter: base}
	exec(db, "CREATE TRIGGER fail_checkpoint BEFORE UPDATE ON contract_orchestration_step FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='late checkpoint failure'")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.ExecuteLocalContractActivationInTransaction(ctx, tx, sourceContext, "aims-test", sourceRepo, targetRepo, target, "CT-1", activation); err == nil || !strings.Contains(err.Error(), "late checkpoint failure") {
		tx.Rollback()
		t.Fatalf("checkpoint failure missing: %v", err)
	}
	tx.Rollback()
	for _, table := range []string{"aims_projects", "milestones", "aims_service_command_receipt", "altoc_integration_operation_attempt"} {
		var n int
		db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n)
		if n != 0 {
			t.Fatalf("late checkpoint left %s=%d", table, n)
		}
	}
	exec(db, "DROP TRIGGER fail_checkpoint")
	// Simulate a legacy target commit whose source ACK was lost: preserve the actual frozen identity.
	var frozenID, frozenKey, frozenVersion, frozenDigest string
	var frozenJSON []byte
	if err = db.QueryRow("SELECT operation_id,idempotency_key,command_schema_version,command_sha256,command_json FROM altoc_integration_operation WHERE operation_code=?", altocActivationProjectOperation).Scan(&frozenID, &frozenKey, &frozenVersion, &frozenDigest, &frozenJSON); err != nil {
		t.Fatal(err)
	}
	targetBody := func() map[string]any {
		var command map[string]any
		if err := json.Unmarshal(frozenJSON, &command); err != nil {
			t.Fatal(err)
		}
		return map[string]any{io.TrustedServiceCommandTenantKey: "tenant-a", io.TrustedServiceCommandSourceDeploymentKey: "altoc-test", io.TrustedServiceCommandTargetDeploymentKey: "aims-test", io.TrustedServiceCommandSourceAppKey: "altoc", io.TrustedServiceCommandTargetAppKey: "aims", io.TrustedServiceCommandSourceClientKey: "altoc.runtime", "current_user": "person-a", io.ServiceCommandEnvelopeKey: map[string]any{"operationId": frozenID, "operationCode": altocActivationProjectOperation, "targetApp": "aims", "requiredCapability": "aims:write", "idempotencyKey": frozenKey, "commandSchemaVersion": frozenVersion, "commandSha256": frozenDigest, "command": command}}
	}
	targetTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = target.CreateProjectFromContractCommandInTransaction(ctx, targetTx, targetRepo, targetBody()); err != nil {
		targetTx.Rollback()
		t.Fatal(err)
	}
	if err = targetTx.Commit(); err != nil {
		t.Fatal(err)
	}
	var pending int
	db.QueryRow("SELECT COUNT(*) FROM altoc_integration_operation WHERE status='pending'").Scan(&pending)
	if pending != 2 {
		t.Fatal("ACK loss precondition")
	}

	for i := 0; i < 2; i++ {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.ExecuteLocalContractActivationInTransaction(ctx, tx, sourceContext, "aims-test", sourceRepo, targetRepo, target, "CT-1", activation); err != nil {
			tx.Rollback()
			t.Fatal("local activation", err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	var succeeded int
	db.QueryRow("SELECT COUNT(*) FROM altoc_integration_operation WHERE status='succeeded'").Scan(&succeeded)
	if succeeded != 2 {
		t.Fatal("missing source checkpoints")
	}
	var receipts int
	db.QueryRow("SELECT COUNT(*) FROM aims_service_command_receipt").Scan(&receipts)
	if receipts != 2 {
		t.Fatal("target receipts duplicated")
	}

}
