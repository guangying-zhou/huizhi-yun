package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestFeedbackIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_FEEDBACK_TEST_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	cfg.MultiStatements = true
	// Production Console pools can use a non-UTC database session. Driver Loc
	// alone does not change CURRENT_TIMESTAMP defaults on DATETIME columns.
	cfg.Params = map[string]string{"time_zone": "'+08:00'"}
	root, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	name := "feedback_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	migration, e := os.ReadFile("../../../../console/docs/sql/Console-SQL-Migration-v2.41-feedback.sql")
	if e != nil {
		t.Fatal(e)
	}
	exec(string(migration))
	exec(string(migration))
	mediaMigration, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Migration-v2.42-feedback-media.sql")
	if err != nil {
		t.Fatal(err)
	}
	exec(string(mediaMigration))
	exec(string(mediaMigration))
	exec("CREATE TABLE directory_users(uid VARCHAR(128) PRIMARY KEY,display_name VARCHAR(255),status VARCHAR(16))")
	exec("INSERT INTO directory_users VALUES('alice','张三','active'),('bob','李四','active'),('admin','管理员','active'),('disabled','停用','inactive')")
	exec("CREATE TABLE console_mutation_receipts(receipt_id VARCHAR(64) PRIMARY KEY,tenant_code VARCHAR(64),operation_code VARCHAR(128),idempotency_key VARCHAR(191),request_sha256 CHAR(64),status VARCHAR(30),actor_type VARCHAR(30),actor_id VARCHAR(128),request_id VARCHAR(64),created_at DATETIME(3),updated_at DATETIME(3),result_json JSON,response_http_status INT,completed_at DATETIME(3),UNIQUE KEY uniq_intent(tenant_code,operation_code,idempotency_key))")
	exec("CREATE TABLE operation_logs(id BIGINT AUTO_INCREMENT PRIMARY KEY,domain_code VARCHAR(64),action VARCHAR(64),target_type VARCHAR(64),target_key VARCHAR(128),actor_type VARCHAR(30),actor_id VARCHAR(128),request_id VARCHAR(64),detail_json JSON,created_at DATETIME)")
	a := NewWithDB(config.ConsoleConfig{}, "T", db)
	ctx := context.Background()
	s := feedbackDefaultSettings()
	s.Enabled = true
	s.PublicURL = "https://work.example.test"
	_, e = a.Feedback(ctx, "settings-save", FeedbackCommand{Settings: &s}, MutationMeta{ActorID: "admin", IdempotencyKey: "settings"}, true)
	if e != nil {
		t.Fatal(e)
	}
	text := FeedbackText{Kind: "bug", Title: "测试", Description: "描述", Priority: "mid", PageURL: "/enterprise"}
	c := FeedbackCommand{Text: &text}
	m := MutationMeta{ActorID: "alice", IdempotencyKey: "intent1"}
	out, e := a.Feedback(ctx, "draft", c, m, false)
	if e != nil {
		t.Fatal(e)
	}
	id := out["data"].(map[string]any)["id"].(string)
	replay, e := a.Feedback(ctx, "draft", c, m, false)
	if e != nil || replay["replayed"] != true {
		t.Fatal(replay, e)
	}
	text.Title = "changed"
	if _, e = a.Feedback(ctx, "draft", c, m, false); e == nil {
		t.Fatal("payload mismatch accepted")
	}
	bob := MutationMeta{ActorID: "bob", IdempotencyKey: "intent1"}
	if _, e = a.Feedback(ctx, "detail", FeedbackCommand{ID: id}, bob, false); e == nil {
		t.Fatal("cross-user read")
	}
	if _, e = a.Feedback(ctx, "submit", FeedbackCommand{ID: id}, bob, false); e == nil {
		t.Fatal("cross-user write")
	}
	other := NewWithDB(config.ConsoleConfig{}, "OTHER", db)
	if _, e = other.Feedback(ctx, "detail", FeedbackCommand{ID: id}, m, true); e == nil {
		t.Fatal("cross-tenant read")
	}
	if _, e = a.Feedback(ctx, "submit", FeedbackCommand{ID: id}, MutationMeta{ActorID: "alice", IdempotencyKey: "submit1"}, false); e != nil {
		t.Fatal(e)
	}

	for i := 0; i < 3; i++ {
		owner := "alice"
		if i == 2 {
			owner = "bob"
		}
		if _, err := db.Exec(`INSERT INTO console_feedback(tenant_code,feedback_id,reporter_uid,reporter_name,text_json,settings_json,status,next_attempt_at,created_at,updated_at) SELECT tenant_code,?,?,'fixture',JSON_SET(text_json,'$.kind','suggestion'),settings_json,'failed',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM console_feedback WHERE feedback_id=?`, fmt.Sprintf("filter-%d", i), owner, id); err != nil {
			t.Fatal(err)
		}
	}
	for page := 1; page <= 2; page++ {
		result, err := a.Feedback(ctx, "list", FeedbackCommand{Page: page, PageSize: 1, Status: "failed", Kind: "suggestion"}, m, false)
		if err != nil {
			t.Fatal(err)
		}
		data := result["data"].(map[string]any)
		records := data["items"].([]FeedbackRecord)
		if data["total"] != 2 || len(records) != 1 || records[0].ReporterUID != "alice" || records[0].ID != fmt.Sprintf("filter-%d", 2-page) {
			t.Fatal(data)
		}
	}
	result, err := a.Feedback(ctx, "list", FeedbackCommand{Page: 1, Kind: "feature"}, m, false)
	if err != nil || result["data"].(map[string]any)["total"] != 0 {
		t.Fatal(result, err)
	}
	for _, bad := range []FeedbackCommand{{Page: 1, Status: "failed|unknown"}, {Page: 1, Kind: "arbitrary"}, {Page: 1, PageSize: 101}} {
		if _, err := a.Feedback(ctx, "list", bad, m, false); err == nil {
			t.Fatal("invalid filter accepted")
		}
	}
	exec("DELETE FROM console_feedback WHERE feedback_id LIKE 'filter-%'")

	testFeedbackImagesMySQL(t, a, db, s)
	// Simulate process death after durable dispatch intent. It must reconcile and
	// never be returned to pending or become manually retryable.
	exec("UPDATE console_feedback SET status='dispatching',lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND)")
	// A missing integration is a dependency failure, never a second create.
	exec("CREATE TABLE integrations(id BIGINT PRIMARY KEY,integration_code VARCHAR(100))")
	_, e = a.DrainFeedback(ctx)
	if e != nil {
		t.Fatal(e)
	}
	r, e := a.feedbackRecord(ctx, id)
	if e != nil || r.Status != "unknown" {
		t.Fatal(r, e)
	}
	if _, e = a.Feedback(ctx, "retry", FeedbackCommand{ID: id}, MutationMeta{ActorID: "admin", IdempotencyKey: "retry1"}, true); e == nil {
		t.Fatal("blind unknown retry")
	}
	var immediatelyDue, sameClock bool
	if err := db.QueryRow(`SELECT resolve_after<=UTC_TIMESTAMP(3),resolve_after=created_at FROM console_feedback_events WHERE feedback_id=?`, id).Scan(&immediatelyDue, &sameClock); err != nil || !immediatelyDue || !sameClock {
		t.Fatalf("feedback event must be immediately due in UTC despite +08:00 session: due=%t sameClock=%t err=%v", immediatelyDue, sameClock, err)
	}
	events, e := a.FeedbackNotification(ctx, "events", FeedbackNotificationCommand{})
	if e != nil {
		t.Fatal(e)
	}
	items := events["data"].([]map[string]any)
	if len(items) != 1 {
		t.Fatal(events)
	}
	eventID := items[0]["eventId"].(string)
	_, e = a.FeedbackNotification(ctx, "freeze", FeedbackNotificationCommand{EventID: eventID, Recipients: []string{"admin"}})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.FeedbackNotification(ctx, "freeze", FeedbackNotificationCommand{EventID: eventID, Recipients: []string{"bob"}})
	if e != nil {
		t.Fatal(e)
	}
	delivery, e := a.FeedbackNotification(ctx, "claim", FeedbackNotificationCommand{})
	if e != nil {
		t.Fatal(e)
	}
	d := delivery["data"].(map[string]any)
	if d["uid"] != "admin" {
		t.Fatal(d)
	}
	raw, _ := json.Marshal(d)
	if strings.Contains(string(raw), "description") || strings.Contains(string(raw), "errors") {
		t.Fatal("diagnostic leak")
	}
	_, e = a.FeedbackNotification(ctx, "ack", FeedbackNotificationCommand{EventID: eventID, UID: "admin", Attempt: d["attempt"].(int64), InApp: true})
	if e != nil {
		t.Fatal(e)
	}
	var bell, wecom string
	db.QueryRow("SELECT status FROM console_feedback_delivery WHERE channel='in_app'").Scan(&bell)
	db.QueryRow("SELECT status FROM console_feedback_delivery WHERE channel='wecom'").Scan(&wecom)
	if bell != "sent" || wecom != "pending" {
		t.Fatal(bell, wecom)
	}

	t.Run("missing_integration_definite_failure_retry_and_in_app_ack", func(t *testing.T) {
		draft, err := a.Feedback(ctx, "draft", c, MutationMeta{ActorID: "alice", IdempotencyKey: "missing-integration-draft"}, false)
		if err != nil {
			t.Fatal(err)
		}
		fid := draft["data"].(map[string]any)["id"].(string)
		if _, err = a.Feedback(ctx, "submit", FeedbackCommand{ID: fid}, MutationMeta{ActorID: "alice", IdempotencyKey: "missing-integration-submit"}, false); err != nil {
			t.Fatal(err)
		}
		calls := 0
		missing := func(context.Context, string) (gitLabOperationRuntime, error) {
			calls++
			return gitLabOperationRuntime{}, feedbackError(503, "integration_unavailable")
		}
		if _, err = a.drainFeedback(ctx, missing); err != nil {
			t.Fatal(err)
		}
		row, err := a.feedbackRecord(ctx, fid)
		if err != nil || row.Status != "failed" || row.IssueIID != 0 || row.NotificationPending != 1 {
			t.Fatal(row, err)
		}
		var eid string
		if err = db.QueryRow("SELECT event_id FROM console_feedback_events WHERE feedback_id=? AND event_type='failed'", fid).Scan(&eid); err != nil {
			t.Fatal(err)
		}
		if _, err = a.FeedbackNotification(ctx, "freeze", FeedbackNotificationCommand{EventID: eid, Recipients: []string{"admin"}}); err != nil {
			t.Fatal(err)
		}
		delivered, err := a.FeedbackNotification(ctx, "claim", FeedbackNotificationCommand{})
		if err != nil {
			t.Fatal(err)
		}
		d := delivered["data"].(map[string]any)
		if d["eventId"] != eid || d["uid"] != "admin" {
			t.Fatal(d)
		}
		if _, err = a.FeedbackNotification(ctx, "ack", FeedbackNotificationCommand{EventID: eid, UID: "admin", Attempt: d["attempt"].(int64), InApp: true}); err != nil {
			t.Fatal(err)
		}
		var inApp string
		if err = db.QueryRow("SELECT status FROM console_feedback_delivery WHERE event_id=? AND channel='in_app'", eid).Scan(&inApp); err != nil || inApp != "sent" {
			t.Fatal(inApp, err)
		}
		intent := MutationMeta{ActorID: "admin", IdempotencyKey: "missing-integration-retry"}
		if _, err = a.Feedback(ctx, "retry", FeedbackCommand{ID: fid}, intent, true); err != nil {
			t.Fatal(err)
		}
		replayed, err := a.Feedback(ctx, "retry", FeedbackCommand{ID: fid}, intent, true)
		if err != nil || replayed["replayed"] != true {
			t.Fatal(replayed, err)
		}
		if _, err = a.drainFeedback(ctx, missing); err != nil {
			t.Fatal(err)
		}
		row, err = a.feedbackRecord(ctx, fid)
		if err != nil || row.Status != "failed" || calls != 2 {
			t.Fatal(row, calls, err)
		}
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM console_feedback WHERE feedback_id=?", fid).Scan(&count); err != nil || count != 1 {
			t.Fatal(count, err)
		}
	})

	// Two workers racing over one pending record produce one external POST and a
	// durable success receipt/event. A restarted worker does not create it again.
	var posts atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		posts.Add(1)
		var payload map[string]any
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Error("invalid payload")
		}
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(map[string]any{"iid": 51, "description": payload["description"]})
	}))
	defer srv.Close()
	resolve := func(context.Context, string) (gitLabOperationRuntime, error) {
		return gitLabOperationRuntime{BaseURL: srv.URL, Token: "test-only"}, nil
	}
	next, e := a.Feedback(ctx, "draft", c, MutationMeta{ActorID: "alice", IdempotencyKey: "intent2"}, false)
	if e != nil {
		t.Fatal(e)
	}
	nextID := next["data"].(map[string]any)["id"].(string)
	if _, e = a.Feedback(ctx, "submit", FeedbackCommand{ID: nextID}, MutationMeta{ActorID: "alice", IdempotencyKey: "submit2"}, false); e != nil {
		t.Fatal(e)
	}
	var wg sync.WaitGroup
	errCh := make(chan error, 2)
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := a.drainFeedback(ctx, resolve); errCh <- err }()
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatal(err)
		}
	}
	if posts.Load() != 1 {
		t.Fatal("duplicate POST", posts.Load())
	}
	r, e = a.feedbackRecord(ctx, nextID)
	if e != nil || r.Status != "submitted" || r.IssueIID != 51 || r.NotificationPending != 1 {
		t.Fatal(r, e)
	}
	if _, e = a.drainFeedback(ctx, resolve); e != nil || posts.Load() != 1 {
		t.Fatal(e, posts.Load())
	}
	expired, e := a.Feedback(ctx, "draft", c, MutationMeta{ActorID: "alice", IdempotencyKey: "expired-draft"}, false)
	if e != nil {
		t.Fatal(e)
	}
	expiredID := expired["data"].(map[string]any)["id"].(string)
	if _, e = db.Exec("UPDATE console_feedback SET created_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 200 DAY) WHERE feedback_id IN (?,?)", expiredID, id); e != nil {
		t.Fatal(e)
	}
	if e = a.purgeFeedback(ctx); e != nil {
		t.Fatal(e)
	}
	if _, e = a.feedbackRecord(ctx, expiredID); e == nil {
		t.Fatal("expired draft retained")
	}
	if _, e = a.feedbackRecord(ctx, id); e != nil {
		t.Fatal("unresolved evidence purged", e)
	}
	// Dual audiences are seeded exactly once; revoked grants remain revoked.
	exec("CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(100),app_code VARCHAR(32),current_credential_id BIGINT,status VARCHAR(16))")
	exec("CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,status VARCHAR(16))")
	exec("CREATE TABLE service_client_grants(id BIGINT AUTO_INCREMENT PRIMARY KEY,service_client_id BIGINT,resource_code VARCHAR(191),action VARCHAR(32),scope_json JSON,status VARCHAR(16),created_at DATETIME,updated_at DATETIME,UNIQUE KEY uniq_grant(service_client_id,resource_code,action))")
	exec("INSERT INTO service_clients VALUES(1,'console.runtime','console',1,'active'),(2,'enterprise.runtime','enterprise',2,'active'); INSERT INTO service_client_credentials VALUES(1,'active'),(2,'active')")
	seed, e := os.ReadFile("../../../../console/docs/sql/Console-SQL-Seed-v2.41-feedback-grants.sql")
	if e != nil {
		t.Fatal(e)
	}
	exec(string(seed))
	var count int
	db.QueryRow("SELECT COUNT(*) FROM service_client_grants").Scan(&count)
	if count != 0 {
		t.Fatal("unbound seed")
	}
	seedSQL := "SET @feedback_tenant='T',@feedback_console_deployment='T-console',@feedback_enterprise_deployment='T-enterprise';" + string(seed)
	exec(seedSQL)
	exec(seedSQL)
	db.QueryRow("SELECT COUNT(*) FROM service_client_grants").Scan(&count)
	if count != 14 {
		t.Fatal("dual audience grants", count)
	}
	exec("UPDATE service_client_grants SET status='revoked' WHERE resource_code='tenant-runtime:console:feedback-delivery'")
	exec(seedSQL)
	db.QueryRow("SELECT COUNT(*) FROM service_client_grants WHERE status='revoked'").Scan(&count)
	if count != 1 {
		t.Fatal("revoked grant revived")
	}
	exec("UPDATE directory_users SET status='inactive' WHERE uid='alice'")
	if _, e = a.Feedback(ctx, "draft", c, m, false); e == nil {
		t.Fatal("replay bypassed revocation")
	}
}
