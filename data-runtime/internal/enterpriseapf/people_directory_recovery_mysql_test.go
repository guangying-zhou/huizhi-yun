package enterpriseapf

import (
	"context"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"strings"
	"testing"
)

func TestAPFPeopleDirectoryRecoveryMySQL(t *testing.T) {
	s, db := factsFixture(t, true)
	ctx := context.Background()
	who := Identity{Actor: "HR", Client: "enterprise.runtime", Tenant: "C000001", Deployment: "host-test", RequestID: "recovery-test", Key: "recovery-create"}
	scope := altoc.BasicReadScope{Access: "all"}
	t.Cleanup(func() {
		db.Exec("DELETE FROM people_service_command_receipt WHERE original_actor_uid='HR'")
		db.Exec("DELETE FROM people_integration_operation WHERE source_biz_code='recovery-employee'")
		db.Exec("DELETE FROM people_directory_lifecycle_versions WHERE employee_uid='recovery-employee'")
		db.Exec("DELETE FROM people_employees WHERE employee_uid='recovery-employee'")
	})
	_, e := s.Execute(ctx, "employees-create", people.EnterpriseFactsInput{EmployeeUID: "recovery-employee", Payload: map[string]any{"display_name": "恢复测试员工", "dept_code": "A"}}, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	var id, key, hash, cmd string
	var v int64
	if e = db.QueryRow("SELECT operation_id,operation_key,command_sha256,command_json,version_no FROM people_integration_operation WHERE source_biz_code='recovery-employee'").Scan(&id, &key, &hash, &cmd, &v); e != nil {
		t.Fatal(e)
	}
	read := people.EnterpriseFactsInput{ID: id}
	out, e := s.DirectoryRecovery(ctx, "directory-operations-view", read, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	data := out.(map[string]any)["data"].(map[string]any)
	if _, ok := data["command_json"]; ok {
		t.Fatal("command leaked")
	}
	if out.(map[string]any)["frozen"] == nil {
		t.Fatal("Host probe command missing")
	}
	for _, sc := range []altoc.BasicReadScope{{Access: "none"}, {Access: "self"}, {Access: "dept", DepartmentCodes: []string{"A"}}} {
		if _, e = s.DirectoryRecovery(ctx, "directory-operations-view", read, who, sc); e == nil {
			t.Fatal("non global scope accepted", sc)
		}
	}
	w := who
	w.Tenant = "other"
	if _, e = s.DirectoryRecovery(ctx, "directory-operations-view", read, w, scope); e == nil {
		t.Fatal("wrong tenant")
	}
	list, e := s.DirectoryRecovery(ctx, "directory-operations-list", people.EnterpriseFactsInput{Page: 1, PageSize: 1}, who, scope)
	if e != nil || list.(map[string]any)["total"] != 1 {
		t.Fatal(list, e)
	}
	replay := people.EnterpriseFactsInput{ID: id, Payload: map[string]any{"expectedVersion": float64(v), "reason": "恢复原目录命令用于隔离测试"}}
	who.Key = "recovery-original-key"
	for _, status := range []string{"pending", "processing", "partial_unknown", "succeeded"} {
		db.Exec("UPDATE people_integration_operation SET status=? WHERE operation_id=?", status, id)
		if _, e = s.DirectoryRecovery(ctx, "directory-operations-replay", replay, who, scope); e == nil {
			t.Fatal("non terminal requeued", status)
		}
	}
	db.Exec("UPDATE people_integration_operation SET status='failed_permanent' WHERE operation_id=?", id)
	// Fault after the requeue mutation: receipt/audit and operation must roll back together.
	if _, e = db.Exec("CREATE TRIGGER recovery_receipt_fault BEFORE UPDATE ON people_service_command_receipt FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='isolated recovery fault'"); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Exec("DROP TRIGGER IF EXISTS recovery_receipt_fault") })
	if _, e = s.DirectoryRecovery(ctx, "directory-operations-replay", replay, who, scope); e == nil {
		t.Fatal("receipt failure accepted")
	}
	var rollbackStatus string
	var rollbackVersion int64
	var rollbackCount, rollbackReceipts int
	if e = db.QueryRow("SELECT status,version_no,replay_count FROM people_integration_operation WHERE operation_id=?", id).Scan(&rollbackStatus, &rollbackVersion, &rollbackCount); e != nil {
		t.Fatal(e)
	}
	if e = db.QueryRow("SELECT COUNT(*) FROM people_service_command_receipt WHERE idempotency_key=?", who.Key).Scan(&rollbackReceipts); e != nil {
		t.Fatal(e)
	}
	if rollbackStatus != "failed_permanent" || rollbackVersion != v || rollbackCount != 0 || rollbackReceipts != 0 {
		t.Fatal("failed replay did not roll back all writes", rollbackStatus, rollbackVersion, rollbackCount, rollbackReceipts)
	}
	if _, e = db.Exec("DROP TRIGGER recovery_receipt_fault"); e != nil {
		t.Fatal(e)
	}
	first, e := s.DirectoryRecovery(ctx, "directory-operations-replay", replay, who, scope)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.DirectoryRecovery(ctx, "directory-operations-replay", replay, who, scope)
	if e != nil || first.(map[string]any)["receiptId"] != again.(map[string]any)["receiptId"] {
		t.Fatal("replay receipt changed", first, again, e)
	}
	var afterKey, afterHash, afterCommand, status string
	var count int
	if e = db.QueryRow("SELECT operation_key,command_sha256,command_json,status,replay_count FROM people_integration_operation WHERE operation_id=?", id).Scan(&afterKey, &afterHash, &afterCommand, &status, &count); e != nil {
		t.Fatal(e)
	}
	if afterKey != key || afterHash != hash || afterCommand != cmd || status != "pending" || count != 1 {
		t.Fatal("frozen command changed or duplicate replay", status, count)
	}
	who.Key = "recovery-another-key"
	if _, e = s.DirectoryRecovery(ctx, "directory-operations-replay", replay, who, scope); e == nil {
		t.Fatal("stale version accepted")
	}
	if _, e = s.DirectoryRecovery(ctx, "directory-operations-replay", replay, who, altoc.BasicReadScope{Access: "none"}); e == nil {
		t.Fatal("revoked permission replay")
	}
	db.Exec("UPDATE people_integration_operation SET source_app='people' WHERE operation_id=?", id)
	if _, e = s.DirectoryRecovery(ctx, "directory-operations-view", read, who, scope); e == nil {
		t.Fatal("legacy source accepted")
	}
	db.Exec("UPDATE people_integration_operation SET source_app='enterprise',command_sha256=? WHERE operation_id=?", strings.Repeat("b", 64), id)
	if _, e = s.DirectoryRecovery(ctx, "directory-operations-view", read, who, scope); e == nil {
		t.Fatal("changed frozen command accepted")
	}
}
