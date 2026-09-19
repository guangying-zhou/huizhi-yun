package enterprisescheduler

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	assetsapp "github.com/huizhi-yun/data-runtime/internal/apps/assets"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type assetsDueTestCandidate struct {
	EventVersion  string `json:"eventVersion"`
	ActionableKey string `json:"actionableKey"`
	Phase         string `json:"phase"`
	SourceType    string `json:"sourceType"`
	SourceID      int64  `json:"sourceId"`
}

type assetsDueTestPage struct {
	Items    []assetsDueTestCandidate `json:"items"`
	Closures []dueTestClosure         `json:"closures"`
}

func TestSchedulerRegistryMappedAssetsDueNotificationMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ENTERPRISE_SCHEDULER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires dedicated temporary MySQL")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("refusing non-isolated socket")
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
	schema := "hzy_assets_due_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE `" + schema + "`"); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE `" + schema + "`")
	mc.DBName = schema
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatal(q, err)
		}
	}
	ddl, err := os.ReadFile("../../../assets/docs/assets_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	mapping := map[string]string{}
	schedulerRenamedTables(t, db, string(ddl), mapping, assetsapp.EnterpriseDueNotificationViewNames()...)
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-a','v1',0)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"assets": {OwnerDeployment: "assets-owner", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified}}}
	ctx := context.Background()
	// Views are installed while the persistent generation is parked, as a
	// controlled migration does; request transactions never perform DDL.
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "assets", assetsapp.EnterpriseDueNotificationViewNames())
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "assets", assetsapp.EnterpriseDueNotificationViewNames(), plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err = registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	if _, err = NewAssetsDueService(registry, b, "real-assets-worker", "aims.runtime"); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("borrowed Aims client accepted for the Assets worker", err)
	}
	service, err := NewAssetsDueService(registry, b, "real-assets-worker", "assets.runtime")
	if err != nil {
		t.Fatal(err)
	}
	identity := e.SchedulerIdentity{Tenant: "tenant-a", Deployment: "real-assets-worker", SourceApp: "assets", ClientID: "assets.runtime", Subject: "assets.runtime"}

	asOf := time.Now().UTC().Truncate(time.Second)
	exec("INSERT INTO u_asset_items(asset_code,asset_name,asset_category,asset_subtype,dept_code,status,owner_uid) VALUES('RES-1','Cloud subscription','resource','subscription','D1','active','owner-1')")
	var assetID int64
	if err = db.QueryRow("SELECT id FROM u_asset_items WHERE asset_code='RES-1'").Scan(&assetID); err != nil {
		t.Fatal(err)
	}
	exec("INSERT INTO u_asset_resource_details(asset_id,resource_type,expires_at) VALUES(?,'infrastructure',?)", assetID, asOf.AddDate(0, 0, 5).Format("2006-01-02"))
	checkpoints := func() int {
		t.Helper()
		var n int
		if err := db.QueryRow("SELECT COUNT(*) FROM u_assets_notification_checkpoint").Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	scanBody := func() map[string]any {
		return map[string]any{"stream": "resource_expiry", "asOf": asOf.Format(time.RFC3339), "limit": float64(50)}
	}
	scan := func() assetsDueTestPage {
		t.Helper()
		out, err := service.DueNotification(ctx, identity, "scan-due", scanBody())
		if err != nil {
			t.Fatal(err)
		}
		raw, err := json.Marshal(out)
		if err != nil {
			t.Fatal(err)
		}
		var page assetsDueTestPage
		if err = json.Unmarshal(raw, &page); err != nil {
			t.Fatal(err)
		}
		return page
	}

	bad := identity
	bad.SourceApp = "aims"
	if _, err = service.DueNotification(ctx, bad, "scan-due", scanBody()); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("borrowed identity accepted", err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=2 WHERE id=1")
	if _, err = service.DueNotification(ctx, identity, "scan-due", scanBody()); !errors.Is(err, e.ErrBindingMismatch) {
		t.Fatal("stale generation accepted", err)
	}
	exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1")
	if n := checkpoints(); n != 0 {
		t.Fatalf("rejected scans wrote %d checkpoints", n)
	}

	page := scan()
	if len(page.Items) != 1 || page.Items[0].SourceType != "asset_item" || page.Items[0].SourceID != assetID || page.Items[0].Phase == "" {
		t.Fatalf("unexpected first scan: %+v", page)
	}
	candidate := page.Items[0]
	if again := scan(); len(again.Items) != 1 || again.Items[0].EventVersion != candidate.EventVersion || checkpoints() != 1 {
		t.Fatalf("rescan was not idempotent: %+v checkpoints=%d", again, checkpoints())
	}

	ack := map[string]any{"stream": "resource_expiry", "sourceType": "asset_item", "sourceId": float64(assetID), "eventVersion": candidate.EventVersion, "notificationId": "n-1", "recipientUid": "owner-1"}
	if out, err := service.DueNotification(ctx, identity, "acknowledge", ack); err != nil || out["acknowledged"] != true {
		t.Fatal("acknowledge", out, err)
	}
	if out, err := service.DueNotification(ctx, identity, "acknowledge", ack); err != nil || out["idempotent"] != true {
		t.Fatal("acknowledge replay", out, err)
	}
	// Only a recorded candidate recipient may be acknowledged.
	stranger := map[string]any{"eventVersion": candidate.EventVersion, "notificationId": "n-1", "recipientUid": "stranger"}
	var domainError httperror.Error
	if _, err = service.DueNotification(ctx, identity, "acknowledge", stranger); !errors.As(err, &domainError) || domainError.Status != 409 {
		t.Fatal("non-candidate recipient accepted", err)
	}
	if after := scan(); len(after.Items) != 0 {
		t.Fatalf("acknowledged candidate still pending: %+v", after)
	}

	exec("UPDATE u_asset_items SET status='inactive' WHERE id=?", assetID)
	closed := scan()
	if len(closed.Closures) != 1 || closed.Closures[0].RecipientUID != "owner-1" || closed.Closures[0].State != "resolved" {
		t.Fatalf("closure not produced: %+v", closed)
	}
	closure := closed.Closures[0]
	if out, err := service.DueNotification(ctx, identity, "acknowledge-closure", map[string]any{"eventVersion": closure.CheckpointEventVersion, "nextVersion": closure.NextVersion}); err != nil || out["acknowledged"] != true {
		t.Fatal("closure acknowledge", out, err)
	}
	if final := scan(); len(final.Closures) != 0 || len(final.Items) != 0 {
		t.Fatalf("closure still pending: %+v", final)
	}

	exec("DROP VIEW `assets_notification_checkpoint`")
	domainError = httperror.Error{}
	if _, err = service.DueNotification(ctx, identity, "scan-due", scanBody()); !errors.As(err, &domainError) || domainError.Status != 503 || domainError.Code != "enterprise_due_notification_views_unavailable" {
		t.Fatal("missing view did not fail closed", err)
	}
	t.Log("Assets worker binding + real Registry generation guard -> fenced due scan/checkpoint/ack/closure; borrowed client/identity and stale generation zero-write, idempotent rescan, ack replay, non-candidate refusal and missing-view refusal passed")
}
