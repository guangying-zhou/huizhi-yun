package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

func financeFixture(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	socket := os.Getenv("HZY_DOMAIN_INSTALL_SOCKET")
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
	root, e := sql.Open("mysql", mc.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { root.Close() })
	name := "hzy_wp3_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() {
		if _, e := root.Exec("DROP DATABASE " + name); e != nil {
			t.Error(e)
		}
	})
	mc.DBName = name
	db, e := sql.Open("mysql", mc.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	for _, q := range []string{"CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(30),environment_code VARCHAR(30),runtime_deployment VARCHAR(80),schema_version VARCHAR(30),generation BIGINT) ENGINE=InnoDB", "INSERT INTO enterprise_schema_registry VALUES(1,'C000001','test','runtime-test','v1',7)"} {
		if _, e = db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	var instance string
	db.QueryRow("SELECT @@server_uuid").Scan(&instance)
	b := enterprise.Binding{Key: enterprise.BindingKey{Tenant: "C000001", Environment: "test", RuntimeDeployment: "runtime-test"}, Storage: enterprise.Storage{Database: name, InstanceID: instance, Address: "127.0.0.1:3306"}, SchemaVersion: "v1", Generation: 7, Domains: map[string]enterprise.DomainBinding{}}
	b, e = domaininstall.WithAPF(b, "host-test")
	if e != nil {
		t.Fatal(e)
	}
	d := b.Domains["finance"]
	d.Write = enterprise.PathUnified
	b.Domains["finance"] = d
	tables, _ := domaininstall.APFTables("finance")
	for _, v := range tables {
		if _, e = db.Exec(v.DDL); e != nil {
			t.Fatal(e)
		}
	}
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e := New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	return s, db
}
func TestAPFFinanceFullMySQL(t *testing.T) {
	s, db := financeFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "marked-create", RequestID: "isolated"}
	call := func(op string, i FinanceInput) map[string]any {
		t.Helper()
		out, e := s.Finance(ctx, op, i, who)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)
	}
	created := call("accounts-create", accountInput())["data"].(map[string]any)
	code := created["code"].(string)
	if !strings.HasPrefix(code, "BA-") || created["account_no_secret_ref"] != nil {
		t.Fatal("response leaked or no auto code")
	}
	replay := call("accounts-create", accountInput())["data"].(map[string]any)
	if replay["code"] != code {
		t.Fatal("duplicate create")
	}
	changed := accountInput()
	changed.Payload["accountName"] = "different"
	if _, e := s.Finance(ctx, "accounts-create", changed, who); e == nil {
		t.Fatal("intent conflict")
	}
	page := call("accounts-list", FinanceInput{Page: 1, PageSize: 1, Search: "isolated", Status: "active"})
	if page["total"] != int64(1) {
		t.Fatal(page)
	}
	patch := FinanceInput{Code: code, Payload: map[string]any{"accountName": "edited", "expectedVersion": float64(1), "status": "inactive"}}
	who.Key = "marked-update"
	updated := call("accounts-update", patch)["data"].(map[string]any)
	if updated["row_version"] != float64(2) {
		t.Fatal(updated)
	}
	// Old-key replay returns the original snapshot even after newer mutation.
	who.Key = "marked-next"
	newPatch := FinanceInput{Code: code, Payload: map[string]any{"accountName": "newer", "expectedVersion": float64(2)}}
	call("accounts-update", newPatch)
	who.Key = "marked-update"
	old := call("accounts-update", patch)["data"].(map[string]any)
	if old["row_version"] != float64(2) || old["account_name"] != "edited" {
		t.Fatal("not original receipt snapshot")
	}
	who.Key = "stale"
	if _, e := s.Finance(ctx, "accounts-update", patch, who); e == nil {
		t.Fatal("stale accepted")
	}
	var id int64
	db.QueryRow("SELECT id FROM finance_bank_account WHERE code=?", code).Scan(&id)
	if _, e := db.Exec("INSERT INTO finance_account_balance_snapshot(bank_account_id,snapshot_date,balance_amount) VALUES(?, '2026-10-01','9999999999999999.99')", id); e != nil {
		t.Fatal(e)
	}
	balances := call("balances-list", FinanceInput{Page: 1, PageSize: 1, AccountCode: code, StartDate: "2026-10-01", EndDate: "2026-10-01"})
	if balances["total"] != int64(1) || balances["data"].([]map[string]any)[0]["balance_amount"] != "9999999999999999.99" {
		t.Fatal(balances)
	}
	who.Key = "param-create"
	param := parameterInput("2026-01-01", "2026-01-31")
	p := call("parameters-create", param)["data"].(map[string]any)
	pcode := p["code"].(string)
	if p["base_salary"] != "1234567890123456.01" {
		t.Fatal("decimal rounded", p)
	}
	who.Key = "overlap"
	if _, e := s.Finance(ctx, "parameters-create", parameterInput("2026-01-31", "2026-02-02"), who); e == nil {
		t.Fatal("closed intervals overlap")
	}
	who.Key = "param-update"
	param.Code = pcode
	param.Payload["expectedVersion"] = float64(1)
	param.Payload["name"] = "version2"
	call("parameters-update", param)
	history := call("parameters-history", FinanceInput{Code: pcode, Page: 1, PageSize: 1})
	if history["total"] != int64(2) || len(history["data"].([]map[string]any)) != 1 {
		t.Fatal(history)
	}

	var count int
	if e := db.QueryRow("SELECT COUNT(*) FROM finance_service_command_receipt").Scan(&count); e != nil || count != 5 {
		t.Fatal("failed writes left receipts", count, e)
	}
	// Two concurrent empty/new interval writers cannot both commit overlapping facts.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for n := 0; n < 2; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			w := who
			w.Key = string(rune('a'+n)) + "-race"
			_, e := s.Finance(ctx, "parameters-create", parameterInput("2027-01-01", "2027-01-31"), w)
			results <- e
		}(n)
	}
	wg.Wait()
	close(results)
	success := 0
	for e := range results {
		if e == nil {
			success++
		} else {
			var safe httperror.Error
			if !errors.As(e, &safe) {
				t.Fatal("unsafe concurrent error", e)
			}
		}
	}
	if success != 1 {
		t.Fatal("concurrent overlap", success)
	}
	// Failure after business mutation must roll back both the fact and receipt.
	var bankBefore, receiptBefore int
	db.QueryRow("SELECT COUNT(*) FROM finance_bank_account").Scan(&bankBefore)
	db.QueryRow("SELECT COUNT(*) FROM finance_service_command_receipt").Scan(&receiptBefore)
	if _, e := db.Exec("CREATE TRIGGER wp3_audit_fault BEFORE INSERT ON finance_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "audit-fault"
	if _, e := s.Finance(ctx, "accounts-create", accountInput(), who); e == nil {
		t.Fatal("fault committed")
	}
	var bankAfter, receiptAfter int
	db.QueryRow("SELECT COUNT(*) FROM finance_bank_account").Scan(&bankAfter)
	db.QueryRow("SELECT COUNT(*) FROM finance_service_command_receipt").Scan(&receiptAfter)
	if bankAfter != bankBefore || receiptAfter != receiptBefore {
		t.Fatal("partial Finance transaction")
	}
	if _, e := db.Exec("DROP TRIGGER wp3_audit_fault"); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("UPDATE enterprise_schema_registry SET generation=8 WHERE id=1"); e != nil {
		t.Fatal(e)
	}
	who.Key = "marked-create"
	if _, e := s.Finance(ctx, "accounts-create", accountInput(), who); e == nil {
		t.Fatal("generation revoked replay")
	}
}
