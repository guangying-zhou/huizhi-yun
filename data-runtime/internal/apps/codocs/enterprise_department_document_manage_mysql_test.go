package codocs

import (
	"context"
	"database/sql"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestMySQLEnterpriseDepartmentDocumentManageReceiptSchema(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires isolated MySQL socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "dept_doc_manage_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec("DROP DATABASE " + name)
	db, err := sql.Open("mysql", "root@unix("+socket+")/"+name+"?parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	schema, err := os.ReadFile("../../../../codocs/docs/codocs_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"folders", "documents", "service_command_receipt"} {
		ddl := regexp.MustCompile("(?s)CREATE TABLE (?:IF NOT EXISTS )?`?" + table + "`?.*?ENGINE=InnoDB.*?;").FindString(string(schema))
		if ddl == "" {
			t.Fatal("missing schema", table)
		}
		if _, err := db.Exec(ddl); err != nil {
			t.Fatalf("%s: %v", table, err)
		}
	}
	docUUID := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO documents(uuid,title,doc_type,dept_code,oss_path,owner_uid,status) VALUES(?,'Test','department','D1',?,'author',1)`, docUUID, "codocs/departments/D1/test.md"); err != nil {
		t.Fatal(err)
	}
	a := &Adapter{db: db}
	identity := departmentFolderIdentity()
	identity.Key = "intent-readonly-real-schema"
	check := func(context.Context, *sql.Tx, string, string) error { return nil }
	if _, err := a.ManageEnterpriseDepartmentDocument(context.Background(), identity, "readonly", docUUID, map[string]any{"readonly_flag": true}, check); err != nil {
		t.Fatal(err)
	}
	identity.Key = "intent-recycle-real-schema"
	if _, err := a.ManageEnterpriseDepartmentDocument(context.Background(), identity, "recycle", docUUID, map[string]any{}, check); err != nil {
		t.Fatal(err)
	}
	rows, err := db.Query(`SELECT command_schema_version FROM service_command_receipt ORDER BY command_schema_version`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	versions := []string{}
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			t.Fatal(err)
		}
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(versions) != 2 || versions[0] != "codocs-dept-doc-readonly.v1" || versions[1] != "codocs-dept-doc-recycle.v1" {
		t.Fatalf("versions=%v", versions)
	}
	var readonly, status int
	if err := db.QueryRow(`SELECT readonly_flag,status FROM documents WHERE uuid=?`, docUUID).Scan(&readonly, &status); err != nil {
		t.Fatal(err)
	}
	if readonly != 1 || status != 0 {
		t.Fatalf("readonly=%d status=%d", readonly, status)
	}
}
