package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/migrationlock"
)

func enterpriseProductFixture(t *testing.T) (*sql.DB, e.Binding, []string) {
	t.Helper()
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-ENTERPRISE")
	var schema, instance string
	if err := db.QueryRow("SELECT DATABASE(),@@server_uuid").Scan(&schema, &instance); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME", schema)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	var renames []string
	mapping := map[string]string{}
	for _, name := range names {
		mapping[name] = "aims_" + name
		renames = append(renames, "`"+name+"` TO `aims_"+name+"`")
	}
	if _, err := db.Exec("RENAME TABLE " + strings.Join(renames, ",")); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE assets_product_assets(product_code VARCHAR(64) PRIMARY KEY,product_name VARCHAR(255)) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO assets_product_assets VALUES('P-ENTERPRISE','before')"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(100),environment_code VARCHAR(100),runtime_deployment VARCHAR(100),schema_version VARCHAR(100),generation BIGINT UNSIGNED) ENGINE=InnoDB"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant','test','runtime','v1',0)"); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant", Environment: "test", RuntimeDeployment: "runtime"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-deployment", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}, "assets": {OwnerDeployment: "assets-deployment", Tables: map[string]string{"product_assets": "assets_product_assets"}, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathDisabled}}}
	sort.Strings(names)
	return db, b, names
}
func TestMySQLEnterpriseManagedViewsSharedTransaction(t *testing.T) {
	db, b, names := enterpriseProductFixture(t)
	ctx := context.Background()
	// A logical name present in both domains cannot become a compatibility view.
	conflict := b
	conflict.Domains = map[string]e.DomainBinding{"aims": b.Domains["aims"], "assets": b.Domains["assets"]}
	other := conflict.Domains["assets"]
	other.Tables = map[string]string{"product_requests": "assets_other_requests"}
	conflict.Domains["assets"] = other
	if _, err := e.PlanCompatibilityViews(ctx, db, conflict, "aims", []string{"product_requests"}); !errors.Is(err, e.ErrCompatibilityView) {
		t.Fatal("ambiguous cross-domain alias accepted", err)
	}
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", names)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Views) != len(names) {
		t.Fatal("fixture did not cover the full productcenter table set")
	}
	blocker, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	release, err := migrationlock.Acquire(ctx, blocker, b.Storage.InstanceID, b.Storage.Database)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.ApplyCompatibilityViews(ctx, db, b, "aims", names, plan.ReviewHash); err == nil {
		t.Fatal("view DDL bypassed activation lock")
	}
	var created int
	if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.VIEWS WHERE TABLE_SCHEMA=?", b.Storage.Database).Scan(&created); err != nil || created != 0 {
		t.Fatal("blocked installer performed partial DDL", err)
	}
	release()
	blocker.Close()
	if err := e.ApplyCompatibilityViews(ctx, db, b, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal("install views", err)
	}
	if err := e.ApplyCompatibilityViews(ctx, db, b, "aims", names, plan.ReviewHash); err != nil {
		t.Fatal("canonical definition replay", err)
	}
	// A generation transition uses the same session lock as the real cutover;
	// after commit an old generation-zero plan can no longer execute any DDL.
	activator, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	release, err = migrationlock.Acquire(ctx, activator, b.Storage.InstanceID, b.Storage.Database)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := activator.ExecContext(ctx, "UPDATE enterprise_schema_registry SET generation=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	release()
	activator.Close()
	if err := e.ApplyCompatibilityViews(ctx, db, b, "aims", names, plan.ReviewHash); !errors.Is(err, e.ErrCompatibilityView) {
		t.Fatal("active-generation DDL accepted", err)
	}
	if err := e.VerifyCompatibilityViews(ctx, db, b, "aims", names); err != nil {
		t.Fatal("active view verification", err)
	}
	permit := func() AuthorizationPermit {
		p := workspacePermit(t, db, "P-ENTERPRISE", "pm", "create")
		p.Resource = "product_requests"
		return p
	}
	identity := CommandIdentity{ProductCode: "P-ENTERPRISE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "same-logical-command"}
	input := RequestDraft{ExpectedRevision: 1, Title: "Unified request", ProblemStatement: "One transaction", SourceType: "internal", UrgencyLevel: "P2"}
	// Force a late owning-domain failure after its request/receipt mutation.
	if _, err := db.Exec("CREATE TRIGGER fail_enterprise_audit BEFORE INSERT ON aims_product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated audit failure'"); err != nil {
		t.Fatal(err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE assets_product_assets SET product_name='must rollback' WHERE product_code='P-ENTERPRISE'"); err != nil {
		t.Fatal(err)
	}
	if _, err := CreateProductRequestInTransaction(ctx, tx, identity, permit(), input); err == nil {
		t.Fatal("audit failure did not abort combined transaction")
	}
	if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
		t.Fatal("caller could commit partial facts after failed domain command", err)
	}
	var name string
	if err := db.QueryRow("SELECT product_name FROM assets_product_assets").Scan(&name); err != nil || name != "before" {
		t.Fatal("Assets mutation escaped rollback", err)
	}
	for _, table := range []string{"aims_product_requests", "aims_product_command_receipts", "aims_product_activity_logs"} {
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&n); err != nil || n != 0 {
			t.Fatal("partial Aims facts", table, n, err)
		}
	}
	if _, err := db.Exec("DROP TRIGGER fail_enterprise_audit"); err != nil {
		t.Fatal(err)
	}
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE assets_product_assets SET product_name='committed' WHERE product_code='P-ENTERPRISE'"); err != nil {
		t.Fatal(err)
	}
	stalePermit := permit()
	first, err := CreateProductRequestInTransaction(ctx, tx, identity, permit(), input)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	replay, err := CreateProductRequest(ctx, db, identity, permit(), input)
	var firstValue, replayValue map[string]any
	firstDecode, replayDecode := json.Unmarshal(first.Value, &firstValue), json.Unmarshal(replay.Value, &replayValue)
	if err != nil || !replay.Replayed || first.ReceiptID != replay.ReceiptID || firstDecode != nil || replayDecode != nil || !reflect.DeepEqual(firstValue, replayValue) {
		t.Fatal("old entry did not replay committed coordinated receipt", err)
	}
	if _, err := CreateProductRequest(ctx, db, identity, stalePermit, input); err == nil {
		t.Fatal("stale authorization replayed receipt through view")
	} else {
		requireProductRule(t, err, "product_authorization_changed")
	}
	mismatchTx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mismatchTx.ExecContext(ctx, "UPDATE assets_product_assets SET product_name='mismatched replay'"); err != nil {
		t.Fatal(err)
	}
	mismatch := input
	mismatch.Title = "different payload"
	if _, err := CreateProductRequestInTransaction(ctx, mismatchTx, identity, permit(), mismatch); err == nil {
		t.Fatal("different payload reused view receipt")
	} else {
		requireProductRule(t, err, "idempotency_payload_mismatch")
	}
	if err := mismatchTx.Commit(); !errors.Is(err, sql.ErrTxDone) {
		t.Fatal("mismatched replay committed other-domain mutation", err)
	}
	var requestCount, receiptCount, revision int
	if err := db.QueryRow("SELECT (SELECT COUNT(*) FROM aims_product_requests),(SELECT COUNT(*) FROM aims_product_command_receipts),(SELECT revision FROM aims_product_workspaces WHERE product_code='P-ENTERPRISE')").Scan(&requestCount, &receiptCount, &revision); err != nil || requestCount != 1 || receiptCount != 1 || revision != 2 {
		t.Fatal("duplicate coordinated mutation", err)
	}
	// Early payload validation must abort preceding cross-domain mutations too.
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE assets_product_assets SET product_name='invalid draft'"); err != nil {
		t.Fatal(err)
	}
	invalidDraft := input
	invalidDraft.Title = ""
	if _, err := CreateProductRequestInTransaction(ctx, tx, identity, permit(), invalidDraft); err == nil {
		t.Fatal("invalid draft accepted")
	}
	if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT product_name FROM assets_product_assets").Scan(&name); err != nil || name != "committed" {
		t.Fatal("early validation did not roll back", err)
	}
	// The generic transaction entry must never swallow authorization failures.
	tx, err = db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, "UPDATE assets_product_assets SET product_name='unauthorized'"); err != nil {
		t.Fatal(err)
	}
	_, err = ExecuteCommandInTransaction(ctx, tx, identity, input, func(context.Context, *sql.Tx) error { return fmt.Errorf("denied") }, func(context.Context, *sql.Tx) (any, error) { t.Fatal("unauthorized apply invoked"); return nil, nil })
	if err == nil {
		t.Fatal("missing authorization failure")
	}
	if err := tx.Commit(); !errors.Is(err, sql.ErrTxDone) {
		t.Fatal(err)
	}
	// A changed view definition is never silently replaced in active storage.
	if _, err := db.Exec("CREATE OR REPLACE SQL SECURITY INVOKER VIEW product_requests AS SELECT * FROM aims_product_requests WHERE id<0"); err != nil {
		t.Fatal(err)
	}
	if err := e.VerifyCompatibilityViews(ctx, db, b, "aims", names); !errors.Is(err, e.ErrCompatibilityView) {
		t.Fatal("view definition drift accepted", err)
	}
	t.Logf("%d managed productcenter views: actual DML, shared rollback, commit and old-entry receipt replay", len(names))
}

