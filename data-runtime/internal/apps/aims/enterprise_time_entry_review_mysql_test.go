package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseTimeEntryReviewsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	exec := func(q string) {
		t.Helper()
		if _, e := db.Exec(q); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO time_entries(id,project_id,uid,entry_date,hours,review_status,review_route,reviewer_uid_snapshot,row_version) VALUES(999101,1,'U2','2026-09-29',1,'submitted','project_manager','U1',1),(999102,1,'U2','2026-09-29',1,'submitted','project_manager','U1',1),(999103,1,'U1','2026-09-29',1,'submitted','project_manager','U1',1),(999104,2,'U2','2026-09-29',1,'submitted','project_manager','U1',1),(999105,1,'U2','2026-09-29',1,'submitted','project_manager','U1',1),(999106,1,'U2','2026-09-29',1,'submitted','project_manager','U1',1)`)
	defer exec(`DELETE FROM time_entries WHERE id BETWEEN 999101 AND 999106`)
	defer exec(`DELETE FROM time_entry_review_events WHERE time_entry_id BETWEEN 999101 AND 999106`)
	identity := func(key string, codes []string) context.Context {
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "U1", ServiceClientID: "enterprise.runtime", IdempotencyKey: key, RequestID: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}})
	}
	query := url.Values{"current_user": {"U1"}, "current_user_can_approve_timesheet": {"1"}}
	body := func(ids ...int64) map[string]any {
		entries := make([]any, 0, len(ids))
		for _, id := range ids {
			entries = append(entries, map[string]any{"id": id, "rowVersion": int64(1)})
		}
		return map[string]any{"action": "approve", "entries": entries, "reason": ""}
	}
	status := func(err error, want int) {
		t.Helper()
		var e httperror.Error
		if !errors.As(err, &e) || e.Status != want {
			t.Fatalf("wanted %d, got %v", want, err)
		}
	}
	_, e := a.reviewProjectTimeEntries(identity("review-no-approve", []string{"P1"}), "1", url.Values{"current_user": {"U1"}}, body(999101))
	status(e, 403)
	_, e = a.reviewProjectTimeEntries(identity("review-no-scope", []string{"P2"}), "1", query, body(999101))
	status(e, 403)
	_, e = a.reviewProjectTimeEntries(identity("review-cross-project", []string{"P1"}), "1", query, body(999104))
	status(e, 404)
	_, e = a.reviewProjectTimeEntries(identity("review-self", []string{"P1"}), "1", query, body(999103))
	status(e, 403)
	_, e = a.reviewProjectTimeEntries(identity("review-batch-invalid", []string{"P1"}), "1", query, body(999101, 999103))
	status(e, 403)
	var events int
	db.QueryRow("SELECT COUNT(*) FROM time_entry_review_events WHERE time_entry_id BETWEEN 999101 AND 999104").Scan(&events)
	if events != 0 {
		t.Fatal("partial event")
	}
	first, e := a.reviewProjectTimeEntries(identity("review-first", []string{"P1"}), "1", query, body(999101, 999102))
	if e != nil || first["idempotent"] != false {
		t.Fatalf("first=%v err=%v", first, e)
	}
	replay, e := a.reviewProjectTimeEntries(identity("review-first", []string{"P1"}), "1", query, body(999101, 999102))
	if e != nil || replay["idempotent"] != true || replay["receiptId"] != first["receiptId"] {
		t.Fatalf("replay=%v err=%v", replay, e)
	}
	_, e = a.reviewProjectTimeEntries(identity("review-first", []string{"P1"}), "1", query, map[string]any{"action": "return", "reason": "change", "entries": []any{map[string]any{"id": int64(999101), "rowVersion": int64(1)}, map[string]any{"id": int64(999102), "rowVersion": int64(1)}}})
	status(e, 409)
	_, e = a.reviewProjectTimeEntries(identity("review-new-key", []string{"P1"}), "1", query, body(999101))
	status(e, 409)
	db.QueryRow("SELECT COUNT(*) FROM time_entry_review_events WHERE time_entry_id BETWEEN 999101 AND 999104").Scan(&events)
	if events != 2 {
		t.Fatal("replayed review duplicated events", events)
	}
	returned, e := a.reviewProjectTimeEntries(identity("review-return", []string{"P1"}), "1", query, map[string]any{"action": "return", "reason": "Please correct", "entries": []any{map[string]any{"id": int64(999105), "rowVersion": int64(1)}}})
	if e != nil || returned["updatedCount"] != 1 {
		t.Fatalf("return=%v err=%v", returned, e)
	}
	var returnStatus, returnReason string
	if e = db.QueryRow("SELECT review_status,return_reason FROM time_entries WHERE id=999105").Scan(&returnStatus, &returnReason); e != nil || returnStatus != "returned" || returnReason != "Please correct" {
		t.Fatalf("return status=%s reason=%s err=%v", returnStatus, returnReason, e)
	}
	var wait sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := a.reviewProjectTimeEntries(identity("review-concurrent", []string{"P1"}), "1", query, body(999106))
			results <- err
		}()
	}
	wait.Wait()
	close(results)
	for err := range results {
		if err != nil {
			status(err, 409)
		}
	}
	var concurrentEvents int
	db.QueryRow("SELECT COUNT(*) FROM time_entry_review_events WHERE time_entry_id=999106").Scan(&concurrentEvents)
	if concurrentEvents != 1 {
		t.Fatal("concurrent review duplicated events", concurrentEvents)
	}
	_, e = a.reviewProjectTimeEntries(identity("review-first", []string{"P2"}), "1", query, body(999101, 999102))
	status(e, 403)
	var receipts int
	db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key LIKE 'review-%'").Scan(&receipts)
	if receipts != 3 {
		t.Fatal("denied review left receipt", receipts)
	}
}
