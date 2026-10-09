package enterpriseapf

import (
	"context"
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
	"sync"
	"testing"
)

func TestAPFPeopleDirectoryDeliveryC2MySQL(t *testing.T) {
	s, db := factsFixture(t, true)
	ctx := context.Background()
	who := Identity{Actor: "HR", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", RequestID: "directory-c2", Key: "employee-c2"}
	_, e := s.Execute(ctx, "employees-create", people.EnterpriseFactsInput{EmployeeUID: "employee-c2", Payload: map[string]any{"display_name": "员工乙", "dept_code": "A"}}, who, altoc.BasicReadScope{Access: "all"})
	if e != nil {
		t.Fatal(e)
	}
	who.Actor = ""
	call := func(op string, i PeopleDirectoryInput) any {
		t.Helper()
		out, e := s.Directory(ctx, op, i, who)
		if e != nil {
			t.Fatal(op, e)
		}
		return out
	}
	call("prepare-due", PeopleDirectoryInput{})
	var count int
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE source_biz_type='employee'").Scan(&count)
	call("prepare-due", PeopleDirectoryInput{})
	var again int
	db.QueryRow("SELECT COUNT(*) FROM people_integration_operation WHERE source_biz_type='employee'").Scan(&again)
	if count != 1 || again != count {
		t.Fatal("due repeated immutable command", count, again)
	}
	claimed := call("claim", PeopleDirectoryInput{}).(map[string]any)["operation"].(map[string]any)
	id := claimed["operationId"].(string)
	fence := claimed["fencingToken"].(uint64)
	if out := call("claim", PeopleDirectoryInput{}).(map[string]any); out["operation"] != nil {
		t.Fatal("active lease claimed twice")
	}
	if _, e = s.Directory(ctx, "ack", PeopleDirectoryInput{OperationID: id, FencingToken: fence, Receipt: map[string]any{"operationId": id, "commandSha256": "wrong"}}, who); e == nil {
		t.Fatal("wrong receipt accepted")
	}
	var failers sync.WaitGroup
	failResults := make(chan error, 2)
	for range 2 {
		failers.Add(1)
		go func() {
			defer failers.Done()
			_, err := s.Directory(ctx, "fail", PeopleDirectoryInput{OperationID: id, FencingToken: fence, HTTPStatus: 503}, who)
			failResults <- err
		}()
	}
	failers.Wait()
	close(failResults)
	accepted, stale := 0, 0
	for err := range failResults {
		if err == nil {
			accepted++
		} else if errors.Is(err, integrationoperation.ErrStaleFencing) {
			stale++
		} else {
			t.Fatalf("concurrent fail: %v", err)
		}
	}
	if accepted != 1 || stale != 1 {
		t.Fatalf("fencing accepted=%d stale=%d", accepted, stale)
	}

	if _, e = s.Directory(ctx, "fail", PeopleDirectoryInput{OperationID: id, FencingToken: fence, HTTPStatus: 503}, who); e == nil {
		t.Fatal("expired completion lease reused")
	}
	var attempts int
	db.QueryRow("SELECT attempt_count FROM people_integration_operation WHERE operation_id=?", id).Scan(&attempts)
	if attempts != 1 {
		t.Fatal("repeated fail counted", attempts)
	}
	// A key cannot bypass next_attempt_at; retry will retain the same target key.
	if out := call("claim", PeopleDirectoryInput{OperationKey: claimed["operationKey"].(string)}).(map[string]any); out["operation"] != nil {
		t.Fatal("backoff bypassed")
	}
	if _, err := db.Exec("UPDATE people_integration_operation SET next_attempt_at=UTC_TIMESTAMP(3) WHERE operation_id=?", id); err != nil {
		t.Fatal(err)
	}
	claim2 := call("claim", PeopleDirectoryInput{}).(map[string]any)["operation"].(map[string]any)
	receipt := map[string]any{"operationId": id, "commandSha256": claim2["commandSha256"], "receiptId": "7c3034e8-53ed-4a47-a813-42a8df128df2", "targetBizType": "directory_user", "targetBizCode": "employee-c2", "platformStatus": "pending", "receiptStatus": "succeeded", "operationCode": claim2["operationCode"], "idempotencyKey": claim2["idempotencyKey"], "commandSchemaVersion": "v1", "responseSummarySha256": strings.Repeat("a", 64), "idempotent": false}
	call("ack", PeopleDirectoryInput{OperationID: id, FencingToken: claim2["fencingToken"].(uint64), Receipt: receipt})
	call("ack", PeopleDirectoryInput{OperationID: id, FencingToken: claim2["fencingToken"].(uint64), Receipt: receipt})
	// Two lost-response retries must converge on the same committed receipt.
	var retries sync.WaitGroup
	failures := make(chan error, 2)
	for range 2 {
		retries.Add(1)
		go func() {
			defer retries.Done()
			_, err := s.Directory(ctx, "ack", PeopleDirectoryInput{OperationID: id, FencingToken: claim2["fencingToken"].(uint64), Receipt: receipt}, who)
			failures <- err
		}()
	}
	retries.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatalf("concurrent committed ACK replay: %v", err)
		}
	}
	changed := make(map[string]any, len(receipt))
	for k, v := range receipt {
		changed[k] = v
	}
	changed["receiptId"] = "9a46974e-9d0c-4c51-bf9b-edeb5a8f014e"
	if _, err := s.Directory(ctx, "ack", PeopleDirectoryInput{OperationID: id, FencingToken: claim2["fencingToken"].(uint64), Receipt: changed}, who); err == nil {
		t.Fatal("different committed receipt accepted")
	}
	if err := db.QueryRow("SELECT attempt_count FROM people_integration_operation WHERE operation_id=?", id).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 2 {
		t.Fatalf("ACK replay created attempts: %d", attempts)
	}
	var status string
	db.QueryRow("SELECT status FROM people_integration_operation WHERE operation_id=?", id).Scan(&status)
	if status != "succeeded" {
		t.Fatal("Platform pending must not redeliver source", status)
	}
	who.Actor = "forged"
	if _, e = s.Directory(ctx, "claim", PeopleDirectoryInput{}, who); e == nil {
		t.Fatal("user claimed system operation")
	}
}