func TestMySQLEnterpriseWriteTransactionGenerationFence(t *testing.T) {
	db, b, _ := enterpriseProductFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := db.ExecContext(ctx, "UPDATE enterprise_schema_registry SET generation=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	// The private fixture owns these borrowed pools and drops its databases before closing them.
	if err := registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	requests := []e.ResolveRequest{}
	for _, domain := range []string{"aims", "assets"} {
		requests = append(requests, e.ResolveRequest{Key: b.Key, Domain: domain, OwnerDeployment: b.Domains[domain].OwnerDeployment, SchemaVersion: b.SchemaVersion, Generation: b.Generation, Operation: e.Write})
	}

	// A tenant key cannot select another tenant's registered pool.
	wrong := requests[0]
	wrong.Key.Tenant = "other-tenant"
	if tx, _, err := registry.BeginWriteTransaction(ctx, wrong); err == nil || tx != nil {
		if tx != nil {
			tx.Rollback()
		}
		t.Fatal("wrong tenant accepted")
	}
	otherDB, otherBinding, _ := enterpriseProductFixture(t)
	otherBinding.Key.Tenant = "other-tenant"
	// One registry can own distinct tenant stores but cannot combine them.
	combined := e.NewRegistry(func(_ context.Context, s e.Storage) (*sql.DB, error) {
		if s.Database == b.Storage.Database {
			return db, nil
		}
		return otherDB, nil
	})
	if err := combined.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	if err := combined.Register(ctx, otherBinding); err != nil {
		t.Fatal(err)
	}
	cross := requests[1]
	cross.Key = otherBinding.Key
	if tx, _, err := combined.BeginWriteTransaction(ctx, requests[0], cross); !errors.Is(err, e.ErrBindingMismatch) || tx != nil {
		if tx != nil {
			tx.Rollback()
		}
		t.Fatal("different tenant pools combined", err)
	}
	// Persistent identity mismatch also fails when the in-memory key is valid.
	if _, err := db.ExecContext(ctx, "UPDATE enterprise_schema_registry SET tenant_code='wrong' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if tx, _, err := registry.BeginWriteTransaction(ctx, requests...); !errors.Is(err, e.ErrBindingMismatch) || tx != nil {
		if tx != nil {
			tx.Rollback()
		}
		t.Fatal("persistent tenant mismatch accepted", err)
	}
	if _, err := db.ExecContext(ctx, "UPDATE enterprise_schema_registry SET tenant_code='tenant' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	writer, domains, err := registry.BeginWriteTransaction(ctx, requests...)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback()
	if len(domains) != 2 || domains[0].DB != domains[1].DB {
		t.Fatal("cross-domain pool mismatch")
	}
	if _, err := writer.ExecContext(ctx, "UPDATE assets_product_assets SET product_name='generation-one-write'"); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := db.ExecContext(ctx, "UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
		done <- err
	}()
	waiting := false
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON w.BLOCKING_ENGINE_LOCK_ID=l.ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=? AND l.OBJECT_NAME='enterprise_schema_registry'", b.Storage.Database).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			waiting = true
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !waiting {
		t.Fatal("generation change did not wait on active writer registry lock")
	}
	select {
	case err := <-done:
		t.Fatal("generation transition escaped writer", err)
	default:
	}
	if err := writer.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	tx, resolved, err := registry.BeginWriteTransaction(ctx, requests...)
	if tx != nil {
		tx.Rollback()
	}
	if !errors.Is(err, e.ErrBindingMismatch) || tx != nil || resolved != nil {
		t.Fatal("stale in-memory registry accepted after persistent generation change", err)
	}
	var name string
	if err := db.QueryRowContext(ctx, "SELECT product_name FROM assets_product_assets").Scan(&name); err != nil || name != "generation-one-write" {
		t.Fatal("authorized writer lost its committed fact", err)
	}
	t.Log("actual InnoDB wait observed: generation transition waits for writer commit; stale registry rejected afterward")
}
