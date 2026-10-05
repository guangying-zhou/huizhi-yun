package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
	"net/url"
	"testing"
	"time"
)

func testEnterpriseRequirementsR1bMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	exec := func(q string, args ...any) sql.Result {
		t.Helper()
		r, e := db.Exec(q, args...)
		if e != nil {
			t.Fatal(e)
		}
		return r
	}
	exec(`INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(981101,'R1BR','Requirements review','R1BR','R1BActor','R1BActor','active'),(981102,'R1BX','Foreign','R1BX','Foreign','Foreign','active')`)
	exec(`INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(981101,'R1BActor','manager','active')`)
	exec(`INSERT INTO milestones(id,project_id,name,status) VALUES(981111,981101,'R1B milestone','active')`)
	identity := func(key string) EnterpriseProjectUpdateIdentity {
		return EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "R1BActor", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"R1BR"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
	}
	command := func(key, object, action string, body map[string]any) map[string]any {
		t.Helper()
		r, e := a.WriteEnterpriseRequirement(ctx, identity(key), "981101", object, action, body)
		if e != nil {
			t.Fatalf("%s: %v", action, e)
		}
		return r
	}
	status := func(err error, want int) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != want {
			t.Fatalf("want %d, got %v", want, err)
		}
	}
	content := command("r1b-content", "", "content-create", map[string]any{"kind": "module", "title": "章节", "headingDepth": float64(2), "contentMd": "旧正文"})
	create := func(key, title string) map[string]any {
		return command(key, "", "create", map[string]any{"title": title, "milestoneId": float64(981111), "contentIds": []any{content["id"]}})
	}
	one := create("r1b-one", "需求一")
	two := create("r1b-two", "需求二")
	batchBody := map[string]any{"batchType": "baseline", "requirementIds": []any{one["id"]}}
	batch := command("r1b-review", "", "review-create", batchBody)
	bid := fmt.Sprint(batch["batchId"])
	replay := command("r1b-review", "", "review-create", batchBody)
	if replay["receiptId"] != batch["receiptId"] || replay["idempotent"] != true {
		t.Fatal("review replay duplicated")
	}
	appended := command("r1b-append", bid, "review-append", map[string]any{"requirementIds": []any{two["id"]}})
	if appended["totalCount"] != float64(2) {
		t.Fatalf("append %#v", appended)
	}
	// Preflight rejects a corrupt/foreign member in an otherwise allowed batch.
	foreign := exec(`INSERT INTO requirement_items(project_id,req_number,req_code,title,status,created_by) VALUES(981102,1,'R1BX-REQ-001','foreign','draft','U-FOREIGN')`)
	foreignID, _ := foreign.LastInsertId()
	_, err := a.WriteEnterpriseRequirement(ctx, identity("r1b-cross"), "981101", bid, "review-append", map[string]any{"requirementIds": []any{float64(foreignID)}})
	status(err, 403)
	command("r1b-withdraw", bid, "review-withdraw", map[string]any{})
	command("r1b-withdraw", bid, "review-withdraw", map[string]any{})
	var drafts int
	if err = db.QueryRow(`SELECT COUNT(*) FROM requirement_items WHERE id IN (?,?) AND status='draft'`, one["id"], two["id"]).Scan(&drafts); err != nil || drafts != 2 {
		t.Fatalf("withdraw did not restore drafts: %d %v", drafts, err)
	}
	// This fixture represents an already Workflow-approved baseline. R1b itself
	// exposes no approve/reject/sync entry and cannot write this result.
	exec(`UPDATE requirement_items SET status='baselined' WHERE id=?`, one["id"])
	exec(`UPDATE requirement_contents SET version_status='baselined' WHERE id=?`, content["id"])
	// Legacy project with existing items but no counter: task generation must
	// initialize from MAX(item_number), not restart at one.
	exec(`INSERT INTO work_items(project_id,item_number,item_key,tier,type,title,status) VALUES(981101,11,'R1BR-11','matter','task','Existing legacy item','todo')`)
	var counterRows int
	if err = db.QueryRow(`SELECT COUNT(*) FROM project_counters WHERE project_id=981101`).Scan(&counterRows); err != nil || counterRows != 0 {
		t.Fatalf("task-create fixture must have no counter row: %d %v", counterRows, err)
	}
	taskBody := map[string]any{"title": "标记任务", "description": "R1B isolated", "milestoneId": float64(981111), "estimatedHours": float64(0.1)}
	task := command("r1b-task", fmt.Sprint(one["id"]), "task-create", taskBody)
	if task["taskId"] == nil {
		t.Fatal("missing task ID")
	}
	command("r1b-task", fmt.Sprint(one["id"]), "task-create", taskBody)
	var taskNumber, taskCounter int64
	if err = db.QueryRow(`SELECT item_number FROM work_items WHERE id=?`, task["taskId"]).Scan(&taskNumber); err != nil || taskNumber != 12 {
		t.Fatalf("counterless task-create must allocate MAX+1: %d %v", taskNumber, err)
	}
	if err = db.QueryRow(`SELECT counter FROM project_counters WHERE project_id=981101`).Scan(&taskCounter); err != nil || taskCounter != 12 {
		t.Fatalf("task-create replay must not increment counter: %d %v", taskCounter, err)
	}
	changeBody := map[string]any{"reason": "隔离变更", "contents": []any{map[string]any{"contentId": content["id"], "title": "章节", "contentMd": "新正文"}}}
	change := command("r1b-change", fmt.Sprint(one["id"]), "change-create", changeBody)
	command("r1b-change", fmt.Sprint(one["id"]), "change-create", changeBody)
	q := url.Values{"current_user": {"R1BActor"}}
	readCtx := WithEnterpriseProjectReadScope(ctx, projectscope.Projection{Version: 1, Masks: []int{65535}}, nil)
	for action, object := range map[string]string{"versions": fmt.Sprint(one["id"]), "change-impact": fmt.Sprint(one["id"]), "change-diff": fmt.Sprint(change["id"]), "review-list": ""} {
		if _, e := a.ReadEnterpriseRequirementExtended(readCtx, "981101", object, action, q); e != nil {
			t.Fatalf("%s: %v", action, e)
		}
	}
	newBatch := command("r1b-change-batch", "", "review-create", map[string]any{"batchType": "change", "requirementIds": []any{change["id"]}})
	if _, e := a.ReadEnterpriseRequirementExtended(readCtx, "981101", fmt.Sprint(newBatch["batchId"]), "review-resolve", q); e != nil {
		t.Fatal(e)
	}
	_, err = a.ReadEnterpriseRequirementExtended(readCtx, "981101", fmt.Sprint(foreignID), "versions", q)
	status(err, 404)
	// Receipt failure must roll back both the batch and status updates.
	// Reusing a chapter already tied to a baseline/change review is forbidden.
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1b-locked-content"), "981101", "", "create", map[string]any{"title": "Must reject reassociation", "milestoneId": float64(981111), "contentIds": []any{content["id"]}})
	status(err, 409)
	var locked httperror.Error
	if !errors.As(err, &locked) || locked.Code != "content_requirement_locked" {
		t.Fatalf("expected locked-chapter reassociation rejection, got %v", err)
	}
	freshContent := command("r1b-fresh-content", "", "content-create", map[string]any{"kind": "module", "title": "独立章节", "headingDepth": float64(2), "contentMd": "回滚测试正文"})
	three := command("r1b-three", "", "create", map[string]any{"title": "需求三", "milestoneId": float64(981111), "contentIds": []any{freshContent["id"]}})
	exec("CREATE TRIGGER r1b_receipt_fault BEFORE UPDATE ON service_command_receipt FOR EACH ROW BEGIN IF NEW.idempotency_key='r1b-fault' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated R1b fault'; END IF; END")
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1b-fault"), "981101", "", "review-create", map[string]any{"batchType": "baseline", "requirementIds": []any{three["id"]}})
	exec("DROP TRIGGER r1b_receipt_fault")
	if err == nil {
		t.Fatal("receipt failure unexpectedly succeeded")
	}
	var actual string
	if e := db.QueryRow("SELECT status FROM requirement_items WHERE id=?", three["id"]).Scan(&actual); e != nil || actual != "draft" {
		t.Fatalf("failed receipt changed requirement: %s %v", actual, e)
	}
	var residue int
	if e := db.QueryRow("SELECT COUNT(*) FROM service_command_receipt WHERE idempotency_key='r1b-fault'").Scan(&residue); e != nil || residue != 0 {
		t.Fatalf("failed receipt left residue: %d %v", residue, e)
	}
	// Revocation applies before an existing receipt, including deleted batch replay.
	exec(`UPDATE aims_projects SET leader_uid='Foreign' WHERE id=981101`)
	exec(`UPDATE aims_project_members SET status='suspended' WHERE project_id=981101`)
	_, err = a.WriteEnterpriseRequirement(ctx, identity("r1b-withdraw"), "981101", bid, "review-withdraw", map[string]any{})
	status(err, 403)
}
