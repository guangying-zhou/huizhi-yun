package codocs

import (
	"context"
	"database/sql"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	directoryapp "github.com/huizhi-yun/data-runtime/internal/apps/directory"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Regression: Directory and Codocs are distinct schemas even on one Runtime.
// The Directory shared locks must remain held until the Codocs receipt commits.
func TestMySQLDepartmentDirectoryCrossSchemaLock(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires isolated MySQL socket")
	}
	ctx := context.Background()
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	directoryName, codocsName := "dir_lock_"+suffix, "cod_lock_"+suffix
	for _, name := range []string{directoryName, codocsName} {
		if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
			t.Fatal(err)
		}
		defer admin.Exec("DROP DATABASE " + name)
	}
	dirDB, err := sql.Open("mysql", "root@unix("+socket+")/"+directoryName+"?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer dirDB.Close()
	docDB, err := sql.Open("mysql", "root@unix("+socket+")/"+codocsName+"?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer docDB.Close()
	for _, ddl := range []string{
		`CREATE TABLE directory_departments(dept_code VARCHAR(64) PRIMARY KEY, leader_uid VARCHAR(64), manager_uid VARCHAR(64), parent_dept_code VARCHAR(64), status VARCHAR(32), org_type VARCHAR(32)) ENGINE=InnoDB`,
		`CREATE TABLE directory_users(uid VARCHAR(64) PRIMARY KEY, status VARCHAR(32)) ENGINE=InnoDB`,
		`CREATE TABLE directory_user_departments(uid VARCHAR(64), dept_code VARCHAR(64), status VARCHAR(32), PRIMARY KEY(uid,dept_code)) ENGINE=InnoDB`,
	} {
		if _, err := dirDB.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := dirDB.Exec(`INSERT INTO directory_departments VALUES('D1',NULL,'manager',NULL,'active','department')`); err != nil {
		t.Fatal(err)
	}
	if _, err := dirDB.Exec(`INSERT INTO directory_users VALUES('manager','active')`); err != nil {
		t.Fatal(err)
	}
	if _, err := dirDB.Exec(`INSERT INTO directory_user_departments VALUES('manager','D1','active')`); err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"folders", "documents", "document_shares", "department_shares", "document_relations", "operation_logs", "service_command_receipt"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE (?:IF NOT EXISTS )?`?" + table + "`?.*?ENGINE=InnoDB.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal("missing schema", table)
		}
		if _, err := docDB.Exec(ddl); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	directory := directoryapp.NewWithDB(dirDB, "C000001", "", "")
	// This is the former failing shape: Codocs' transaction cannot read Directory.
	wrongTx, err := docDB.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := directory.EnterpriseCodocsDepartmentAccessTx(ctx, wrongTx, "manager", "D1"); err == nil {
		t.Fatal("old cross-schema query unexpectedly succeeded")
	}
	_ = wrongTx.Rollback()
	entry, err := docDB.Exec(`INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,status) VALUES(?,'Test','private','codocs/personal/source.md','author',1)`, uuid.NewString())
	if err != nil {
		t.Fatal(err)
	}
	documentID, _ := entry.LastInsertId()
	entry, err = docDB.Exec(`INSERT INTO department_shares(document_id,from_dept_code,dept_code,shared_by,status) VALUES(?,'','D1','author','pending')`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	shareID, _ := entry.LastInsertId()
	identity := EnterpriseDepartmentShareIdentity{Tenant: "C000001", SourceDeployment: "host", TargetDeployment: "codocs", Actor: "manager", Client: "enterprise.runtime", RequestID: "request-1", Key: "intent-cross-schema", Department: "D1"}
	role, directoryTx, err := directory.LockEnterpriseCodocsDepartmentAccess(ctx, "manager", "D1")
	if err != nil || !role.CanManage() {
		t.Fatalf("locked role=%s err=%v", role, err)
	}
	revoked := make(chan error, 1)
	go func() {
		_, e := dirDB.Exec(`UPDATE directory_departments SET manager_uid='other' WHERE dept_code='D1'`)
		revoked <- e
	}()
	select {
	case e := <-revoked:
		t.Fatalf("revocation passed shared lock: %v", e)
	case <-time.After(80 * time.Millisecond):
	}
	check := func(_ context.Context, _ *sql.Tx, actor, dept string) error {
		if actor != "manager" || dept != "D1" || !role.CanManage() {
			return httperror.New(403, "department_manager_required", "Manager required")
		}
		return nil
	}
	folderIdentity := EnterpriseDepartmentFolderIdentity{Tenant: "C000001", SourceDeployment: "host", TargetDeployment: "codocs", Actor: "manager", Client: "enterprise.runtime", RequestID: "request-folder", Key: "intent-folder-cross-schema", Department: "D1"}
	if _, err := (&Adapter{db: docDB}).CreateEnterpriseDepartmentFolder(ctx, folderIdentity, map[string]any{"name": "First", "folder_type": "department", "dept_code": "D1"}, check); err != nil {
		t.Fatal(err)
	}
	if _, err := (&Adapter{db: docDB}).DecideEnterpriseDepartmentShare(ctx, identity, shareID, "accept", check); err != nil {
		t.Fatal(err)
	}
	select {
	case e := <-revoked:
		t.Fatalf("revocation completed before Directory release: %v", e)
	case <-time.After(80 * time.Millisecond):
	}
	if err := directoryTx.Rollback(); err != nil {
		t.Fatal(err)
	}
	select {
	case e := <-revoked:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("revocation did not complete")
	}
	role, replayTx, err := directory.LockEnterpriseCodocsDepartmentAccess(ctx, "manager", "D1")
	if err != nil {
		t.Fatal(err)
	}
	defer replayTx.Rollback()
	if role.CanManage() {
		t.Fatal("revoked manager retained access")
	}
	expectStatus(t, func() error {
		_, e := (&Adapter{db: docDB}).DecideEnterpriseDepartmentShare(ctx, identity, shareID, "accept", func(context.Context, *sql.Tx, string, string) error {
			return httperror.New(403, "department_manager_required", "Manager required")
		})
		return e
	}, 403)
}
