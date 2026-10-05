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

func testEnterprisePlanReceiptsMySQL(t *testing.T, a *Adapter, db *sql.DB) {
	query := url.Values{"current_user": {"U1"}}
	identity := func(key string, allowed bool) context.Context {
		codes := []string{"P1"}
		if !allowed {
			codes = []string{"P2"}
		}
		return WithEnterpriseProjectCommandScope(context.Background(), EnterpriseProjectUpdateIdentity{
			Tenant: "T1", SourceDeployment: "enterprise-test", TargetDeployment: "aims-test",
			ActorUID: "U1", ServiceClientID: "enterprise.runtime", RequestID: key,
			IdempotencyKey: key, CommandScope: &EnterpriseProjectCommandScope{
				Projection: projectscope.Projection{Version: 1, ProjectCodes: codes, Masks: []int{0, 65535}},
				ExpiresAt:  time.Now().Add(15 * time.Second).UnixMilli(),
			},
		})
	}
	count := func(statement string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRow(statement, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	assertStatus := func(err error, status int) {
		t.Helper()
		var failure httperror.Error
		if !errors.As(err, &failure) || failure.Status != status {
			t.Fatalf("wanted %d, got %v", status, err)
		}
	}
	create := map[string]any{"name": "Receipt milestone", "pivrStage": "I"}
	_, err := a.createProjectMilestone(identity("", true), "1", query, create)
	assertStatus(err, 400)
	first, err := a.createProjectMilestone(identity("plan-milestone-create", true), "1", query, create)
	if err != nil || first["idempotent"] != false {
		t.Fatalf("first milestone create=%#v, %v", first, err)
	}
	milestoneID := fmt.Sprint(first["id"])
	replay, err := a.createProjectMilestone(identity("plan-milestone-create", true), "1", query, create)
	if err != nil || replay["idempotent"] != true || count("SELECT COUNT(*) FROM milestones WHERE name='Receipt milestone'") != 1 {
		t.Fatalf("milestone replay=%#v, %v", replay, err)
	}
	_, err = a.createProjectMilestone(identity("plan-milestone-create", true), "1", query, map[string]any{"name": "Changed payload"})
	assertStatus(err, 409)
	_, err = a.createProjectMilestone(identity("plan-milestone-create", false), "1", query, create)
	assertStatus(err, 403)

	update := map[string]any{"description": "First edit"}
	firstUpdate, err := a.updateDirectMilestone(identity("plan-milestone-update", true), milestoneID, query, update)
	if err != nil || firstUpdate.(map[string]any)["idempotent"] != false {
		t.Fatalf("first milestone update=%#v, %v", firstUpdate, err)
	}
	replayUpdate, err := a.updateDirectMilestone(identity("plan-milestone-update", true), milestoneID, query, update)
	if err != nil || replayUpdate.(map[string]any)["idempotent"] != true || count("SELECT COUNT(*) FROM milestones WHERE id=? AND description='First edit'", first["id"]) != 1 {
		t.Fatalf("milestone update replay=%#v, %v", replayUpdate, err)
	}
	_, err = a.updateDirectMilestone(identity("plan-milestone-update", false), milestoneID, query, update)
	assertStatus(err, 403)

	firstDelete, err := a.deleteDirectMilestone(identity("plan-milestone-delete", true), milestoneID, query)
	if err != nil || firstDelete.(map[string]any)["idempotent"] != false || count("SELECT COUNT(*) FROM milestones WHERE id=?", first["id"]) != 0 {
		t.Fatalf("first milestone delete=%#v, %v", firstDelete, err)
	}
	replayDelete, err := a.deleteDirectMilestone(identity("plan-milestone-delete", true), milestoneID, query)
	if err != nil || replayDelete.(map[string]any)["idempotent"] != true {
		t.Fatalf("deleted milestone replay=%#v, %v", replayDelete, err)
	}
	_, err = a.deleteDirectMilestone(identity("plan-milestone-delete", false), milestoneID, query)
	assertStatus(err, 403)

	anchor, err := a.createProjectMilestone(identity("plan-target-anchor", true), "1", query, map[string]any{"name": "Requirement anchor", "pivrStage": "I"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO project_counters(project_id,counter) VALUES(1,0) ON DUPLICATE KEY UPDATE counter=counter"); err != nil {
		t.Fatal(err)
	}
	targetBody := map[string]any{"milestoneId": anchor["id"], "title": "Requirement receipt target"}
	target, err := a.createRequirementChangeTarget(identity("plan-target-create", true), "1", query, targetBody)
	if err != nil || target["idempotent"] != false {
		t.Fatalf("first requirement target=%#v, %v", target, err)
	}
	targetReplay, err := a.createRequirementChangeTarget(identity("plan-target-create", true), "1", query, targetBody)
	if err != nil || targetReplay["idempotent"] != true || count("SELECT COUNT(*) FROM work_items WHERE title='Requirement receipt target'") != 1 {
		t.Fatalf("requirement target replay=%#v, %v", targetReplay, err)
	}
	_, err = a.createRequirementChangeTarget(identity("plan-target-create", false), "1", query, targetBody)
	assertStatus(err, 403)
	if _, err := db.Exec("UPDATE aims_projects SET leader_uid='U4' WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("UPDATE aims_projects SET leader_uid='U1' WHERE id=1")
	if _, err := db.Exec("UPDATE aims_project_members SET status='suspended' WHERE project_id=1 AND uid='U1'"); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("UPDATE aims_project_members SET status='active' WHERE project_id=1 AND uid='U1'")
	_, err = a.createProjectMilestone(identity("plan-milestone-create", true), "1", query, create)
	assertStatus(err, 403)
	_, err = a.createRequirementChangeTarget(identity("plan-target-create", true), "1", query, targetBody)
	assertStatus(err, 403)
}
