package enterprisescheduler

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	io "github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// The unified worker path for a company weekly summary published from the
// Enterprise Host: the worker reads the immutable Markdown only under its live
// lease, and the verified Codocs receipt publishes the summary and confirms
// exactly the project-manager duty time entries locked to included reviewed
// report versions (review_route=company_summary, submitted).
func TestSchedulerCompanyWeeklySummaryPublishConfirmsManagerTimeMySQL(t *testing.T) {
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
	schema := "hzy_weekly_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
			t.Fatal(err)
		}
	}
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	mapping := map[string]string{}
	var renames []string
	for _, name := range []string{"integration_operation", "integration_operation_attempt", "integration_operation_dead_letter_actionable", "service_command_receipt"} {
		marker := "CREATE TABLE IF NOT EXISTS " + name + " ("
		start := strings.Index(string(ddl), marker)
		if start < 0 {
			t.Fatal(name)
		}
		end := strings.Index(string(ddl)[start:], ";\n")
		if end < 0 {
			t.Fatal("DDL terminator")
		}
		exec(string(ddl)[start : start+end])
		mapping[name] = "u_" + name
		renames = append(renames, "`"+name+"` TO `u_"+name+"`")
	}
	exec("RENAME TABLE " + strings.Join(renames, ","))
	schedulerCompletionTables(t, db, mapping)
	exec("CREATE TABLE enterprise_schema_registry(id INT PRIMARY KEY,tenant_code VARCHAR(64),environment_code VARCHAR(64),runtime_deployment VARCHAR(64),schema_version VARCHAR(64),generation BIGINT) ENGINE=InnoDB")
	exec("INSERT INTO enterprise_schema_registry VALUES(1,'tenant-a','test','runtime-a','v1',1)")
	var instance string
	if err = db.QueryRow("SELECT @@server_uuid").Scan(&instance); err != nil {
		t.Fatal(err)
	}
	b := e.Binding{Key: e.BindingKey{Tenant: "tenant-a", Environment: "test", RuntimeDeployment: "runtime-a"}, Storage: e.Storage{InstanceID: instance, Address: "127.0.0.1:3306", Database: schema}, SchemaVersion: "v1", Generation: 1, Domains: map[string]e.DomainBinding{"aims": {OwnerDeployment: "aims-owner", Tables: mapping, Read: e.PathUnified, Write: e.PathUnified, Scheduler: e.PathUnified}}}
	ctx := context.Background()
	registry := e.NewRegistry(func(context.Context, e.Storage) (*sql.DB, error) { return db, nil })
	if err := registry.Register(ctx, b); err != nil {
		t.Fatal(err)
	}
	q := e.ResolveRequest{Key: b.Key, Domain: "aims", OwnerDeployment: "aims-owner", SchemaVersion: "v1", Generation: 1, Operation: e.Scheduler}
	resolved, err := registry.Resolve(q)
	if err != nil {
		t.Fatal(err)
	}
	source, err := e.NewOutboundSource(q, resolved, "real-aims-worker", "aims.runtime")
	if err != nil {
		t.Fatal(err)
	}
	schedulerCompletionViews(t, db, b)
	service, err := New(registry, b, source)
	if err != nil {
		t.Fatal(err)
	}
	identity := e.SchedulerIdentity{Tenant: "tenant-a", Deployment: "real-aims-worker", SourceApp: "aims", ClientID: "aims.runtime", Subject: "aims.runtime"}

	markdown := "# 2026-W40 公司项目周报汇总\n"
	sum := sha256.Sum256([]byte(markdown))
	markdownHash := hex.EncodeToString(sum[:])
	setup, err := db.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	fixture := func(q string, args ...any) {
		t.Helper()
		if _, err := setup.ExecContext(ctx, q, args...); err != nil {
			t.Fatal(err)
		}
	}
	fixture("SET FOREIGN_KEY_CHECKS=0")
	// The fixture renames each table after creation, so a child created after its
	// parent was renamed keeps a dangling reference to the logical (view) name.
	fixture("ALTER TABLE u_project_management_fact_snapshots DROP FOREIGN KEY fk_project_management_fact_project")
	fixture("INSERT INTO u_aims_projects(id,project_code,name,short_name,leader_uid,created_by) VALUES(1,'PRJ','项目','项目','pm1','pm1')")
	fixture("INSERT INTO u_weekly_reporting_periods(id,period_key,week_start,week_end,deadline_at,summary_target_at,timezone,config_version,settings_snapshot_json,status) VALUES(1,'2026-W40','2026-09-28','2026-10-05','2026-10-03','2026-10-05','Asia/Shanghai',1,JSON_OBJECT(),'publishing')")
	fixture("INSERT INTO u_company_weekly_summaries(id,period_id,status,created_by) VALUES(1,1,'publishing','director1')")
	fixture("INSERT INTO u_company_weekly_summary_versions(id,summary_id,revision_no,structured_snapshot_json,structured_sha256,markdown_content,markdown_sha256,publish_status,published_by) VALUES(2,1,1,JSON_OBJECT('title','2026-W40 公司项目周报汇总'),?,?,?,'pending','director1')", strings.Repeat("d", 64), markdown, markdownHash)
	fixture("INSERT INTO u_weekly_report_obligations(id,period_id,project_id,responsible_uid_snapshot,responsibility_type,project_status_snapshot) VALUES(3,1,1,'pm1','project_manager','active')")
	fixture("INSERT INTO u_project_weekly_report_versions(id,report_id,version_no,manager_content_json,fact_snapshot_json,fact_snapshot_sha256,system_rag,selected_rag,rag_rule_version,submitted_by,submitted_at) VALUES(7,5,1,JSON_OBJECT(),JSON_OBJECT(),?,'green','green','v1','pm1','2026-10-02')", strings.Repeat("e", 64))
	fixture("INSERT INTO u_company_weekly_summary_items(summary_version_id,obligation_id,report_version_id,inclusion_status) VALUES(2,3,7,'included')")
	// 11: PM duty entry locked to the included version -> approved.
	// 12: locked to a version this summary did not include -> unchanged.
	// 13: ordinary project-manager route on the same version -> unchanged.
	// 14: still a draft -> unchanged.
	fixture(`INSERT INTO u_time_entries(id,project_id,uid,entry_date,hours,review_status,review_route,locked_report_version_id) VALUES
		(11,1,'pm1','2026-09-29',4,'submitted','company_summary',7),
		(12,1,'pm1','2026-09-30',2,'submitted','company_summary',8),
		(13,1,'dev1','2026-09-29',8,'submitted','project_manager',7),
		(14,1,'pm1','2026-10-01',1,'draft','company_summary',7)`)
	fixture("SET FOREIGN_KEY_CHECKS=1")
	setup.Close()

	const weeklyCode = "aims.company-weekly-summary.codocs-publish.v1"
	operationKey := "aims:company-weekly-summary:2026-W40:r1:publish:v1"
	command := map[string]any{"periodKey": "2026-W40", "summaryId": 1, "summaryVersionId": 2, "revisionNo": 1, "title": "2026-W40 公司项目周报汇总", "markdownSha256": markdownHash, "recipientUids": []string{"u9"}, "documentType": "company", "idempotencyKey": operationKey, "operatorUid": "director1"}
	raw, _ := json.Marshal(command)
	digest, err := io.ValidateAndDigestCommand(command)
	if err != nil {
		t.Fatal(err)
	}
	operationID := uuid.NewString()
	now := time.Now().UTC().Truncate(time.Millisecond)
	exec("INSERT INTO u_integration_operation(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_json,command_sha256,next_attempt_at) VALUES(?,?,?,'tenant-a','real-aims-worker','aims','codocs',?,'codocs:company-weekly-summary:publish','company_weekly_summary','2026-W40',?,?,?,?)", operationID, operationKey, operationKey, weeklyCode, operationKey, string(raw), digest, now)

	worker := "aims:aims.runtime:weekly-drain"
	contentBody := map[string]any{"operationKey": operationKey, "summaryVersionId": float64(2), "markdownSha256": markdownHash}
	// Before the claim there is no lease: the content read is refused.
	if _, err := service.CompanyWeeklySummaryPublishContent(ctx, identity, worker, contentBody, now); err == nil {
		t.Fatal("content read without a lease")
	}
	claimed, err := service.Claim(ctx, identity, operationKey, worker, now, time.Minute)
	if err != nil || claimed == nil {
		t.Fatal("claim", err)
	}
	content, err := service.CompanyWeeklySummaryPublishContent(ctx, identity, worker, contentBody, now)
	if err != nil || content["markdownContent"] != markdown || content["periodKey"] != "2026-W40" {
		t.Fatal("content", content, err)
	}
	for name, bad := range map[string]func() (e.SchedulerIdentity, string, map[string]any){
		"worker": func() (e.SchedulerIdentity, string, map[string]any) {
			return identity, "aims:aims.runtime:other", contentBody
		},
		"tenant": func() (e.SchedulerIdentity, string, map[string]any) {
			i := identity
			i.Tenant = "tenant-b"
			return i, worker, contentBody
		},
		"version": func() (e.SchedulerIdentity, string, map[string]any) {
			return identity, worker, map[string]any{"operationKey": operationKey, "summaryVersionId": float64(1), "markdownSha256": markdownHash}
		},
		"hash": func() (e.SchedulerIdentity, string, map[string]any) {
			return identity, worker, map[string]any{"operationKey": operationKey, "summaryVersionId": float64(2), "markdownSha256": strings.Repeat("0", 64)}
		},
		"extra": func() (e.SchedulerIdentity, string, map[string]any) {
			return identity, worker, map[string]any{"operationKey": operationKey, "summaryVersionId": float64(2), "markdownSha256": markdownHash, "tenant": "x"}
		},
	} {
		who, by, body := bad()
		if _, err := service.CompanyWeeklySummaryPublishContent(ctx, who, by, body, now); err == nil {
			t.Fatal("accepted content read with wrong", name)
		}
	}

	documentUUID := uuid.NewString()
	succeed := map[string]any{
		"operationId": operationID, "fencingToken": claimed.FencingToken, "httpStatus": 200,
		"targetReceiptId": uuid.NewString(), "receiptOperationId": operationID, "receiptOperationCode": weeklyCode,
		"receiptIdempotencyKey": operationKey, "receiptCommandSchemaVersion": "v1", "receiptCommandSha256": digest,
		"targetBizType": "company_weekly_summary_document", "targetBizCode": "2026-W40", "responseSummarySha256": strings.Repeat("b", 64),
		"documentUuid": documentUUID, "documentVersionId": float64(31), "documentVersionNum": float64(1), "markdownSha256": markdownHash,
	}
	if _, err := service.Succeed(ctx, identity, worker, operationKey, succeed, now.Add(time.Second)); err != nil {
		t.Fatal("succeed", err)
	}
	var summaryStatus, periodStatus, versionStatus string
	if err := db.QueryRow("SELECT s.status,p.status,v.publish_status FROM u_company_weekly_summaries s JOIN u_weekly_reporting_periods p ON p.id=s.period_id JOIN u_company_weekly_summary_versions v ON v.summary_id=s.id WHERE v.id=2").Scan(&summaryStatus, &periodStatus, &versionStatus); err != nil || summaryStatus != "published" || periodStatus != "published" || versionStatus != "published" {
		t.Fatal("summary not published", summaryStatus, periodStatus, versionStatus, err)
	}
	expect := map[int64]string{11: "approved", 12: "submitted", 13: "submitted", 14: "draft"}
	for id, status := range expect {
		var got string
		var approvedBy sql.NullInt64
		var reviewer sql.NullString
		if err := db.QueryRow("SELECT review_status,approved_summary_version_id,reviewed_by FROM u_time_entries WHERE id=?", id).Scan(&got, &approvedBy, &reviewer); err != nil || got != status {
			t.Fatal("time entry", id, got, err)
		}
		if id == 11 && (approvedBy.Int64 != 2 || reviewer.String != "director1") {
			t.Fatal("PM duty entry not bound to the summary version", approvedBy, reviewer)
		}
		if id != 11 && approvedBy.Valid {
			t.Fatal("unrelated entry approved by summary", id)
		}
	}
	var events int
	if err := db.QueryRow("SELECT COUNT(*) FROM u_time_entry_review_events WHERE time_entry_id=11 AND to_status='approved' AND summary_version_id=2 AND reason='company_weekly_summary_publish'").Scan(&events); err != nil || events != 1 {
		t.Fatal("review event", events, err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM u_time_entry_review_events WHERE time_entry_id<>11").Scan(&events); err != nil || events != 0 {
		t.Fatal("unexpected review events", events, err)
	}
	var facts int
	if err := db.QueryRow("SELECT COUNT(*) FROM u_project_management_fact_snapshots WHERE period_key='2026-W40' AND project_id=1").Scan(&facts); err != nil || facts != 1 {
		t.Fatal("fact snapshot", facts, err)
	}
	// A replayed ACK on the terminal operation must not approve anything twice,
	// whether the repository rejects it or treats it as idempotent.
	_, _ = service.Succeed(ctx, identity, worker, operationKey, succeed, now.Add(2*time.Second))
	if err := db.QueryRow("SELECT COUNT(*) FROM u_time_entry_review_events").Scan(&events); err != nil || events != 1 {
		t.Fatal("replay duplicated review events", events, err)
	}
}
