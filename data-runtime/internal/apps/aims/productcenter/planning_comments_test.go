package productcenter

import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"os"
	"testing"
)

func TestMySQLPlanningCommentOwnershipHistoryAndAtomicity(t *testing.T) {
	db := mysqlTestDatabase(t)
	migrateProductCenter(t, db)
	workspaceFixture(t, db, "P-COMMENT")
	item := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,'P-COMMENT','讨论事项','范围','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, item); err != nil {
		t.Fatal(err)
	}
	input := PlanningCommentInput{ItemBizID: item, ExpectedRevision: 1, Body: "研发估算存在异议"}
	actor := "pm"
	action := "create"
	key := "create"
	run := func() (CommandResult, error) {
		p := workspacePermit(t, db, "P-COMMENT", actor, "comment")
		p.Resource = "product_priorities"
		return ChangePlanningComment(context.Background(), db, CommandIdentity{ProductCode: "P-COMMENT", ActorUID: actor, Action: "product_priorities:comment-" + action, IdempotencyKey: key}, p, action, input)
	}
	saved, err := run()
	if err != nil {
		t.Fatal(err)
	}
	replay, err := run()
	if err != nil || !replay.Replayed || replay.ReceiptID != saved.ReceiptID {
		t.Fatalf("replay: %+v %v", replay, err)
	}
	var result struct {
		ID int64 `json:"comment_id"`
	}
	if err = json.Unmarshal(saved.Value, &result); err != nil {
		t.Fatal(err)
	}
	input.CommentID = result.ID
	input.ExpectedRevision = 2
	input.ExpectedCommentRevision = 1
	input.Body = "补充估算依据"
	action = "edit"
	key = "edit"
	actor = "other"
	_, err = run()
	requireProductRule(t, err, "planning_comment_author_required")
	actor = "pm"
	if _, err = db.Exec(`CREATE TRIGGER fail_comment_audit BEFORE INSERT ON product_activity_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='audit failure'`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err == nil {
		t.Fatal("audit failure committed comment")
	}
	var body string
	var rev int
	if err = db.QueryRow(`SELECT body,revision FROM product_planning_comments WHERE id=?`, result.ID).Scan(&body, &rev); err != nil || body != "研发估算存在异议" || rev != 1 {
		t.Fatalf("rollback %s %d %v", body, rev, err)
	}
	if _, err = db.Exec(`DROP TRIGGER fail_comment_audit`); err != nil {
		t.Fatal(err)
	}
	if _, err = run(); err != nil {
		t.Fatal(err)
	}
	input.ExpectedRevision = 3
	key = "stale"
	_, err = run()
	requireProductRule(t, err, "planning_comment_revision_conflict")
	input.ExpectedCommentRevision = 2
	input.Body = ""
	action = "delete"
	key = "delete"
	if _, err = run(); err != nil {
		t.Fatal(err)
	}
	var deleted bool
	if err = db.QueryRow(`SELECT body,revision,deleted_at IS NOT NULL FROM product_planning_comments WHERE id=?`, result.ID).Scan(&body, &rev, &deleted); err != nil || body != "补充估算依据" || rev != 3 || !deleted {
		t.Fatalf("soft delete %s %d %v %v", body, rev, deleted, err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_activity_logs WHERE action LIKE 'comment-%'`).Scan(&count); err != nil || count != 3 {
		t.Fatalf("history %d %v", count, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_planning_items WHERE biz_id=?`, item).Scan(&rev); err != nil || rev != 1 {
		t.Fatalf("discussion mutated planning %d %v", rev, err)
	}
	permit := workspacePermit(t, db, "P-COMMENT", "pm", "view")
	permit.Resource = "product_priorities"
	page, err := ListPlanningComments(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 1 || !page.Items[0].Deleted || page.Items[0].Body != "" {
		t.Fatalf("deleted body exposed: %+v %v", page, err)
	}
	page, err = ListPlanningComments(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 2, PageSize: 1})
	if err != nil || page.Total != 1 || len(page.Items) != 0 {
		t.Fatalf("page boundary: %+v %v", page, err)
	}

	history, err := ReadPlanningCommentHistory(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 2}, result.ID)
	if err != nil || history.Total != 3 || len(history.Items) != 2 || history.Items[0].Action != "comment-delete" || history.Items[1].Action != "comment-edit" {
		t.Fatalf("history %+v %v", history, err)
	}
	var changes struct {
		Before struct {
			Body string `json:"body"`
		} `json:"before"`
	}
	if err = json.Unmarshal(history.Items[1].Changes, &changes); err != nil || changes.Before.Body != "研发估算存在异议" {
		t.Fatalf("original evidence lost %+v %v", changes, err)
	}
	if _, err = ReadPlanningCommentHistory(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 2}, result.ID+100); err == nil {
		t.Fatal("unknown comment history accepted")
	}
	permit.Action = "comment"
	_, err = ReadPlanningCommentHistory(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 2}, result.ID)
	requireProductRule(t, err, "product_authorization_invalid")
	_, err = ListPlanningComments(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 1})
	requireProductRule(t, err, "product_authorization_invalid")

	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='cancelled' WHERE biz_id=?`, item); err != nil {
		t.Fatal(err)
	}
	permit = workspacePermit(t, db, "P-COMMENT", "pm", "view")
	permit.Resource = "product_priorities"
	readonly, err := ListPlanningComments(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 20})
	if err != nil || !readonly.Readonly || readonly.ReadonlyReason == "" {
		t.Fatalf("readonly state %+v %v", readonly, err)
	}
	input = PlanningCommentInput{ItemBizID: item, ExpectedRevision: 4, Body: "不能新增"}
	action = "create"
	key = "readonly"
	_, err = run()
	requireProductRule(t, err, "product_planning_readonly")
	workspaceFixture(t, db, "P-OTHER")
	permit = workspacePermit(t, db, "P-OTHER", "pm", "view")
	permit.Resource = "product_priorities"
	if _, err = ListPlanningComments(context.Background(), db, "P-OTHER", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 1}); err == nil {
		t.Fatal("cross-product comments exposed")
	}

	if _, err = ReadPlanningCommentHistory(context.Background(), db, "P-OTHER", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 2}, result.ID); err == nil {
		t.Fatal("cross-product history exposed")
	}
	otherItem := uuid.NewString()
	if _, err = db.Exec(`INSERT INTO product_planning_items(biz_id,product_code,title,scope_summary,investment_category,created_by,updated_by,created_at,updated_at) VALUES(?,'P-COMMENT','另一事项','范围','growth','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, otherItem); err != nil {
		t.Fatal(err)
	}
	historyPermit := workspacePermit(t, db, "P-COMMENT", "pm", "view")
	historyPermit.Resource = "product_priorities"
	_, err = ReadPlanningCommentHistory(context.Background(), db, "P-COMMENT", "pm", historyPermit, PlanningCommentQuery{ItemBizID: otherItem, Page: 1, PageSize: 2}, result.ID)
	requireProductRule(t, err, "planning_comment_not_found")
	// Use a live comment in a closed-cycle fixture to test all write actions.
	if _, err = db.Exec(`UPDATE product_planning_items SET lifecycle='proposed' WHERE biz_id=?`, item); err != nil {
		t.Fatal(err)
	}
	cycle, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,status,created_by,updated_by,created_at,updated_at) VALUES(?,'P-COMMENT','已闭期','2026-01-01','2026-01-14','保留讨论',JSON_OBJECT(),'closed','pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	cycleID, err := cycle.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank) SELECT ?,id,product_code,1 FROM product_planning_items WHERE biz_id=?`, cycleID, item); err != nil {
		t.Fatal(err)
	}
	live, err := db.Exec(`INSERT INTO product_planning_comments(planning_item_id,author_uid,body,created_at,updated_at) SELECT id,'pm','闭期证据',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3) FROM product_planning_items WHERE biz_id=?`, item)
	if err != nil {
		t.Fatal(err)
	}
	liveID, err := live.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	for _, operation := range []string{"create", "edit", "delete"} {
		action = operation
		key = "closed-" + operation
		input = PlanningCommentInput{ItemBizID: item, ExpectedRevision: 4, Body: "试图改写"}
		if operation != "create" {
			input.CommentID = liveID
			input.ExpectedCommentRevision = 1
		}
		if operation == "delete" {
			input.Body = ""
		}
		_, err = run()
		requireProductRule(t, err, "planning_cycle_closed")
	}
	permit = workspacePermit(t, db, "P-COMMENT", "pm", "view")
	permit.Resource = "product_priorities"
	readonly, err = ListPlanningComments(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 20})
	if err != nil || !readonly.Readonly || readonly.ReadonlyReason != "闭期事项讨论已冻结" || readonly.Total != 2 || readonly.Items[0].Body != "闭期证据" || readonly.Items[0].Revision != 1 {
		t.Fatalf("closed discussion changed %+v %v", readonly, err)
	}
	if err = db.QueryRow(`SELECT revision FROM product_workspaces WHERE product_code='P-COMMENT'`).Scan(&rev); err != nil || rev != 4 {
		t.Fatalf("rejected writes advanced root %d %v", rev, err)
	}

	migration, err := os.ReadFile("../../../../../aims/docs/migration_v5.20_product_comment_cycles.sql")
	if err != nil {
		t.Fatal(err)
	}
	executeSQLScript(t, db, string(migration))
	executeSQLScript(t, db, string(migration))
	var unassigned int
	if err = db.QueryRow(`SELECT COUNT(*) FROM product_planning_comments WHERE cycle_id IS NULL`).Scan(&unassigned); err != nil || unassigned != 2 {
		t.Fatalf("migration guessed historical ownership %d %v", unassigned, err)
	}
	if _, err = db.Exec(`UPDATE product_planning_comments SET cycle_id=? WHERE id=?`, cycleID+100, liveID); err == nil {
		t.Fatal("invalid cycle membership accepted")
	}
	if _, err = db.Exec(`UPDATE product_planning_comments SET cycle_id=? WHERE id=?`, cycleID, liveID); err != nil {
		t.Fatal(err)
	}

	next, err := db.Exec(`INSERT INTO product_planning_cycles(biz_id,product_code,title,starts_on,ends_on,goal_summary,model_snapshot,status,total_person_days,reserve_person_days,reliability_person_days,usability_person_days,growth_person_days,created_by,updated_by,created_at,updated_at) VALUES(?,'P-COMMENT','新周期','2026-02-01','2026-02-14','继续讨论',JSON_OBJECT(),'open',10,0,0,0,10,'pm','pm',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	nextID, err := next.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO product_planning_cycle_items(cycle_id,planning_item_id,product_code,decision_rank) SELECT ?,id,product_code,1 FROM product_planning_items WHERE biz_id=?`, nextID, item); err != nil {
		t.Fatal(err)
	}
	input = PlanningCommentInput{ItemBizID: item, ExpectedRevision: 4, Body: "新周期讨论"}
	action = "create"
	key = "next-cycle"
	if _, err = run(); err != nil {
		t.Fatal(err)
	}
	var linked int64
	if err = db.QueryRow(`SELECT cycle_id FROM product_planning_comments ORDER BY id DESC LIMIT 1`).Scan(&linked); err != nil || linked != nextID {
		t.Fatalf("cycle assignment %d %v", linked, err)
	}
	input = PlanningCommentInput{ItemBizID: item, CommentID: liveID, ExpectedRevision: 5, ExpectedCommentRevision: 1, Body: "旧评论不可改"}
	action = "edit"
	key = "old-cycle"
	_, err = run()
	requireProductRule(t, err, "planning_cycle_closed")
	permit = workspacePermit(t, db, "P-COMMENT", "pm", "view")
	permit.Resource = "product_priorities"
	readonly, err = ListPlanningComments(context.Background(), db, "P-COMMENT", "pm", permit, PlanningCommentQuery{ItemBizID: item, Page: 1, PageSize: 20})
	if err != nil || readonly.Readonly || readonly.Items[0].Readonly || !readonly.Items[1].Readonly {
		t.Fatalf("cycle readonly separation %+v %v", readonly, err)
	}

}
