package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strconv"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseProjectTimeReceiptsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	query := url.Values{"current_user": {"U1"}}
	identity := func(key string, allowed bool) context.Context {
		codes := []string{"P1"}
		if !allowed {
			codes = []string{"P2"}
		}
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{
			Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1",
			ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key,
			CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()},
		})
	}
	assertStatus := func(err error, status int) {
		t.Helper()
		var failure httperror.Error
		if !errors.As(err, &failure) || failure.Status != status {
			t.Fatalf("wanted %d, got %v", status, err)
		}
	}
	create := map[string]any{"entryDate": "2026-09-28", "hours": 2.5, "description": "PA04 project time"}
	first, err := a.createProjectTimeEntry(identity("pa04-time-create", true), "1", query, create)
	if err != nil || first.ID <= 0 || first.ReceiptID == "" || first.Idempotent == nil || *first.Idempotent {
		t.Fatalf("create=%#v err=%v", first, err)
	}
	replay, err := a.createProjectTimeEntry(identity("pa04-time-create", true), "1", query, create)
	if err != nil || replay.ID != first.ID || replay.ReceiptID != first.ReceiptID || replay.Idempotent == nil || !*replay.Idempotent {
		t.Fatalf("create replay=%#v err=%v", replay, err)
	}
	_, err = a.createProjectTimeEntry(identity("pa04-time-create", true), "1", query, map[string]any{"entryDate": "2026-09-28", "hours": 3.5})
	assertStatus(err, 409)
	_, err = a.createProjectTimeEntry(identity("pa04-time-create", false), "1", query, create)
	assertStatus(err, 403)
	var count int
	if err := db.QueryRow("SELECT COUNT(*) FROM time_entries WHERE project_id=1 AND description='PA04 project time'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("create rows=%d err=%v", count, err)
	}

	entryID := strconv.FormatInt(first.ID, 10)
	update := map[string]any{"description": "PA04 revised"}
	updated, err := a.updateProjectTimeEntry(identity("pa04-time-update", true), "1", entryID, query, update)
	if err != nil || updated.Idempotent == nil || *updated.Idempotent {
		t.Fatalf("update=%#v err=%v", updated, err)
	}
	updated, err = a.updateProjectTimeEntry(identity("pa04-time-update", true), "1", entryID, query, update)
	if err != nil || updated.Idempotent == nil || !*updated.Idempotent {
		t.Fatalf("update replay=%#v err=%v", updated, err)
	}
	_, err = a.updateProjectTimeEntry(identity("pa04-time-update", true), "1", entryID, query, map[string]any{"hours": 4})
	assertStatus(err, 409)
	_, err = a.updateProjectTimeEntry(identity("pa04-time-update", false), "1", entryID, query, update)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U9' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	_, err = a.updateProjectTimeEntry(identity("pa04-time-update", true), "1", entryID, query, update)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	second, err := a.updateProjectTimeEntry(identity("pa04-time-update-2", true), "1", entryID, query, map[string]any{"description": "PA04 second intent"})
	if err != nil || second.Idempotent == nil || *second.Idempotent {
		t.Fatalf("second update=%#v err=%v", second, err)
	}

	deleted, err := a.deleteProjectTimeEntry(identity("pa04-time-delete", true), "1", entryID, query)
	if err != nil || deleted["idempotent"] != false {
		t.Fatalf("delete=%#v err=%v", deleted, err)
	}
	deleted, err = a.deleteProjectTimeEntry(identity("pa04-time-delete", true), "1", entryID, query)
	if err != nil || deleted["idempotent"] != true || deleted["receiptId"] == "" {
		t.Fatalf("delete replay=%#v err=%v", deleted, err)
	}
	_, err = a.deleteProjectTimeEntry(identity("pa04-time-delete", false), "1", entryID, query)
	assertStatus(err, 403)
	if err := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE operation_code LIKE 'enterprise.aims.time-entries.project-%' AND required_capability='aims:project-time-entries:edit' AND status='succeeded'").Scan(&count); err != nil || count != 4 {
		t.Fatalf("project time receipt capability/count=%d err=%v", count, err)
	}
}
