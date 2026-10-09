package enterpriseapf

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestAPFSalesSupportMySQL(t *testing.T) {
	s, db := salesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "support-lead", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	out, e := s.Sales(ctx, "leads-create", SalesInput{Payload: map[string]any{"name": "支撑标记", "org_name": "支撑公司", "source_type": "referral", "need_summary": "需求", "contact_name": "联系人", "owner_uid": "person", "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	lead := fmt.Sprint(out.(map[string]any)["data"].(map[string]any)["id"])
	who.Key = "support-convert"
	out, e = s.Sales(ctx, "leads-convert", SalesInput{ID: lead, Payload: map[string]any{"expectedVersion": float64(1)}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	converted := out.(map[string]any)["data"].(map[string]any)
	opp := fmt.Sprint(converted["converted_opportunity_id"])
	contact, e := db.Exec("INSERT INTO altoc_contact(code,customer_id,name,created_by) VALUES('CONTACT-SUPPORT',?,?,'person')", converted["converted_customer_id"], "新增联系人")
	if e != nil {
		t.Fatal(e)
	}
	cid, _ := contact.LastInsertId()
	version := float64(1)
	call := func(op string, i SalesInput, read SalesDocumentRead) map[string]any {
		t.Helper()
		out, e := s.SalesSupport(ctx, op, i, who, scope, read)
		if e != nil {
			t.Fatal(op, e)
		}
		return out.(map[string]any)
	}
	role := map[string]any{"expectedVersion": version, "contactId": fmt.Sprint(cid), "role": "sponsor", "influence_level": "high", "attitude": "supportive", "is_primary": true, "remark": "标记"}
	who.Key = "support-contact-create"
	first := call("opportunity-contact-roles-create", SalesInput{ID: opp, Payload: role}, nil)
	again := call("opportunity-contact-roles-create", SalesInput{ID: opp, Payload: role}, nil)
	if first["childId"] != again["childId"] {
		t.Fatal("duplicate relation")
	}
	version++
	role["childId"] = first["childId"]
	role["expectedVersion"] = version
	role["role"] = "decision_maker"
	who.Key = "support-contact-update"
	call("opportunity-contact-roles-update", SalesInput{ID: opp, Payload: role}, nil)
	version++
	// A visible, same-owner second parent still cannot mutate the first parent's child.
	second, e := db.Exec("INSERT INTO altoc_opportunity(code,name,customer_id,stage_id,owner_uid) VALUES('SUPPORT-OTHER','另一商机',?,1,'person')", converted["converted_customer_id"])
	if e != nil {
		t.Fatal(e)
	}
	secondID, _ := second.LastInsertId()
	who.Key = "support-existing-parent"
	if _, e = s.SalesSupport(ctx, "opportunity-contact-roles-delete", SalesInput{ID: fmt.Sprint(secondID), Payload: map[string]any{"expectedVersion": float64(1), "childId": first["childId"]}}, who, scope, nil); httperrorStatus(e) != 404 {
		t.Fatal("existing cross-parent child", e)
	}
	// Cross-parent child IDs cannot be replayed or mutated.
	who.Key = "support-cross"
	if _, e = s.SalesSupport(ctx, "opportunity-contact-roles-delete", SalesInput{ID: "999999", Payload: map[string]any{"expectedVersion": version, "childId": first["childId"]}}, who, scope, nil); httperrorStatus(e) != 404 {
		t.Fatal("cross-parent", e)
	}
	document := "6104e341-43f1-4dd5-a41c-49c97eeab324"
	read := func(_ context.Context, u, actor string) (map[string]any, error) {
		if actor != "person" || u != document {
			t.Fatal("ACL identity")
		}
		return map[string]any{"uuid": u, "title": "标记文档"}, nil
	}
	who.Key = "support-doc-deny"
	docInput := SalesInput{ID: opp, Payload: map[string]any{"expectedVersion": version, "document_uuid": document, "link_type": "general"}}
	if _, e = s.SalesSupport(ctx, "opportunity-documents-create", docInput, who, scope, func(context.Context, string, string) (map[string]any, error) {
		return nil, httperror.New(403, "document_access_denied", "Denied")
	}); httperrorStatus(e) != 403 {
		t.Fatal(e)
	}
	var count int
	if e = db.QueryRow("SELECT COUNT(*) FROM altoc_document_link").Scan(&count); e != nil || count != 0 {
		t.Fatal("ACL denial wrote", count, e)
	}
	who.Key = "support-doc-create"
	linked := call("opportunity-documents-create", docInput, read)
	call("opportunity-documents-create", docInput, read)
	version++
	deniedList, e := s.SalesSupport(ctx, "opportunity-documents-list", SalesInput{ID: opp, Payload: map[string]any{"page": float64(1), "pageSize": float64(20)}}, who, scope, func(context.Context, string, string) (map[string]any, error) {
		return nil, httperror.New(403, "document_access_denied", "Denied")
	})
	if e != nil {
		t.Fatal(e)
	}
	refs := deniedList.(map[string]any)
	hidden := refs["items"].([]map[string]any)
	if refs["total"] != int64(1) || len(hidden) != 1 || hidden[0]["document_uuid"] != nil || hidden[0]["readable"] != false || hidden[0]["document_title"] != "无权查看文档" {
		t.Fatal("cached title/UUID leaked", refs)
	}
	// Replays recheck current source Codocs ACL before receipt lookup.
	if _, e = s.SalesSupport(ctx, "opportunity-documents-create", docInput, who, scope, func(context.Context, string, string) (map[string]any, error) {
		return nil, httperror.New(403, "document_access_denied", "Denied")
	}); httperrorStatus(e) != 403 {
		t.Fatal("revoked ACL replay", e)
	}
	for op := range salesSupportOps {
		if op[len(op)-5:] != "-list" {
			continue
		}
		id := opp
		if op == "lead-documents-list" || op == "lead-activities-list" {
			id = lead
		}
		p := map[string]any{"page": float64(1), "pageSize": float64(1)}
		if op == "opportunity-stages-list" {
			id = ""
			p["purpose"] = "opportunity-view"
		}
		got := call(op, SalesInput{ID: id, Payload: p}, read)
		if got["total"] == nil || len(got["items"].([]map[string]any)) > 1 {
			t.Fatal(op, got)
		}
	}
	who.Key = "support-doc-delete"
	del := SalesInput{ID: opp, Payload: map[string]any{"expectedVersion": version, "childId": linked["childId"]}}
	call("opportunity-documents-delete", del, nil)
	call("opportunity-documents-delete", del, nil)
	version++
	who.Key = "support-role-delete"
	call("opportunity-contact-roles-delete", SalesInput{ID: opp, Payload: map[string]any{"expectedVersion": version, "childId": first["childId"]}}, nil)
	if _, e = db.Exec("UPDATE altoc_opportunity SET owner_uid='other' WHERE id=?", opp); e != nil {
		t.Fatal(e)
	}
	if _, e = s.SalesSupport(ctx, "opportunity-contact-roles-create", SalesInput{ID: opp, Payload: map[string]any{"expectedVersion": float64(1), "contactId": fmt.Sprint(cid), "role": "sponsor", "influence_level": "high", "attitude": "supportive", "is_primary": true}}, who, scope, nil); httperrorStatus(e) != 403 {
		t.Fatal("range revoked", e)
	}
}

func TestAPFSalesSupportAtomicRollbackAndConcurrentCASMySQL(t *testing.T) {
	s, db := salesFixture(t)
	ctx := context.Background()
	who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: "atomic-lead", RequestID: "isolated"}
	scope := altoc.BasicReadScope{Access: "self"}
	out, e := s.Sales(ctx, "leads-create", SalesInput{Payload: map[string]any{"name": "并发标记", "owner_uid": "person", "org_name": "标记公司", "source_type": "referral", "need_summary": "需求", "contact_name": "联系人", "next_action": "联系", "next_action_due_at": "2026-10-05 09:00:00"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	id := fmt.Sprint(out.(map[string]any)["data"].(map[string]any)["id"])
	read := func(_ context.Context, u, actor string) (map[string]any, error) {
		return map[string]any{"uuid": u, "title": "标记"}, nil
	}
	input := SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(1), "document_uuid": "6104e341-43f1-4dd5-a41c-49c97eeab324", "link_type": "general"}}
	if _, e = db.Exec("CREATE TRIGGER fail_support_audit BEFORE INSERT ON altoc_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated fault'"); e != nil {
		t.Fatal(e)
	}
	who.Key = "atomic-fault"
	if _, e = s.SalesSupport(ctx, "lead-documents-create", input, who, scope, read); e == nil {
		t.Fatal("injected failure accepted")
	}
	for _, table := range []string{"altoc_document_link", "altoc_service_command_receipt"} {
		var count int
		q := "SELECT COUNT(*) FROM " + table
		if table == "altoc_service_command_receipt" {
			q += " WHERE operation_code LIKE 'altoc.apf07b.%'"
		}
		if e = db.QueryRow(q).Scan(&count); e != nil || count != 0 {
			t.Fatal("partial write", table, count, e)
		}
	}
	var version int
	if e = db.QueryRow("SELECT row_version FROM altoc_lead WHERE id=?", id).Scan(&version); e != nil || version != 1 {
		t.Fatal("version was not rolled back", version, e)
	}
	if _, e = db.Exec("DROP TRIGGER fail_support_audit"); e != nil {
		t.Fatal(e)
	}
	results := make(chan error, 2)
	for j := 0; j < 2; j++ {
		go func(j int) {
			actor := who
			actor.Key = fmt.Sprint("concurrent-", j)
			payload := map[string]any{"expectedVersion": float64(1), "document_uuid": fmt.Sprintf("6104e341-43f1-4dd5-a41c-49c97eeab32%d", j), "link_type": "general"}
			_, err := s.SalesSupport(ctx, "lead-documents-create", SalesInput{ID: id, Payload: payload}, actor, scope, read)
			results <- err
		}(j)
	}
	success, conflicts := 0, 0
	for j := 0; j < 2; j++ {
		e := <-results
		if e == nil {
			success++
		} else if httperrorStatus(e) == 409 {
			conflicts++
		} else {
			t.Fatal(e)
		}
	}
	if success != 1 || conflicts != 1 {
		t.Fatal("CAS", success, conflicts)
	}
	if e = db.QueryRow("SELECT row_version FROM altoc_lead WHERE id=?", id).Scan(&version); e != nil || version != 2 {
		t.Fatal(version, e)
	}
	var linkID, documentUUID string
	if e = db.QueryRow("SELECT id,document_uuid FROM altoc_document_link WHERE entity_type='lead' AND entity_id=? AND deleted_at IS NULL", id).Scan(&linkID, &documentUUID); e != nil {
		t.Fatal(e)
	}
	who.Key = "cleanup-lead-reference"
	removed, e := s.SalesSupport(ctx, "lead-documents-delete", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(2), "childId": linkID}}, who, scope, nil)
	if e != nil {
		t.Fatal(e)
	}
	if removed.(map[string]any)["parentVersion"] != "3" {
		t.Fatal(removed)
	}
	who.Key = "relink-lead-reference"
	relinked, e := s.SalesSupport(ctx, "lead-documents-create", SalesInput{ID: id, Payload: map[string]any{"expectedVersion": float64(3), "document_uuid": documentUUID, "link_type": "evidence"}}, who, scope, read)
	if e != nil {
		t.Fatal(e)
	}
	if relinked.(map[string]any)["childId"] != linkID {
		t.Fatal("relink duplicated row", relinked)
	}
	who.Key = "dependency"
	input.Payload["expectedVersion"] = float64(4)
	if _, e = s.SalesSupport(ctx, "lead-documents-create", input, who, scope, func(context.Context, string, string) (map[string]any, error) {
		return nil, httperror.New(503, "dependency", "Unavailable")
	}); httperrorStatus(e) != 503 {
		t.Fatal("dependency misclassified", e)
	}
}
