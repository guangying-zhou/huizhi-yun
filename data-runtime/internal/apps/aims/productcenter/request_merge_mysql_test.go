package productcenter

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMySQLRequestMergePreservesEvidenceAndRollsBack(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-MERGE")
	ctx := context.Background()
	permit := func(action string) AuthorizationPermit {
		p := workspacePermit(t, db, "P-MERGE", "pm", action)
		p.Resource = "product_requests"
		return p
	}
	ids := []string{}
	for i, title := range []string{"重复登录", "统一身份"} {
		result, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-MERGE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: title}, permit("create"), RequestDraft{ExpectedRevision: uint64(i + 1), Title: title, ProblemStatement: "需要统一身份体验", SourceType: "internal", UrgencyLevel: "P2"})
		if err != nil {
			t.Fatal(err)
		}
		var row struct {
			BizID string `json:"biz_id"`
		}
		if err := json.Unmarshal(result.Value, &row); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, row.BizID)
	}
	_, err := AddManualRequestSource(ctx, db, CommandIdentity{ProductCode: "P-MERGE", ActorUID: "pm", Action: "product_requests:source-create", IdempotencyKey: "evidence"}, permit("edit"), ManualRequestSource{BizID: ids[0], ExpectedRevision: 3, ExpectedRequestRevision: 1, Note: "原始访谈", Kind: "fact", Direction: "supporting"})
	if err != nil {
		t.Fatal(err)
	}
	input := RequestMerge{BizID: ids[0], TargetBizID: ids[1], ExpectedRevision: 4, ExpectedRequestRevision: 2, ExpectedTargetRevision: 1, Reason: "同一问题，统一评估"}
	identity := CommandIdentity{ProductCode: "P-MERGE", ActorUID: "pm", Action: "product_requests:merge", IdempotencyKey: "merge"}
	_, err = MergeProductRequest(ctx, db, identity, permit("edit"), input)
	requireProductRule(t, err, "product_authorization_invalid")
	bad := input
	bad.TargetBizID = bad.BizID
	_, err = MergeProductRequest(ctx, db, identity, permit("decide"), bad)
	requireProductRule(t, err, "product_request_merge_self")
	if _, err = db.Exec(`CREATE TRIGGER pc_fail_merge BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = MergeProductRequest(ctx, db, identity, permit("decide"), input); err == nil {
		t.Fatal("audit failure committed")
	}
	source, err := ReadProductRequest(ctx, db, "P-MERGE", "pm", ids[0], permit("view"))
	if err != nil || source.DecisionStatus != "submitted" || source.Revision != 2 {
		t.Fatalf("rollback %+v %v", source, err)
	}
	if _, err = db.Exec(`DROP TRIGGER pc_fail_merge`); err != nil {
		t.Fatal(err)
	}
	if _, err = MergeProductRequest(ctx, db, identity, permit("decide"), input); err != nil {
		t.Fatal(err)
	}
	replay, err := MergeProductRequest(ctx, db, identity, permit("decide"), input)
	if err != nil || !replay.Replayed {
		t.Fatalf("replay %+v %v", replay, err)
	}
	source, err = ReadProductRequest(ctx, db, "P-MERGE", "pm", ids[0], permit("view"))
	if err != nil || source.DecisionStatus != "merged" || source.MergedIntoID == nil || source.Revision != 3 {
		t.Fatalf("merged %+v %v", source, err)
	}
	evidence, err := ListRequestSources(ctx, db, "P-MERGE", "pm", permit("view"), RequestSourcePageQuery{BizID: ids[0], Page: 1, PageSize: 10})
	if err != nil || evidence.Total != 1 {
		t.Fatalf("evidence %+v %v", evidence, err)
	}
	page, err := ListProductRequests(ctx, db, "P-MERGE", "pm", permit("view"), RequestPageQuery{Page: 1, PageSize: 1})
	if err != nil || page.Total != 2 || page.UnmergedTotal != 1 || len(page.Items) != 1 {
		t.Fatalf("merged counts %+v %v", page, err)
	}
	mergedPage, err := ListProductRequests(ctx, db, "P-MERGE", "pm", permit("view"), RequestPageQuery{Page: 1, PageSize: 10, DecisionStatus: "merged"})
	if err != nil || mergedPage.Total != 1 || mergedPage.UnmergedTotal != 0 {
		t.Fatalf("filtered counts %+v %v", mergedPage, err)
	}
	reverse := RequestMerge{BizID: ids[1], TargetBizID: ids[0], ExpectedRevision: 5, ExpectedRequestRevision: 2, ExpectedTargetRevision: 3, Reason: "形成循环"}
	identity.IdempotencyKey = "reverse"
	_, err = MergeProductRequest(ctx, db, identity, permit("decide"), reverse)
	requireProductRule(t, err, "product_request_merged_readonly")
	created, err := CreateProductRequest(ctx, db, CommandIdentity{ProductCode: "P-MERGE", ActorUID: "pm", Action: "product_requests:create", IdempotencyKey: "third"}, permit("create"), RequestDraft{ExpectedRevision: 5, Title: "统一入口", ProblemStatement: "统一身份与入口", SourceType: "internal", UrgencyLevel: "P2"})
	if err != nil {
		t.Fatal(err)
	}
	var third struct {
		BizID string `json:"biz_id"`
	}
	if err := json.Unmarshal(created.Value, &third); err != nil {
		t.Fatal(err)
	}
	identity.IdempotencyKey = "merge-again"
	_, err = MergeProductRequest(ctx, db, identity, permit("decide"), RequestMerge{BizID: ids[1], TargetBizID: third.BizID, ExpectedRevision: 6, ExpectedRequestRevision: 2, ExpectedTargetRevision: 1, Reason: "继续归并"})
	if err != nil {
		t.Fatal(err)
	}
	trail, err := ReadProductRequest(ctx, db, "P-MERGE", "pm", ids[0], permit("view"))
	if err != nil || len(trail.MergeTrail) != 2 || trail.MergeTrail[0].BizID != ids[1] || trail.MergeTrail[1].BizID != third.BizID || trail.MergeTrailTruncated {
		t.Fatalf("multi-hop trail %+v %v", trail, err)
	}
	for target, expected := range map[string]string{ids[1]: ids[0], third.BizID: ids[1]} {
		inbound, err := ListProductRequests(ctx, db, "P-MERGE", "pm", permit("view"), RequestPageQuery{Page: 1, PageSize: 1, MergedIntoBizID: target})
		if err != nil || inbound.Total != 1 || inbound.UnmergedTotal != 0 || len(inbound.Items) != 1 || inbound.Items[0].BizID != expected {
			t.Fatalf("inbound %+v %v", inbound, err)
		}
	}
	// Simulate invalid legacy data; reads must fail instead of looping forever.
	if _, err := db.Exec(`UPDATE product_requests SET decision_status='merged',merged_into_id=? WHERE biz_id=?`, source.ID, third.BizID); err != nil {
		t.Fatal(err)
	}
	_, err = ReadProductRequest(ctx, db, "P-MERGE", "pm", ids[0], permit("view"))
	requireProductRule(t, err, "product_request_merge_cycle")

}
