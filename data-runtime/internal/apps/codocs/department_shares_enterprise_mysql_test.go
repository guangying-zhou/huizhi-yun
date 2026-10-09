package codocs

import (
	"context"
	"database/sql"
	"errors"
	"net/url"
	"os"
	"regexp"
	"strings"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestMySQLEnterpriseDepartmentShareDecision(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires isolated MySQL socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?multiStatements=true&parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "dept_shares_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	db, err := sql.Open("mysql", "root@unix("+socket+")/"+name+"?multiStatements=true&parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"folders", "documents", "document_shares", "department_shares", "document_relations", "operation_logs", "service_command_receipt"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE (?:IF NOT EXISTS )?`?" + table + "`?.*?ENGINE=InnoDB.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal("missing schema", table)
		}
		if _, err = db.Exec(ddl); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	if _, err = db.Exec(`CREATE TABLE test_manager_scope(uid VARCHAR(64),dept_code VARCHAR(64),active BOOLEAN,PRIMARY KEY(uid,dept_code)) ENGINE=InnoDB`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO test_manager_scope VALUES('manager','D1',1),('manager','D2',1)`); err != nil {
		t.Fatal(err)
	}
	check := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
		var active bool
		e := tx.QueryRowContext(ctx, `SELECT active FROM test_manager_scope WHERE uid=? AND dept_code=? FOR UPDATE`, actor, department).Scan(&active)
		if e != nil {
			return httperror.New(503, "directory_unavailable", "Directory unavailable")
		}
		if !active {
			return httperror.New(403, "department_manager_required", "Manager revoked")
		}
		return nil
	}
	insert := func(docUUID, owner string, deleted bool) int64 {
		t.Helper()
		result, e := db.Exec(`INSERT INTO documents(uuid,title,doc_type,oss_path,owner_uid,status,deleted_at) VALUES(?,'Test','private',? ,?,1,?)`, docUUID, "codocs/personal/"+docUUID+".md", owner, func() any {
			if deleted {
				return "2026-09-29 00:00:00"
			}
			return nil
		}())
		if e != nil {
			t.Fatal(e)
		}
		id, e := result.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		result, e = db.Exec(`INSERT INTO department_shares(document_id,from_dept_code,dept_code,shared_by,status) VALUES(?,'','D1','author','pending')`, id)
		if e != nil {
			t.Fatal(e)
		}
		shareID, e := result.LastInsertId()
		if e != nil {
			t.Fatal(e)
		}
		return shareID
	}
	a := &Adapter{db: db}
	identity := EnterpriseDepartmentShareIdentity{Tenant: "C000001", SourceDeployment: "host", TargetDeployment: "codocs", Actor: "manager", Client: "enterprise.runtime", RequestID: "request-1", Key: "intent-12345678", Department: "D1"}
	acceptedUUID := uuid.NewString()
	shareID := insert(acceptedUUID, "author", false)
	page, err := a.DepartmentSharesForEnterprise(context.Background(), "D1", 1, 20)
	if err != nil || page["total"] != int64(1) {
		t.Fatalf("list=%v err=%v", page, err)
	}
	first, err := a.DecideEnterpriseDepartmentShare(context.Background(), identity, shareID, "accept", check)
	if err != nil {
		t.Fatal(err)
	}
	if first["status"] != "accepted" {
		t.Fatalf("first=%v", first)
	}
	var kind, dept, owner, ossPath string
	var folder sql.NullInt64
	if err = db.QueryRow(`SELECT doc_type,dept_code,owner_uid,folder_id,oss_path FROM documents WHERE id=(SELECT document_id FROM department_shares WHERE id=?)`, shareID).Scan(&kind, &dept, &owner, &folder, &ossPath); err != nil {
		t.Fatal(err)
	}
	if kind != "department" || dept != "D1" || owner != "author" || folder.Valid || ossPath != "codocs/personal/"+acceptedUUID+".md" {
		t.Fatalf("bad target %s %s %s %v %s", kind, dept, owner, folder, ossPath)
	}
	privateList, err := a.documentsList(context.Background(), url.Values{"current_user": {"author"}, "hzy_runtime_actor_delegated": {"1"}, "type": {"private"}, "uuid": {acceptedUUID}, "page": {"1"}, "pageSize": {"20"}})
	if err != nil || privateList["total"] != int64(0) {
		t.Fatalf("transferred document remains in personal list: %v %v", privateList, err)
	}
	second, err := a.DecideEnterpriseDepartmentShare(context.Background(), identity, shareID, "accept", check)
	if err != nil || second["status"] != "accepted" {
		t.Fatalf("replay=%v err=%v", second, err)
	}
	for table, want := range map[string]int{"service_command_receipt": 1, "document_relations": 1, "operation_logs": 1} {
		var count int
		if err = db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != want {
			t.Fatalf("%s count=%d err=%v", table, count, err)
		}
	}
	identity.Key = "intent-different-12"
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, shareID, "accept", check)
		return e
	}, 409)
	identity.Key = "intent-12345678"
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, shareID, "reject", check)
		return e
	}, 409)
	identity.Department = "D2"
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, shareID, "accept", check)
		return e
	}, 403)
	identity.Department = "D1"
	if _, err = db.Exec(`UPDATE test_manager_scope SET active=0 WHERE uid='manager' AND dept_code='D1'`); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, shareID, "accept", check)
		return e
	}, 403)
	if _, err = db.Exec(`UPDATE test_manager_scope SET active=1 WHERE uid='manager' AND dept_code='D1'`); err != nil {
		t.Fatal(err)
	}
	identity.Key = "intent-owner-change"
	changed := insert(uuid.NewString(), "other", false)
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, changed, "accept", check)
		return e
	}, 409)
	identity.Key = "intent-deleted-doc"
	deleted := insert(uuid.NewString(), "author", true)
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, deleted, "accept", check)
		return e
	}, 409)
	identity.Key = "intent-kind-change"
	changedKind := insert(uuid.NewString(), "author", false)
	if _, err = db.Exec(`UPDATE documents SET doc_type='shared' WHERE id=(SELECT document_id FROM department_shares WHERE id=?)`, changedKind); err != nil {
		t.Fatal(err)
	}
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, changedKind, "accept", check)
		return e
	}, 409)
	identity.Key = "intent-reject-123"
	rejected := insert(uuid.NewString(), "author", false)
	if _, err = a.DecideEnterpriseDepartmentShare(context.Background(), identity, rejected, "reject", check); err != nil {
		t.Fatal(err)
	}
	if _, err = a.DecideEnterpriseDepartmentShare(context.Background(), identity, rejected, "reject", check); err != nil {
		t.Fatal(err)
	}
	var rejectedKind string
	if err = db.QueryRow(`SELECT doc_type FROM documents WHERE id=(SELECT document_id FROM department_shares WHERE id=?)`, rejected).Scan(&rejectedKind); err != nil || rejectedKind != "private" {
		t.Fatalf("reject changed document: %s %v", rejectedKind, err)
	}
	expectStatus(t, func() error {
		_, e := a.DecideEnterpriseDepartmentShare(context.Background(), identity, rejected, "reject", func(context.Context, *sql.Tx, string, string) error {
			return httperror.New(503, "directory_unavailable", "Directory unavailable")
		})
		return e
	}, 503)
}

func expectStatus(t *testing.T, run func() error, want int) {
	t.Helper()
	err := run()
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != want {
		t.Fatalf("want %d got %v", want, err)
	}
}
