package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"testing"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/projectscope"
)

func testEnterpriseRequirementsR1cMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	ctx := context.Background()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	expect := func(err error, status int) {
		t.Helper()
		var h httperror.Error
		if !errors.As(err, &h) || h.Status != status {
			t.Fatalf("want %d, got %v", status, err)
		}
	}
	exec(`INSERT INTO aims_projects(id,project_code,name,short_name,leader_uid,created_by,lifecycle_status) VALUES(981201,'R1CR','Review','R1CR','R1CActor','R1CActor','active')`)
	exec(`INSERT INTO aims_project_members(project_id,uid,role,status) VALUES(981201,'R1CActor','manager','active')`)
	exec(`INSERT INTO milestones(id,project_id,name,status) VALUES(981211,981201,'Review milestone','active')`)
	identity := func(key string) EnterpriseProjectUpdateIdentity {
		return EnterpriseProjectUpdateIdentity{Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test", ActorUID: "R1CActor", ServiceClientID: "enterprise.runtime", RequestID: key, IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{Projection: projectscope.Projection{Version: 1, ProjectCodes: []string{"R1CR"}, Masks: []int{0, 65535}}, ExpiresAt: time.Now().Add(15 * time.Second).UnixMilli()}}
	}
	command := func(key, object, action string, body map[string]any) map[string]any {
		t.Helper()
		result, err := a.WriteEnterpriseRequirement(ctx, identity(key), "981201", object, action, body)
		if err != nil {
			t.Fatalf("%s: %v", action, err)
		}
		return result
	}
	formal := map[string]map[string]any{}
	a.ConfigureWorkflowInstanceReader(requirementReviewReaderFunc(func(_ context.Context, bid, iid, actor, action string) (map[string]any, error) {
		if actor != "R1CActor" {
			t.Fatal("reader actor not from stored review")
		}
		v := formal[bid]
		if v != nil && (v["action_code"] != action || iid != "" && fmt.Sprint(v["id"]) != iid) {
			t.Fatal("reader binding differs")
		}
		return v, nil
	}))
	defer a.ConfigureWorkflowInstanceReader(nil)
	for index, status := range []string{"approved", "rejected", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			key := fmt.Sprintf("r1c-%d", index)
			content := command(key+"-content", "", "content-create", map[string]any{"title": "独立章节", "kind": "module", "headingDepth": float64(2), "contentMd": "正式基线内容"})
			req := command(key+"-req", "", "create", map[string]any{"title": "需求评审", "milestoneId": float64(981211), "contentIds": []any{content["id"]}})
			batch := command(key+"-review", "", "review-create", map[string]any{"batchType": "baseline", "requirementIds": []any{req["id"]}})
			bid := fmt.Sprint(batch["batchId"])
			frozen := command(key+"-sync", bid, "review-sync", map[string]any{})
			if frozen["synced"] != false {
				t.Fatal("missing instance marked synced")
			}
			// Preparation is durable and stable even with a new caller retry key.
			again := command(key+"-retry-sync", bid, "review-sync", map[string]any{})
			if fmt.Sprint(frozen["formData"]) != fmt.Sprint(again["formData"]) {
				t.Fatal("preparation snapshot changed")
			}
			_, err := a.WriteEnterpriseRequirement(ctx, identity(key+"-withdraw"), "981201", bid, "review-withdraw", map[string]any{})
			expect(err, 409)
			// R1c S4: preparation freezes requirements until the formal result.
			for _, action := range []string{"update", "delete"} {
				payload := map[string]any{}
				if action == "update" {
					payload["title"] = "forged in-review edit"
				}
				_, err := a.WriteEnterpriseRequirement(ctx, identity(key+"-locked-"+action), "981201", fmt.Sprint(req["id"]), action, payload)
				expect(err, 409)
			}
			instanceID := fmt.Sprint(981220 + index)
			formal[bid] = map[string]any{"id": instanceID, "app_code": "aims", "resource_code": "requirements", "action_code": "requirement_baseline", "biz_id": bid, "initiator_uid": "R1CActor", "status": "running", "form_data": frozen["formData"], "approval_operator_uid": "R1CReviewer"}
			bound := command(key+"-sync", bid, "review-sync", map[string]any{})
			if bound["workflowInstanceId"] != instanceID || bound["synced"] != true {
				t.Fatal("instance not bound", bound)
			}
			callback := map[string]any{"event": "flow_completed", "instance_id": instanceID, "app_code": "aims", "resource_code": "requirements", "action_code": "requirement_baseline", "biz_id": bid, "initiator_uid": "R1CActor", "status": status, "form_data": frozen["formData"], "approval_operator_uid": "R1CReviewer"}
			q := url.Values{"workflow_callback_verified": {"1"}}
			_, err = a.applyRequirementReviewWorkflowCallback(ctx, q, callback)
			expect(err, 409) // Running is not a formal result.
			formal[bid]["status"] = status
			for _, field := range []string{"instance_id", "action_code", "initiator_uid", "form_data", "approval_operator_uid"} {
				bad := map[string]any{}
				for k, v := range callback {
					bad[k] = v
				}
				bad[field] = "forged"
				_, err = a.applyRequirementReviewWorkflowCallback(ctx, q, bad)
				expect(err, 409)
			}
			if status == "approved" {
				// Callback fault after domain writes must roll back versions/requirement/batch.
				exec("CREATE TRIGGER r1c_callback_fault BEFORE UPDATE ON requirement_review_batches FOR EACH ROW BEGIN IF NEW.status='approved' AND OLD.status='approved' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated callback fault'; END IF; END")
				_, err = a.applyRequirementReviewWorkflowCallback(ctx, q, callback)
				exec("DROP TRIGGER r1c_callback_fault")
				if err == nil {
					t.Fatal("callback fault accepted")
				}
				var current string
				db.QueryRow("SELECT status FROM requirement_items WHERE id=?", req["id"]).Scan(&current)
				if current != "in_review" {
					t.Fatal("failed callback changed requirement", current)
				}
				var count int
				db.QueryRow("SELECT COUNT(*) FROM requirement_versions WHERE requirement_id=?", req["id"]).Scan(&count)
				if count != 0 {
					t.Fatal("failed callback leaked version")
				}
			}
			if status == "approved" {
				exec("UPDATE aims_projects SET leader_uid='Other' WHERE id=981201")
				exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=981201")
			}
			if _, err = a.applyRequirementReviewWorkflowCallback(ctx, q, callback); err != nil {
				t.Fatal(err)
			}
			if status == "approved" {
				exec("UPDATE aims_projects SET leader_uid='R1CActor' WHERE id=981201")
				exec("UPDATE aims_project_members SET status='active' WHERE project_id=981201")
			}
			if _, err = a.applyRequirementReviewWorkflowCallback(ctx, q, callback); err != nil {
				t.Fatal("callback replay", err)
			}
			var current string
			db.QueryRow("SELECT status FROM requirement_review_batches WHERE id=?", bid).Scan(&current)
			want := status
			if status == "cancelled" {
				want = "rejected"
			}
			if current != want {
				t.Fatal("wrong final review", current)
			}
			if status == "approved" {
				tasks := command(key+"-tasks", bid, "review-create-tasks", map[string]any{})
				replay := command(key+"-tasks", bid, "review-create-tasks", map[string]any{})
				if tasks["createdCount"] != float64(1) || replay["receiptId"] != tasks["receiptId"] {
					t.Fatal("task replay", tasks, replay)
				}
				var versions int
				db.QueryRow("SELECT COUNT(*) FROM requirement_versions WHERE requirement_id=?", req["id"]).Scan(&versions)
				if versions != 1 {
					t.Fatal("duplicate approval version", versions)
				}
				exec("UPDATE aims_projects SET leader_uid='Other' WHERE id=981201")
				exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=981201")
				_, err = a.WriteEnterpriseRequirement(ctx, identity(key+"-tasks"), "981201", bid, "review-create-tasks", map[string]any{})
				expect(err, 403)
				exec("UPDATE aims_projects SET leader_uid='R1CActor' WHERE id=981201")
				exec("UPDATE aims_project_members SET status='active' WHERE project_id=981201")
			}
		})
	}
}
