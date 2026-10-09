package enterpriseapf

import (
	"context"
	"database/sql"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"

	"os"
	"path/filepath"
	"strings"

	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"sync"
	"testing"
)

func customerFixture(t *testing.T) (*Service, *sql.DB) {
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
	name := "hzy_wp4a_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	d := b.Domains["altoc"]
	d.Write = enterprise.PathUnified
	b.Domains["altoc"] = d
	tables, _ := domaininstall.APFTables("altoc")
	db.Exec("SET FOREIGN_KEY_CHECKS=0")
	for _, v := range tables {
		if _, e = db.Exec(v.DDL); e != nil {
			t.Fatal(e)
		}
	}
	db.Exec("SET FOREIGN_KEY_CHECKS=1")
	registry := enterprise.NewRegistry(func(context.Context, enterprise.Storage) (*sql.DB, error) { return db, nil })
	if e = registry.Register(context.Background(), b); e != nil {
		t.Fatal(e)
	}
	s, e := New(registry, b)
	if e != nil {
		t.Fatal(e)
	}
	s.ConfigureOwnerDirectory(testOwnerDirectory)
	return s, db
}
func TestAPFCustomerMainChainMySQL(t *testing.T) {
	s, db := customerFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "customer-create", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	call := func(op string, i CustomerInput) map[string]any {
		t.Helper()
		o, e := s.Customer(ctx, op, i, who, scope)
		if e != nil {
			t.Fatal(op, e)
		}
		return o.(map[string]any)["data"].(map[string]any)
	}
	ci := CustomerInput{Payload: map[string]any{"name": "标记客户", "owner_uid": "person", "owner_dept_code": "D1"}}
	first := call("customers-create", ci)
	again := call("customers-create", ci)
	if first["id"] != again["id"] {
		t.Fatal("duplicate customer")
	}
	id := fmt.Sprint(first["id"])
	var n int
	db.QueryRow("SELECT COUNT(*) FROM altoc_customer").Scan(&n)
	if n != 1 {
		t.Fatal("create repeated")
	}
	who.Key = "customer-update"
	u := CustomerInput{CustomerID: id, Payload: map[string]any{"name": "更新客户", "expectedVersion": float64(1)}}
	call("customers-update", u)
	who.Key = "customer-update-2"
	u.Payload["name"] = "再次更新"
	u.Payload["expectedVersion"] = float64(2)
	call("customers-update", u)
	who.Key = "contact-create"
	c := CustomerInput{CustomerID: id, Payload: map[string]any{"name": "标记联系人", "mobile": "123"}}
	contact := call("contacts-create", c)
	c.ChildCode = fmt.Sprint(contact["code"])
	c.Payload = map[string]any{"name": "改名", "expectedVersion": float64(1)}
	who.Key = "contact-update"
	call("contacts-update", c)
	who.Key = "contact-delete"
	c.Payload = map[string]any{"expectedVersion": float64(2)}
	call("contacts-delete", c)
	call("contacts-delete", c)
	who.Key = "invoice-create-1"
	p := CustomerInput{CustomerID: id, Payload: map[string]any{"taxpayer_name": "抬头甲", "is_default": true}}
	one := call("invoice-profiles-create", p)
	who.Key = "invoice-create-2"
	p.Payload["taxpayer_name"] = "抬头乙"
	two := call("invoice-profiles-create", p)
	db.QueryRow("SELECT COUNT(*) FROM altoc_customer_invoice_profile WHERE is_default=1 AND deleted_at IS NULL").Scan(&n)
	if n != 1 {
		t.Fatal("default uniqueness")
	}
	who.Key = "invoice-update"
	p.ChildCode = fmt.Sprint(two["code"])
	p.Payload = map[string]any{"taxpayer_name": "抬头更新", "expectedVersion": float64(1)}
	call("invoice-profiles-update", p)
	who.Key = "invoice-default"
	p.ChildCode = fmt.Sprint(one["code"])
	p.Payload = map[string]any{"expectedVersion": float64(2)}
	call("invoice-profiles-set-default", p)
	who.Key = "invoice-delete"
	p.Payload = map[string]any{"expectedVersion": float64(3)}
	call("invoice-profiles-delete", p)
	read, e := s.CustomerRead(ctx, id, "person", scope, altoc.BasicReadQuery{Page: 1, PageSize: 20})
	if e != nil {
		t.Fatal(e)
	}
	r := read.(map[string]any)
	if len(r["contacts"].([]map[string]any)) != 0 || len(r["invoice_profiles"].([]map[string]any)) != 1 {
		t.Fatal("children visibility")
	}
	who.Key = "owner-denied"
	if _, e = s.Customer(ctx, "customers-set-owner", CustomerInput{CustomerID: id, Payload: map[string]any{"owner_uid": "other", "expectedVersion": float64(3)}}, who, scope); e == nil {
		t.Fatal("owner moved outside scope")
	}
	who.Key = "owner-ok"
	call("customers-set-owner", CustomerInput{CustomerID: id, Payload: map[string]any{"owner_uid": "person", "owner_dept_code": "D2", "expectedVersion": float64(3)}})
	who.Key = "customer-create-other"
	scope = altoc.BasicReadScope{Access: "all"}
	ci.Payload["name"] = "另一客户"
	other := call("customers-create", ci)
	who.Key = "cross-parent"
	if _, e = s.Customer(ctx, "contacts-update", CustomerInput{CustomerID: fmt.Sprint(other["id"]), ChildCode: fmt.Sprint(contact["code"]), Payload: map[string]any{"name": "越权", "expectedVersion": float64(3)}}, who, scope); e == nil {
		t.Fatal("foreign child accepted")
	}
	// Per-customer lock + unique default slot: two concurrent writes cannot commit two defaults.
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for j := 0; j < 2; j++ {
		wg.Add(1)
		go func(j int) {
			defer wg.Done()
			w := who
			w.Key = fmt.Sprint("concurrent-", j)
			_, e := s.Customer(ctx, "invoice-profiles-create", CustomerInput{CustomerID: id, Payload: map[string]any{"taxpayer_name": fmt.Sprint("并发", j), "is_default": true}}, w, scope)
			results <- e
		}(j)
	}
	wg.Wait()
	close(results)
	successful := 0
	for err := range results {
		if err == nil {
			successful++
			continue
		}
		var known httperror.Error
		if !errors.As(err, &known) || known.Status != 409 {
			t.Fatal("unexpected concurrent failure", err)
		}
	}
	if successful == 0 {
		t.Fatal("no concurrent operation committed")
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_customer_invoice_profile WHERE customer_id=? AND is_default=1 AND deleted_at IS NULL", id).Scan(&n)
	if n != 1 {
		t.Fatal("concurrent default uniqueness")
	}
	// A rejected audit append rolls back both the child and its receipt.
	var before, after int
	db.QueryRow("SELECT COUNT(*) FROM altoc_contact").Scan(&before)
	if _, e := db.Exec("CREATE TRIGGER wp4a_fault BEFORE INSERT ON altoc_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "audit-fault"
	if _, e := s.Customer(ctx, "contacts-create", CustomerInput{CustomerID: id, Payload: map[string]any{"name": "故障"}}, who, scope); e == nil {
		t.Fatal("fault committed")
	}
	db.QueryRow("SELECT COUNT(*) FROM altoc_contact").Scan(&after)
	if before != after {
		t.Fatal("partial customer mutation")
	}
	var failedReceipts int
	db.QueryRow("SELECT COUNT(*) FROM altoc_service_command_receipt WHERE idempotency_key='audit-fault'").Scan(&failedReceipts)
	if failedReceipts != 0 {
		t.Fatal("failed receipt committed")
	}
	db.Exec("DROP TRIGGER wp4a_fault")
	// Replay must recheck current owner before consulting the receipt.
	db.Exec("UPDATE altoc_customer SET owner_uid='other' WHERE id=?", id)
	who.Key = "customer-update"
	u.Payload = map[string]any{"name": "更新客户", "expectedVersion": float64(1)}
	if _, e = s.Customer(ctx, "customers-update", u, who, altoc.BasicReadScope{Access: "self"}); e == nil {
		t.Fatal("revoked replay")
	}
}

func TestAPFCustomerCreateReplayChecksCurrentScopeMySQL(t *testing.T) {
	s, db := customerFixture(t)
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "create-scope", RequestID: "isolated"}
	i := CustomerInput{Payload: map[string]any{"name": "标记", "owner_uid": "person"}}
	scope := altoc.BasicReadScope{Access: "self"}
	if _, e := s.Customer(context.Background(), "customers-create", i, who, scope); e != nil {
		t.Fatal(e)
	}
	if _, e := db.Exec("UPDATE altoc_customer SET owner_uid='other'"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.Customer(context.Background(), "customers-create", i, who, scope); e == nil {
		t.Fatal("create receipt bypassed revoked relation")
	}
}
