package aims

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestContractReceiptsSharedTransactionMySQL(t *testing.T) {
	socket := os.Getenv("HZY_CONTRACT_RECEIPT_SOCKET")
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
	source, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	exec(db, "SET FOREIGN_KEY_CHECKS=0")
	tables := regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1)
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
	repo, err := io.NewReceiptRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	body := func(op, key string, command map[string]any) map[string]any {
		raw, _ := json.Marshal(command)
		hash := sha256.Sum256(raw)
		return map[string]any{io.TrustedServiceCommandTenantKey: "tenant-a", io.TrustedServiceCommandSourceDeploymentKey: "altoc-test", io.TrustedServiceCommandTargetDeploymentKey: "aims-test", io.TrustedServiceCommandSourceAppKey: "altoc", io.TrustedServiceCommandTargetAppKey: "aims", io.TrustedServiceCommandSourceClientKey: "altoc.runtime", "current_user": "person-a", io.ServiceCommandEnvelopeKey: map[string]any{"operationId": uuid.NewString(), "operationCode": op, "targetApp": "aims", "requiredCapability": "aims:write", "idempotencyKey": key, "commandSchemaVersion": "v1", "commandSha256": hex.EncodeToString(hash[:]), "command": command}}
	}
	project := func() map[string]any {
		return body(contractActivationProjectOperation, "project-key", map[string]any{"contractCode": "CT-1", "projectCode": "PRJ-1", "projectName": "Delivery", "leaderUid": "person-a"})
	}
	milestone := func() map[string]any {
		return body(contractActivationMilestoneOperation, "milestone-key", map[string]any{"projectCode": "PRJ-1", "paymentTerms": []any{map[string]any{"paymentTermId": 1, "termName": "Accept", "termType": "acceptance"}}})
	}
	ctx := context.Background()
	for _, commit := range []bool{false, true} {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = a.CreateProjectFromContractCommandInTransaction(ctx, tx, repo, project()); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if _, err = a.SyncPaymentMilestonesCommandInTransaction(ctx, tx, repo, "PRJ-1", milestone()); err != nil {
			tx.Rollback()
			t.Fatal(err)
		}
		if commit {
			err = tx.Commit()
		} else { // caller's late SQL failure must not commit any completed receipt.
			if _, late := tx.Exec("INSERT INTO deliberately_absent_audit VALUES(1)"); late == nil {
				t.Fatal("late failure missing")
			}
			err = tx.Rollback()
		}
		if err != nil {
			t.Fatal(err)
		}
		for table, want := range map[string]int{"aims_projects": 1, "milestones": 1, "project_lifecycle_events": 1, "project_counters": 1, "aims_project_members": 1, "service_command_receipt": 2} {
			var n int
			if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil {
				t.Fatal(err)
			}
			if !commit {
				want = 0
			}
			if n != want {
				t.Fatalf("%s got%d want%d", table, n, want)
			}
		}
	}
	// Stable operation IDs are part of the receipt identity; read them from the frozen fixture ledger.
	replay := func(b map[string]any) map[string]any {
		env := b[io.ServiceCommandEnvelopeKey].(map[string]any)
		var id string
		if err = db.QueryRow("SELECT operation_id FROM service_command_receipt WHERE idempotency_key=?", env["idempotencyKey"]).Scan(&id); err != nil {
			t.Fatal(err)
		}
		env["operationId"] = id
		return b
	}
	if out, err := a.createProjectFromContractCommand(ctx, replay(project())); err != nil || out["idempotent"] != true {
		t.Fatalf("legacy project replay %v %v", out, err)
	}
	if out, err := a.syncPaymentMilestonesCommand(ctx, "PRJ-1", replay(milestone())); err != nil || out["idempotent"] != true {
		t.Fatalf("legacy milestone replay %v %v", out, err)
	}
	for _, kind := range []string{"source", "path", "payload", "nil-repository"} {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		switch kind {
		case "source":
			b := project()
			b[io.TrustedServiceCommandSourceAppKey] = "assets"
			_, err = a.CreateProjectFromContractCommandInTransaction(ctx, tx, repo, b)
		case "path":
			_, err = a.SyncPaymentMilestonesCommandInTransaction(ctx, tx, repo, "OTHER", replay(milestone()))
		case "payload":
			b := replay(project())
			env := b[io.ServiceCommandEnvelopeKey].(map[string]any)
			command := env["command"].(map[string]any)
			command["projectName"] = "Changed"
			raw, _ := json.Marshal(command)
			hash := sha256.Sum256(raw)
			env["commandSha256"] = hex.EncodeToString(hash[:])
			_, err = a.CreateProjectFromContractCommandInTransaction(ctx, tx, repo, b)
		case "nil-repository":
			_, err = a.CreateProjectFromContractCommandInTransaction(ctx, tx, nil, project())
		}
		if err == nil {
			tx.Rollback()
			t.Fatalf("%s accepted", kind)
		}
		var one int
		if err = tx.QueryRow("SELECT 1").Scan(&one); err != nil {
			t.Fatalf("callee closed caller transaction: %s %v", kind, err)
		}
		tx.Rollback()
	}

}
