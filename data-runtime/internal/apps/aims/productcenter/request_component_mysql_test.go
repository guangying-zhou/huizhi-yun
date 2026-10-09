package productcenter

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
)

func TestMySQLRequestComponentHierarchyPaginationAndEdit(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-MODULE")
	workspaceFixture(t, db, "P-OTHER")
	ctx := context.Background()
	component := func(code, name string, parent *int64) int64 {
		t.Helper()
		r, err := db.Exec(`INSERT INTO product_components(biz_id,product_code,parent_id,name,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?, 'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, uuid.NewString(), code, parent, name)
		if err != nil {
			t.Fatal(err)
		}
		id, err := r.LastInsertId()
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	rootID := component("P-MODULE", "身份", nil)
	childID := component("P-MODULE", "登录", &rootID)
	otherID := component("P-OTHER", "其他产品模块", nil)
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-MODULE", "pm", action)
		p.Resource = "product_requests"
		return p
	}
	rootRevision := uint64(1)
	create := func(index int, module *int64) RequestRecord {
		t.Helper()
		r, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-MODULE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: fmt.Sprintf("module-create-%d", index)}, permit("create"), RequestDraft{ExpectedRevision: rootRevision, ComponentID: module, Title: fmt.Sprintf("需求 %d", index), ProblemStatement: "改善模块功能", SourceType: "internal", UrgencyLevel: "P2"})
		if err != nil {
			t.Fatal(err)
		}
		rootRevision++
		var out RequestRecord
		if err = json.Unmarshal(r.Value, &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	parentRequest := create(1, &rootID)
	create(2, &childID)
	create(3, &childID)
	unassigned := create(4, nil)
	list := func(query RequestPageQuery, total, count int) RequestPage {
		t.Helper()
		page, err := ListProductRequests(ctx, db, "P-MODULE", "pm", permit("view"), query)
		if err != nil {
			t.Fatal(err)
		}
		if page.Total != total || len(page.Items) != count {
			t.Fatalf("page=%+v want total=%d count=%d", page, total, count)
		}
		return page
	}
	list(RequestPageQuery{Page: 1, PageSize: 2}, 4, 2)
	first := list(RequestPageQuery{Page: 1, PageSize: 2, ComponentID: &rootID, IncludeDescendants: true}, 3, 2)
	second := list(RequestPageQuery{Page: 2, PageSize: 2, ComponentID: &rootID, IncludeDescendants: true}, 3, 1)
	seen := map[string]bool{}
	for _, item := range append(first.Items, second.Items...) {
		if seen[item.BizID] || item.ComponentID == nil || item.ComponentName == nil {
			t.Fatalf("duplicate or missing module projection: %+v", item)
		}
		seen[item.BizID] = true
	}
	list(RequestPageQuery{Page: 1, PageSize: 2, ComponentID: &rootID}, 1, 1)
	u := list(RequestPageQuery{Page: 1, PageSize: 2, Unassigned: true}, 1, 1)
	if u.Items[0].BizID != unassigned.BizID {
		t.Fatalf("wrong unassigned request: %+v", u)
	}
	list(RequestPageQuery{Page: 1, PageSize: 2, ComponentID: &otherID, IncludeDescendants: true}, 0, 0)
	_, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-MODULE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "wrong-product-module"}, permit("create"), RequestDraft{ExpectedRevision: rootRevision, ComponentID: &otherID, Title: "拒绝跨产品", ProblemStatement: "改善模块功能", SourceType: "internal", UrgencyLevel: "P2"})
	requireProductRule(t, err, "product_request_component_invalid")
	// Legacy omitted module preserves assignment; the Runtime's explicit-zero
	// sentinel represents the BFF's explicit null and clears assignment.
	for i, module := range []*int64{nil, new(int64)} {
		_, err = EditProductRequest(ctx, db, CommandIdentity{ProductCode: "P-MODULE", ActorUID: "pm", Action: "product_requests:edit", IdempotencyKey: fmt.Sprintf("module-edit-%d", i)}, permit("edit"), RequestEdit{RequestDraft: RequestDraft{ExpectedRevision: rootRevision, ComponentID: module, Title: "调整描述", ProblemStatement: "改善模块功能", SourceType: "internal", UrgencyLevel: "P2"}, BizID: parentRequest.BizID, ExpectedRequestRevision: uint64(i + 1), Reason: "整理模块"})
		if err != nil {
			t.Fatal(err)
		}
		rootRevision++
		if i == 0 {
			list(RequestPageQuery{Page: 1, PageSize: 2, ComponentID: &rootID}, 1, 1)
		} else {
			list(RequestPageQuery{Page: 1, PageSize: 2, Unassigned: true}, 2, 2)
		}
	}
}
