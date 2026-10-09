package console

import (
	"context"
	"database/sql"
	"errors"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNotificationPaginationIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_NOTIFICATION_PAGINATION_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	name := "notification_page_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, e = root.Exec("CREATE DATABASE " + name); e != nil {
		t.Fatal(e)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer db.Close()
	exec := func(q string) {
		t.Helper()
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}

	exec("CREATE TABLE portal_notifications(notification_id VARCHAR(40) PRIMARY KEY,source_app_code VARCHAR(40),category VARCHAR(40),severity VARCHAR(40),created_at DATETIME,expires_at DATETIME,title TEXT,body TEXT)")
	exec("CREATE TABLE portal_notification_recipients(id BIGINT PRIMARY KEY,notification_id VARCHAR(40),uid VARCHAR(40),read_at DATETIME,archived_at DATETIME,pinned_at DATETIME,delivery_state VARCHAR(40),updated_at DATETIME)")
	exec("CREATE TABLE console_mutation_receipts(receipt_id VARCHAR(64) PRIMARY KEY,tenant_code VARCHAR(64),operation_code VARCHAR(128),idempotency_key VARCHAR(191),request_sha256 CHAR(64),status VARCHAR(30),actor_type VARCHAR(30),actor_id VARCHAR(128),request_id VARCHAR(64),created_at DATETIME(3),updated_at DATETIME(3),result_json JSON,response_http_status INT,completed_at DATETIME(3),UNIQUE KEY uniq_intent(tenant_code,operation_code,idempotency_key))")
	exec("CREATE TABLE operation_logs(id BIGINT AUTO_INCREMENT PRIMARY KEY,domain_code VARCHAR(64),action VARCHAR(64),target_type VARCHAR(64),target_key VARCHAR(128),actor_type VARCHAR(30),actor_id VARCHAR(128),request_id VARCHAR(64),detail_json JSON,created_at DATETIME)")
	exec("INSERT INTO portal_notifications VALUES('N1','aims','approval','info','2026-01-01',NULL,'SECRET TITLE','SECRET BODY'),('N2','aims','approval','info','2026-01-01',NULL,'SECRET TITLE','SECRET BODY'),('N3','aims','approval','info','2026-01-01',NULL,'SECRET TITLE','SECRET BODY'),('N4','aims','approval','info','2026-01-01',NULL,'SECRET TITLE','SECRET BODY'),('N5','aims','approval','info','2026-01-01','2026-01-02','SECRET TITLE','SECRET BODY'),('N6','aims','approval','info','2026-01-01',NULL,'SECRET TITLE','SECRET BODY'),('N7','console','system','info','2026-01-01',NULL,'SECRET TITLE','SECRET BODY')")
	exec("INSERT INTO portal_notification_recipients(id,notification_id,uid,read_at,archived_at,pinned_at) VALUES(1,'N1','viewer',NULL,NULL,NULL),(2,'N2','viewer',NULL,NULL,'2026-01-02'),(3,'N3','viewer','2026-01-02',NULL,NULL),(4,'N4','viewer',NULL,'2026-01-02',NULL),(5,'N5','viewer',NULL,NULL,NULL),(6,'N6','other',NULL,NULL,NULL),(7,'N7','viewer',NULL,NULL,NULL)")
	a := NewWithDB(config.ConsoleConfig{}, "C000001", db)
	ctx := context.Background()
	legacy, e := a.UserNotifications(ctx, "viewer", url.Values{"status": {"unread"}, "category": {"approval"}, "sourceAppCode": {"aims"}})
	if e != nil {
		t.Fatal(e)
	}
	data := legacy["data"].(map[string]any)
	if len(data["items"].([]map[string]any)) != 2 || len(data) != 2 {
		t.Fatal(legacy)
	}
	q := url.Values{"page": {"2"}, "pageSize": {"1"}, "status": {"unread"}, "category": {"approval"}, "sourceAppCode": {"aims"}}
	out, e := a.UserNotifications(ctx, "viewer", q)
	if e != nil {
		t.Fatal(e)
	}
	data = out["data"].(map[string]any)
	if data["total"] != uint64(2) || data["items"].([]map[string]any)[0]["notificationId"] != "N1" {
		t.Fatal(out)
	}
	for _, item := range data["items"].([]map[string]any) {
		if _, ok := item["body"]; ok {
			t.Fatal("list leaked body")
		}
		if _, ok := item["title"]; ok {
			t.Fatal("list leaked title")
		}
	}
	q.Set("page", "9")
	out, e = a.UserNotifications(ctx, "viewer", q)
	if e != nil || len(out["data"].(map[string]any)["items"].([]map[string]any)) != 0 {
		t.Fatal(out, e)
	}
	q.Set("page", "1")
	q.Set("status", "archived")
	out, e = a.UserNotifications(ctx, "viewer", q)
	if e != nil || out["data"].(map[string]any)["total"] != uint64(1) {
		t.Fatal(out, e)
	}
	q.Set("status", "unread")
	exec("UPDATE portal_notification_recipients SET read_at=NOW() WHERE id=1")
	out, e = a.UserNotifications(ctx, "viewer", q)
	if e != nil || out["data"].(map[string]any)["total"] != uint64(1) {
		t.Fatal(out, e)
	}
	// Cursor mode remains usable after page calls, independently of their metadata.
	out, e = a.UserNotifications(ctx, "viewer", url.Values{"limit": {"1"}, "cursor": {"8"}})
	if e != nil {
		t.Fatal(e)
	}
	if _, ok := out["data"].(map[string]any)["total"]; ok {
		t.Fatal("legacy gained total")
	}
	// A new user intent that writes the same read/archive state must succeed.
	// A recipient belonging to another user remains invisible.
	first, e := a.mutateNotificationRecipient(ctx, "viewer", "N3", "read", MutationMeta{IdempotencyKey: "read-existing-1"})
	if e != nil || first["code"] != 0 {
		t.Fatal("first same-state notification read", first, e)
	}
	second, e := a.mutateNotificationRecipient(ctx, "viewer", "N3", "read", MutationMeta{IdempotencyKey: "read-existing-2"})
	if e != nil || second["code"] != 0 {
		t.Fatal("second same-state notification read", second, e)
	}
	first, e = a.mutateNotificationRecipient(ctx, "viewer", "N4", "archive", MutationMeta{IdempotencyKey: "archive-existing-1"})
	if e != nil || first["code"] != 0 {
		t.Fatal("first same-state notification archive", first, e)
	}
	second, e = a.mutateNotificationRecipient(ctx, "viewer", "N4", "archive", MutationMeta{IdempotencyKey: "archive-existing-2"})
	if e != nil || second["code"] != 0 {
		t.Fatal("second same-state notification archive", second, e)
	}
	_, e = a.mutateNotificationRecipient(ctx, "viewer", "N6", "read", MutationMeta{IdempotencyKey: "read-foreign"})
	var denied httperror.Error
	if !errors.As(e, &denied) || denied.Status != 404 {
		t.Fatal("cross-user notification read", e)
	}
}

func TestNotificationDeliveryIdempotencyIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_NOTIFICATION_PAGINATION_SOCKET")
	if socket == "" {
		t.Skip("temporary MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User, cfg.Net, cfg.Addr = "root", "unix", socket
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "notification_idempotency_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, ddl := range []string{
		`CREATE TABLE portal_notifications (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,notification_id VARCHAR(64) NOT NULL UNIQUE,
			source_app_code VARCHAR(64) NOT NULL,event_type VARCHAR(128),category VARCHAR(64) NOT NULL,
			severity VARCHAR(32) NOT NULL,title VARCHAR(255) NOT NULL,summary VARCHAR(1000),body TEXT,
			action_url VARCHAR(1000),biz_type VARCHAR(64),biz_id VARCHAR(128),idempotency_key VARCHAR(191),
			request_hash CHAR(64) NOT NULL,metadata_json JSON,created_by VARCHAR(128),expires_at DATETIME,
			created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,
			UNIQUE KEY uk_portal_notifications_idempotency(source_app_code,idempotency_key))`,
		`CREATE TABLE portal_notification_recipients (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,notification_id VARCHAR(64) NOT NULL,
			uid VARCHAR(64) NOT NULL,delivery_state VARCHAR(16) NOT NULL,created_at DATETIME NOT NULL,
			updated_at DATETIME NOT NULL,UNIQUE KEY uk_recipient(notification_id,uid))`,
		`CREATE TABLE portal_actionable_projections (
			id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,uid VARCHAR(64) NOT NULL,
			source_app_code VARCHAR(64) NOT NULL,actionable_key VARCHAR(191) NOT NULL,
			target_app_code VARCHAR(64),biz_type VARCHAR(64) NOT NULL,biz_id VARCHAR(128) NOT NULL,
			business_key VARCHAR(320) NOT NULL,current_notification_id VARCHAR(64) NOT NULL,
			state VARCHAR(16) NOT NULL,object_version VARCHAR(191) NOT NULL,closed_at DATETIME,
			created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,
			UNIQUE KEY uk_actionable(uid,source_app_code,actionable_key))`,
	} {
		if _, err := db.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	a := NewWithDB(config.ConsoleConfig{}, "C000001", db)
	request := map[string]any{
		"sourceAppCode": "workflow", "eventType": "workflow.task.created", "category": "approval",
		"severity": "info", "title": "Review task", "idempotencyKey": "workflow:task:1:created",
		"requestHash": strings.Repeat("a", 64), "metadataJson": "{}", "recipients": []string{"test"}, "channels": []string{"in_app"},
		"actionable": map[string]any{
			"sourceAppCode": "workflow", "actionableKey": "workflow:tasks:1", "targetAppCode": "enterprise",
			"bizType": "workflow_task", "bizId": "1", "businessKey": "workflow_task:1",
			"state": "pending", "objectVersion": "v1",
		},
	}
	ctx := context.Background()
	first, err := a.PublishCanonicalNotification(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.PublishCanonicalNotification(ctx, request)
	if err != nil || second["data"].(map[string]any)["replayed"] != true ||
		second["data"].(map[string]any)["notificationId"] != first["data"].(map[string]any)["notificationId"] {
		t.Fatalf("notification publish replay changed receipt: %v %v", second, err)
	}
	for _, table := range []string{"portal_notifications", "portal_notification_recipients", "portal_actionable_projections"} {
		var count int
		if err := db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("publish replay duplicated %s: count=%d err=%v", table, count, err)
		}
	}
	closeBody := map[string]any{
		"sourceAppCode": "workflow", "actionableKey": "workflow:tasks:1",
		"expectedVersion": "v1", "nextVersion": "v2", "state": "resolved", "recipients": []string{"test"},
	}
	closed, err := a.AdvanceNotificationActionableLifecycle(ctx, closeBody)
	if err != nil || closed["data"].(map[string]any)["updated"] != 1 {
		t.Fatalf("first lifecycle close failed: %v %v", closed, err)
	}
	replayed, err := a.AdvanceNotificationActionableLifecycle(ctx, closeBody)
	if err != nil || replayed["data"].(map[string]any)["updated"] != 0 || replayed["data"].(map[string]any)["replayed"] != 1 {
		t.Fatalf("lifecycle replay mutated projection: %v %v", replayed, err)
	}
	var state, version string
	if err := db.QueryRow("SELECT state,object_version FROM portal_actionable_projections WHERE actionable_key='workflow:tasks:1'").Scan(&state, &version); err != nil || state != "resolved" || version != "v2" {
		t.Fatalf("lifecycle replay changed terminal state: %s %s %v", state, version, err)
	}
	t.Run("external_identity_skip_and_original_key_replay", func(t *testing.T) {
		for _, ddl := range []string{
			`CREATE TABLE directory_users(uid VARCHAR(64) PRIMARY KEY,status VARCHAR(32) NOT NULL)`,
			`CREATE TABLE directory_identities(uid VARCHAR(64),provider_code VARCHAR(32),provider_subject VARCHAR(255),status VARCHAR(32),UNIQUE KEY identity_uid_provider(uid,provider_code))`,
			`CREATE TABLE portal_notification_deliveries(id BIGINT AUTO_INCREMENT PRIMARY KEY,notification_id VARCHAR(64),uid VARCHAR(64),channel VARCHAR(32),provider VARCHAR(32),status VARCHAR(32),attempt_count INT,last_error VARCHAR(1000),sent_at DATETIME,created_at DATETIME,updated_at DATETIME)`,
			`INSERT INTO directory_users VALUES('test','active'),('bound','active')`,
			`INSERT INTO directory_identities VALUES('bound','wecom','wecom-bound','active')`,
		} {
			if _, err := db.Exec(ddl); err != nil {
				t.Fatal(err)
			}
		}
		payload := map[string]any{}
		for k, v := range request {
			if k != "actionable" {
				payload[k] = v
			}
		}
		payload["idempotencyKey"] = "codocs:share:identity"
		payload["resolveExternalChannel"] = "wecom"
		payload["recipients"] = []string{"test", "bound"}
		one, err := a.PublishCanonicalNotification(ctx, payload)
		if err != nil {
			t.Fatal(err)
		}
		resolution := one["data"].(map[string]any)["externalIdentityResolution"].(map[string]any)
		if len(resolution["skipped"].([]map[string]string)) != 1 || len(resolution["recipients"].([]map[string]string)) != 1 {
			t.Fatal("bad resolution")
		}
		if resolution["recipients"].([]map[string]string)[0]["subject"] != "wecom-bound" {
			t.Fatal("must use bound provider subject")
		}
		errors := make(chan error, 2)
		for range 2 {
			go func() { _, e := a.PublishCanonicalNotification(ctx, payload); errors <- e }()
		}
		for range 2 {
			if e := <-errors; e != nil {
				t.Fatal(e)
			}
		}
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM portal_notification_deliveries WHERE status='skipped' AND last_error='external_identity_missing'").Scan(&count); err != nil || count != 1 {
			t.Fatalf("skip replay duplicated: %d %v", count, err)
		}
		if _, err = db.Exec("DROP TABLE directory_identities"); err != nil {
			t.Fatal(err)
		}
		payload["idempotencyKey"] = "codocs:share:db-failure"
		if _, err = a.PublishCanonicalNotification(ctx, payload); err == nil {
			t.Fatal("identity dependency failure must not skip")
		}
		if err = db.QueryRow("SELECT COUNT(*) FROM portal_notifications WHERE idempotency_key='codocs:share:db-failure'").Scan(&count); err != nil || count != 0 {
			t.Fatal("failed resolution must roll publication back")
		}
	})

}
