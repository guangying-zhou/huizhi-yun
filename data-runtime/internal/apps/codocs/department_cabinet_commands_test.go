package codocs

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func departmentCabinetIdentity() EnterpriseDepartmentCabinetIdentity {
	return EnterpriseDepartmentCabinetIdentity{Tenant: "tenant-1", SourceDeployment: "enterprise-test", TargetDeployment: "codocs-test", Actor: "actor-1", Client: "enterprise.runtime", RequestID: "req-1", Key: "intent-1234", Department: "D1"}
}

func TestDepartmentCabinetUploadPlanBindsDepartmentAndRejectsForgedIdentity(t *testing.T) {
	identity := departmentCabinetIdentity()
	payload := map[string]any{"original_name": "plan.pdf", "file_ext": "pdf", "file_size": float64(4), "content_sha256": strings.Repeat("a", 64), "folder_id": nil}
	one, err := departmentCabinetUploadFacts(identity, payload)
	if err != nil {
		t.Fatal(err)
	}
	other := identity
	other.Department = "D2"
	two, err := departmentCabinetUploadFacts(other, payload)
	if err != nil {
		t.Fatal(err)
	}
	if one["uuid"] == two["uuid"] || !strings.HasPrefix(one["oss_path"].(string), "codocs/departments/D1/cabinet/") {
		t.Fatalf("department not bound: %v %v", one, two)
	}
	payload["owner_uid"] = "victim"
	if _, err := departmentCabinetUploadFacts(identity, payload); err == nil {
		t.Fatal("forged owner accepted")
	}
}

func TestDepartmentCabinetWritesRecheckCurrentManagerBeforeReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectRollback()
	called := 0
	_, err = (&Adapter{db: db}).EnterpriseDepartmentCabinetCommand(context.Background(), departmentCabinetIdentity(), "delete", map[string]any{"uuid": "file-1"}, func(_ context.Context, _ *sql.Tx, actor, department string) error {
		called++
		if actor != "actor-1" || department != "D1" {
			t.Fatalf("check got %s/%s", actor, department)
		}
		return errors.New("revoked")
	})
	if err == nil || called != 1 {
		t.Fatalf("revoked manager allowed: %v calls=%d", err, called)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDepartmentCabinetMutationRejectsForgedScopeAndCycle(t *testing.T) {
	for _, payload := range []map[string]any{
		{"uuid": "file-1", "filename": "new.pdf", "dept_code": "D2"},
		{"uuid": "file-1", "filename": "new.pdf", "owner_uid": "victim"},
		{"uuid": "file-1", "filename": "new.pdf", "actor_uid": "victim"},
		{"id": float64(7), "name": "Folder", "folder_id": float64(7), "dept_code": "D2"},
	} {
		if err := validateDepartmentCabinetMutation("update", payload); err == nil && payload["uuid"] != nil {
			t.Fatalf("forged file field accepted: %#v", payload)
		}
		if payload["id"] != nil {
			if err := validateDepartmentCabinetMutation("folder-update", payload); err == nil {
				t.Fatalf("forged folder field accepted: %#v", payload)
			}
		}
	}
	if err := validateDepartmentCabinetMutation("update", map[string]any{"uuid": "file-1", "folder_id": nil}); err != nil {
		t.Fatalf("move to root rejected: %v", err)
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := checkDepartmentCabinetFolderCycle(context.Background(), nil, "D1", 7, 7); err == nil {
		t.Fatal("self-parent allowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
