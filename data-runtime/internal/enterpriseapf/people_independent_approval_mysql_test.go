package enterpriseapf

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/apps/workflow"
	"testing"
)

func TestAPFPeopleIndependentApprovalMySQL(t *testing.T) {
	for _, status := range []string{"approved", "rejected", "cancelled"} {
		t.Run(status, func(t *testing.T) {
			s, db := factsFixture(t)
			_, wdb := peopleFixture(t) // different isolated database; no Workflow Registry domain
			if _, e := wdb.Exec("CREATE TABLE flow_instances(id BIGINT PRIMARY KEY,instance_no VARCHAR(64),app_code VARCHAR(30),resource_code VARCHAR(40),action_code VARCHAR(40),biz_id VARCHAR(64),initiator_uid VARCHAR(64),status VARCHAR(30),callback_url VARCHAR(255),form_data JSON)"); e != nil {
				t.Fatal(e)
			}
			s.ApprovalReader = workflow.NewWithDB(wdb)
			ctx := context.Background()
			who := Identity{Actor: "HR", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", Key: "employee"}
			scope := altoc.BasicReadScope{Access: "all"}
			if _, e := s.Execute(ctx, "employees-create", people.EnterpriseFactsInput{EmployeeUID: "Independent", Payload: map[string]any{"display_name": "Employee", "dept_code": "A"}}, who, scope); e != nil {
				t.Fatal(e)
			}
			who.Key = "draft"
			out, e := s.Execute(ctx, "assignments-change", people.EnterpriseFactsInput{EmployeeUID: "Independent", Payload: map[string]any{"change_type": "transfer", "effective_from": "2099-01-01", "dept_code": "B"}}, who, scope)
			if e != nil {
				t.Fatal(e)
			}
			data := out.(map[string]any)["data"].(map[string]any)
			id := fmt.Sprint(data["id"])
			code := fmt.Sprint(data["assignment_code"])
			form := data["formData"].(map[string]any)
			form["snapshotHash"] = data["snapshotHash"]
			raw, _ := json.Marshal(form)
			if _, e = wdb.Exec("INSERT INTO flow_instances VALUES(39,'WF-39','people','assignments','change',?,'HR','running','/api/v1/service/workflow/callback',?)", code, string(raw)); e != nil {
				t.Fatal(e)
			}
			who.Key = "attach"
			input := people.EnterpriseFactsInput{ID: id, EmployeeUID: "Independent", Payload: map[string]any{"expectedVersion": float64(1), "workflowInstanceId": "39"}}
			for _, change := range []string{"initiator_uid='hr'", "biz_id='other'", "status='pending'", "callback_url='/other'", "form_data=JSON_SET(form_data,'$.snapshotHash','wrong')"} {
				if _, e = wdb.Exec("UPDATE flow_instances SET " + change + " WHERE id=39"); e != nil {
					t.Fatal(e)
				}
				if _, e = s.Execute(ctx, "assignments-attach-workflow", input, who, scope); peopleStatus(e) != 403 {
					t.Fatal(change, e)
				}
				if _, e = wdb.Exec("UPDATE flow_instances SET initiator_uid='HR',biz_id=?,status='running',callback_url='/api/v1/service/workflow/callback',form_data=? WHERE id=39", code, string(raw)); e != nil {
					t.Fatal(e)
				}
			}
			for n := 0; n < 2; n++ {
				if _, e = s.Execute(ctx, "assignments-attach-workflow", input, who, scope); e != nil {
					t.Fatal("attach/replay", e)
				}
			}
			if _, e = wdb.Exec("UPDATE flow_instances SET initiator_uid='Other' WHERE id=39"); e != nil {
				t.Fatal(e)
			}
			if _, e = s.Execute(ctx, "assignments-attach-workflow", input, who, scope); peopleStatus(e) != 403 {
				t.Fatal("receipt replay must revalidate binding", e)
			}
			if _, e = wdb.Exec("UPDATE flow_instances SET initiator_uid='HR' WHERE id=39"); e != nil {
				t.Fatal(e)
			}
			var version int64
			if e = db.QueryRow("SELECT row_version FROM people_assignments WHERE id=?", id).Scan(&version); e != nil || version != 2 {
				t.Fatal("duplicate attach", version, e)
			}
			if _, e = wdb.Exec("UPDATE flow_instances SET status=? WHERE id=39", status); e != nil {
				t.Fatal(e)
			}
			callback := PeopleFactsCallback{AppCode: "people", BizType: "assignments", BizID: code, InstanceID: "39", Status: "approved"}
			if status == "approved" {
				callback.Status = "rejected"
			}
			if _, e = s.Callback(ctx, callback, who); peopleStatus(e) != 403 {
				t.Fatal("wrong callback terminal", e)
			}
			callback.Status = status
			for n := 0; n < 2; n++ {
				if _, e = s.Callback(ctx, callback, who); e != nil {
					t.Fatal("callback/replay", e)
				}
			}
			var actual string
			if e = db.QueryRow("SELECT approval_status FROM people_assignments WHERE id=?", id).Scan(&actual); e != nil || actual != status {
				t.Fatal(actual, e)
			}
		})
	}
}
