package console

import (
	"context"
	"database/sql"
	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAnnouncementsIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ANNOUNCEMENTS_TEST_SOCKET")
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
	cfg.Params = map[string]string{"time_zone": "'+08:00'"}
	root, e := sql.Open("mysql", cfg.FormatDSN())
	if e != nil {
		t.Fatal(e)
	}
	defer root.Close()
	name := "announcements_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec := func(q string, args ...any) {
		t.Helper()
		if _, e := db.Exec(q, args...); e != nil {
			t.Fatal(e)
		}
	}
	migration, e := os.ReadFile("../../../../console/docs/sql/Console-SQL-Migration-v2.40-announcements.sql")
	if e != nil {
		t.Fatal(e)
	}
	for i := 0; i < 2; i++ {
		for _, q := range strings.Split(string(migration), ";") {
			if strings.TrimSpace(q) != "" {
				exec(q)
			}
		}
	}
	// Exercise the reviewable seed in one connection (session variables), including
	// safe NULL defaults, repeat install, and no revival of revoked grants.
	exec(`CREATE TABLE service_clients(id BIGINT PRIMARY KEY,client_code VARCHAR(128),app_code VARCHAR(64),status VARCHAR(32),current_credential_id BIGINT)`)
	exec(`CREATE TABLE service_client_credentials(id BIGINT PRIMARY KEY,status VARCHAR(32))`)
	exec(`CREATE TABLE service_client_grants(service_client_id BIGINT,resource_code VARCHAR(128),action VARCHAR(32),scope_json JSON,status VARCHAR(32),created_at DATETIME,updated_at DATETIME)`)
	exec(`INSERT INTO service_clients VALUES(1,'console.runtime','console','active',7)`)
	exec(`INSERT INTO service_client_credentials VALUES(7,'active')`)
	exec(`CREATE TABLE directory_users(uid VARCHAR(128) PRIMARY KEY,status VARCHAR(32),user_type VARCHAR(32))`)
	exec(`CREATE TABLE directory_departments(dept_code VARCHAR(64) PRIMARY KEY,dept_name VARCHAR(64),status VARCHAR(32),org_type VARCHAR(32))`)
	exec(`CREATE TABLE directory_user_departments(uid VARCHAR(128),dept_code VARCHAR(64),status VARCHAR(32),relation_type VARCHAR(32))`)
	exec(`CREATE TABLE org_profiles(singleton_key INT PRIMARY KEY,tenant_code VARCHAR(64),revision BIGINT)`)
	exec(`INSERT INTO org_profiles VALUES(1,'T1',1)`)
	exec(`CREATE TABLE console_mutation_receipts(receipt_id VARCHAR(64) PRIMARY KEY,tenant_code VARCHAR(64),operation_code VARCHAR(128),idempotency_key VARCHAR(191),request_sha256 CHAR(64),status VARCHAR(30),actor_type VARCHAR(30),actor_id VARCHAR(128),request_id VARCHAR(64),created_at DATETIME(3),updated_at DATETIME(3),result_json JSON,response_http_status INT,completed_at DATETIME(3),UNIQUE KEY uniq_intent(tenant_code,operation_code,idempotency_key))`)
	exec(`CREATE TABLE operation_logs(id BIGINT AUTO_INCREMENT PRIMARY KEY,domain_code VARCHAR(64),action VARCHAR(64),target_type VARCHAR(64),target_key VARCHAR(128),actor_type VARCHAR(30),actor_id VARCHAR(128),request_id VARCHAR(64),detail_json JSON,created_at DATETIME)`)
	exec(`INSERT INTO directory_users VALUES('admin','active','employee'),('alice','active','employee'),('bob','active','employee'),('inactive','inactive','employee'),('system:unassigned','active','system')`)
	exec(`INSERT INTO directory_departments VALUES('D1','研发','active','department'),('D2','市场','active','department')`)
	exec(`INSERT INTO directory_user_departments VALUES('alice','D1','active','member'),('bob','D2','active','member')`)
	seedBytes, err := os.ReadFile("../../../../console/docs/sql/Console-SQL-Seed-v2.40-announcements.sql")
	if err != nil {
		t.Fatal(err)
	}
	lines := []string{}
	for _, line := range strings.Split(string(seedBytes), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "--") {
			lines = append(lines, line)
		}
	}
	seedConn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer seedConn.Close()
	runSeed := func() {
		t.Helper()
		for _, query := range strings.Split(strings.Join(lines, "\n"), ";") {
			if strings.TrimSpace(query) != "" {
				if _, err := seedConn.ExecContext(context.Background(), query); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
	runSeed()
	var grants int
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_client_grants`).Scan(&grants); err != nil || grants != 0 {
		t.Fatal("unsafe NULL seed", grants, err)
	}
	if _, err = seedConn.ExecContext(context.Background(), `SET @announcement_tenant='T1',@console_deployment='console-test'`); err != nil {
		t.Fatal(err)
	}
	runSeed()
	runSeed()
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_client_grants`).Scan(&grants); err != nil || grants != 0 {
		t.Fatal("announcement seed must not install service grants", grants, err)
	}
	exec(`INSERT INTO service_client_grants(service_client_id,resource_code,action,status) VALUES(1,'existing-sentinel','admin','revoked')`)
	runSeed()
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_client_grants WHERE status='revoked'`).Scan(&grants); err != nil || grants != 1 {
		t.Fatal("revived grant", grants, err)
	}
	seedConn.Close()
	// Keep scenario ordering independent of the installed help announcement.
	exec(`DELETE FROM console_announcements`)
	a := NewWithDB(config.ConsoleConfig{}, "T1", db)
	ctx := context.Background()
	call := func(op string, c AnnouncementCommand, uid, key string) (map[string]any, error) {
		return a.Announcements(ctx, op, c, MutationMeta{ActorID: uid, IdempotencyKey: key})
	}
	c := AnnouncementCommand{ID: uuid.NewString(), Title: "仅研发可见", Body: "正文", Level: "warning", StartsAt: time.Now().UTC().Add(-time.Minute).Format(time.RFC3339), Audience: "departments", Departments: []string{"D1"}, Popup: true, Banner: true, Bell: true, Wecom: true}
	if _, e = call("save", c, "admin", "create"); e != nil {
		t.Fatal(e)
	}
	replay, e := call("save", c, "admin", "create")
	if e != nil || replay["replayed"] != true {
		t.Fatal(replay, e)
	}
	bad := c
	bad.Title = "changed"
	if _, e = call("save", bad, "admin", "create"); e == nil {
		t.Fatal("idempotency collision accepted")
	}
	if _, e = call("save", c, "admin", "stale"); e == nil {
		t.Fatal("revision mismatch accepted")
	}
	for _, uid := range []string{"bob", "inactive", "system:unassigned", "ALICE"} {
		if _, e = call("detail", AnnouncementCommand{ID: c.ID}, uid, ""); e == nil {
			t.Fatal("scope bypass", uid)
		}
	}
	if _, e = call("detail", AnnouncementCommand{ID: c.ID}, "alice", ""); e != nil {
		t.Fatal(e)
	}
	other := NewWithDB(config.ConsoleConfig{}, "T2", db)
	if _, e = other.Announcements(ctx, "detail", AnnouncementCommand{ID: c.ID}, MutationMeta{ActorID: "alice"}); e == nil {
		t.Fatal("tenant read bypass")
	}
	// Concurrent closes collapse to one user row; independent users may reuse the same browser key.
	errs := make(chan error, 4)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, e := call("read", AnnouncementCommand{ID: c.ID}, "alice", "same-read")
			errs <- e
		}()
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	var n int
	if e = db.QueryRow(`SELECT COUNT(*) FROM console_announcement_reads`).Scan(&n); e != nil || n != 1 {
		t.Fatal(n, e)
	}
	unrelated, e := a.ClaimImmediateAnnouncementDelivery(ctx, uuid.NewString())
	if e != nil || unrelated["data"] != nil {
		t.Fatal("claimed a different announcement", unrelated, e)
	}
	var prepared int
	if e = db.QueryRow(`SELECT COUNT(*) FROM console_announcement_outbox`).Scan(&prepared); e != nil || prepared != 0 {
		t.Fatal("unrelated claim prepared recipients", prepared, e)
	}
	job, e := a.ClaimImmediateAnnouncementDelivery(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	if job["data"] == nil {
		t.Fatal("immediate announcement must be claimable in a +08:00 database session")
	}
	d := job["data"].(AnnouncementDelivery)
	if d.UID != "alice" {
		t.Fatal(d)
	}
	// Fencing rejects a stale ack. Failed send remains pending and can be reclaimed.
	stale := d
	stale.Lease = uuid.NewString()
	if _, e = a.AckAnnouncementDelivery(ctx, stale, true); e == nil {
		t.Fatal("stale lease accepted")
	}
	if _, e = a.AckAnnouncementDelivery(ctx, d, false); e != nil {
		t.Fatal(e)
	}
	exec(`UPDATE console_announcement_outbox SET next_attempt_at=UTC_TIMESTAMP(3)`)
	job, e = a.ClaimImmediateAnnouncementDelivery(ctx, c.ID)
	if e != nil {
		t.Fatal(e)
	}
	retry := job["data"].(AnnouncementDelivery)
	if retry.Key != d.Key || retry.Lease == d.Lease {
		t.Fatal("retry identity drift", retry, d)
	}
	if _, e = a.AckAnnouncementDelivery(ctx, retry, true); e != nil {
		t.Fatal(e)
	}
	statsOut, err := call("admin-list", AnnouncementCommand{Page: 1}, "admin", "")
	if err != nil {
		t.Fatal(err)
	}
	stats := statsOut["data"].(map[string]any)["items"].([]Announcement)[0].Delivery
	if stats == nil || !stats.Prepared || stats.Delivered != 1 || stats.Pending != 1 {
		t.Fatal("delivery stats", stats)
	}
	// Department move removes access and cancels unsent recipients.
	exec(`UPDATE directory_user_departments SET dept_code='D2' WHERE uid='alice'`)
	if _, e = call("detail", AnnouncementCommand{ID: c.ID}, "alice", ""); e == nil {
		t.Fatal("stale department visibility")
	}
	if _, e = call("read", AnnouncementCommand{ID: c.ID}, "alice", "same-read"); e == nil {
		t.Fatal("stale department replay")
	}
	if _, e = a.ClaimImmediateAnnouncementDelivery(ctx, c.ID); e != nil {
		t.Fatal(e)
	}
	c.Revision = 1
	c.Audience = "all"
	c.Departments = nil
	c.Title = "全员公告"
	if _, e = call("save", c, "admin", "edit"); e != nil {
		t.Fatal(e)
	}
	if _, e = call("read", AnnouncementCommand{ID: c.ID}, "bob", "same-read"); e != nil {
		t.Fatal("per-user idempotency", e)
	}
	out, e := call("detail", AnnouncementCommand{ID: c.ID}, "alice", "")
	if e != nil || !out["data"].(map[string]any)["items"].([]Announcement)[0].Read {
		t.Fatal("read reset on revision", out, e)
	}
	c.Revision = 2
	c.StartsAt = time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	if _, e = call("save", c, "admin", "future-push"); e == nil {
		t.Fatal("future push accepted")
	}
	c.Bell = false
	c.Wecom = false
	if _, e = call("save", c, "admin", "future"); e != nil {
		t.Fatal(e)
	}
	if _, e = call("detail", AnnouncementCommand{ID: c.ID}, "alice", ""); e == nil {
		t.Fatal("future disclosure")
	}
	c.Revision = 3
	c.StartsAt = time.Now().UTC().Add(-2 * time.Hour).Format(time.RFC3339)
	c.EndsAt = time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	if _, e = call("save", c, "admin", "expired"); e != nil {
		t.Fatal(e)
	}
	if _, e = call("detail", AnnouncementCommand{ID: c.ID}, "alice", ""); e == nil {
		t.Fatal("expired disclosure")
	}
	if _, e = call("withdraw", AnnouncementCommand{ID: c.ID, Revision: 4}, "admin", "withdraw"); e != nil {
		t.Fatal(e)
	}
	if _, e = call("detail", AnnouncementCommand{ID: c.ID}, "alice", ""); e == nil {
		t.Fatal("withdrawn disclosure")
	}
}
