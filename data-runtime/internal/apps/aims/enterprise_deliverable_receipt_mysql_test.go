package aims

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseDeliverableReceiptsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	query := url.Values{"current_user": {"U1"}}
	identity := func(key string, allowed bool, actor ...string) context.Context {
		uid := "U1"
		if len(actor) > 0 {
			uid = actor[0]
		}
		codes := []string{"P1"}
		if !allowed {
			codes = []string{"P2"}
		}
		return WithEnterpriseProjectCommandScope(ctx, EnterpriseProjectUpdateIdentity{
			Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test",
			ActorUID: uid, ServiceClientID: "enterprise.runtime", RequestID: key,
			IdempotencyKey: key,
			CommandScope: &EnterpriseProjectCommandScope{
				Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}},
				ExpiresAt:  time.Now().Add(15 * time.Second).UnixMilli(),
			},
		})
	}
	assertStatus := func(err error, status int) {
		t.Helper()
		var httpErr httperror.Error
		if !errors.As(err, &httpErr) || httpErr.Status != status {
			t.Fatalf("wanted HTTP %d, got %v", status, err)
		}
	}
	var before int
	if err := db.QueryRow("SELECT COUNT(*) FROM deliverables WHERE project_id=1").Scan(&before); err != nil {
		t.Fatal(err)
	}
	batch := map[string]any{"items": []any{map[string]any{"entityType": "project", "entityId": 1, "name": "PA04 receipt fixture", "deliverableType": "document"}}}
	first, err := a.createDeliverablesBatch(identity("pa04-batch", true), query, batch)
	if err != nil {
		t.Fatal(err)
	}
	if first["idempotent"] != false || first["receiptId"] == "" {
		t.Fatalf("first batch receipt: %#v", first)
	}
	replay, err := a.createDeliverablesBatch(identity("pa04-batch", true), query, batch)
	if err != nil || replay["idempotent"] != true || replay["receiptId"] != first["receiptId"] {
		t.Fatalf("batch replay=%#v err=%v", replay, err)
	}
	var after int
	if err := db.QueryRow("SELECT COUNT(*) FROM deliverables WHERE project_id=1").Scan(&after); err != nil || after != before+1 {
		t.Fatalf("batch rows before=%d after=%d err=%v", before, after, err)
	}
	_, err = a.createDeliverablesBatch(identity("pa04-batch", true), query, map[string]any{"items": []any{map[string]any{"entityType": "project", "entityId": 1, "name": "changed payload"}}})
	assertStatus(err, 409)
	_, err = a.createDeliverablesBatch(identity("pa04-batch", false), query, batch)
	assertStatus(err, 403)

	var deliverableID int64
	if err := db.QueryRow("SELECT id FROM deliverables WHERE project_id=1 AND name='PA04 receipt fixture'").Scan(&deliverableID); err != nil {
		t.Fatal(err)
	}
	rawID := strconv.FormatInt(deliverableID, 10)
	update := map[string]any{"description": "first intent"}
	changed, err := a.updateDirectDeliverable(identity("pa04-update", true), rawID, query, update)
	if err != nil || changed["idempotent"] != false {
		t.Fatalf("update=%#v err=%v", changed, err)
	}
	changed, err = a.updateDirectDeliverable(identity("pa04-update", true), rawID, query, update)
	if err != nil || changed["idempotent"] != true {
		t.Fatalf("update replay=%#v err=%v", changed, err)
	}
	_, err = a.updateDirectDeliverable(identity("pa04-update", true), rawID, query, map[string]any{"description": "other intent"})
	assertStatus(err, 409)
	_, err = a.updateDirectDeliverable(identity("pa04-update", false), rawID, query, update)
	assertStatus(err, 403)
	_, err = a.updateDirectDeliverable(identity("pa04-update", true, "U9"), rawID, query, update)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U9' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	_, err = a.updateDirectDeliverable(identity("pa04-update", true), rawID, query, update)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}

	deleted, err := a.deleteDirectDeliverable(identity("pa04-delete", true), rawID, query)
	if err != nil || deleted["idempotent"] != false {
		t.Fatalf("delete=%#v err=%v", deleted, err)
	}
	deleted, err = a.deleteDirectDeliverable(identity("pa04-delete", true), rawID, query)
	if err != nil || deleted["idempotent"] != true || deleted["receiptId"] == "" {
		t.Fatalf("delete replay=%#v err=%v", deleted, err)
	}
	_, err = a.deleteDirectDeliverable(identity("pa04-delete", false), rawID, query)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U9' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET role='member' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	_, err = a.deleteDirectDeliverable(identity("pa04-delete", true), rawID, query)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("UPDATE aims_project_members SET role='manager' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := db.QueryRow("SELECT COUNT(*) FROM deliverables WHERE id=?", deliverableID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("delete remaining=%d err=%v", remaining, err)
	}
	if _, err := db.Exec("INSERT INTO work_items(id,project_id,item_number,item_key,tier,type,title,status) VALUES(99001,1,99001,'P1-99001','matter','task','Receipt evidence','in_progress')"); err != nil {
		t.Fatal(err)
	}
	matterBatch := map[string]any{"items": []any{map[string]any{"entityType": "matter", "entityId": 99001, "name": "PA04 evidence"}}}
	if _, err := a.createDeliverablesBatch(identity("pa04-matter-batch", true), query, matterBatch); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT id FROM deliverables WHERE matter_id=99001 AND name='PA04 evidence'").Scan(&deliverableID); err != nil {
		t.Fatal(err)
	}
	rawID = strconv.FormatInt(deliverableID, 10)
	evidence := map[string]any{"evidenceNote": "receipt evidence"}
	result, err := a.updateWorkItemDeliverable(identity("pa04-evidence", true), "99001", rawID, query, evidence)
	if err != nil || result["idempotent"] != false {
		t.Fatalf("evidence first=%#v err=%v", result, err)
	}
	result, err = a.updateWorkItemDeliverable(identity("pa04-evidence", true), "99001", rawID, query, evidence)
	if err != nil || result["idempotent"] != true {
		t.Fatalf("evidence replay=%#v err=%v", result, err)
	}
	result, err = a.updateWorkItemDeliverable(identity("pa04-evidence-new-intent", true), "99001", rawID, query, evidence)
	if err != nil || result["idempotent"] != false {
		t.Fatalf("same-value evidence with new intent=%#v err=%v", result, err)
	}
	_, err = a.updateWorkItemDeliverable(identity("pa04-evidence-cross-item", true), "99002", rawID, query, evidence)
	assertStatus(err, 404)
	_, err = a.updateWorkItemDeliverable(identity("pa04-evidence", true), "99001", rawID, query, map[string]any{"evidenceNote": "changed"})
	assertStatus(err, 409)
	_, err = a.updateWorkItemDeliverable(identity("pa04-evidence", false), "99001", rawID, query, evidence)
	assertStatus(err, 403)

	concurrent := map[string]any{"items": []any{map[string]any{"entityType": "project", "entityId": 1, "name": "PA04 concurrent"}}}
	var results [2]map[string]any
	var failures [2]error
	var group sync.WaitGroup
	for index := range results {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			results[index], failures[index] = a.createDeliverablesBatch(identity("pa04-concurrent", true), query, concurrent)
		}(index)
	}
	group.Wait()
	for index := range results {
		if failures[index] != nil || results[index]["receiptId"] == "" {
			t.Fatalf("concurrent result %d=%#v err=%v", index, results[index], failures[index])
		}
	}
	if results[0]["receiptId"] != results[1]["receiptId"] || results[0]["idempotent"] == results[1]["idempotent"] {
		t.Fatalf("concurrent receipts=%#v %#v", results[0], results[1])
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM deliverables WHERE project_id=1 AND name='PA04 concurrent'").Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("concurrent row count=%d err=%v", remaining, err)
	}
}
