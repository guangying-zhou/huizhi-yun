package codocs

import (
	"context"
	"database/sql"
	"os"
	"regexp"
	"strings"
	"testing"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestMySQLDepartmentCabinetReceiptAndRevocation(t *testing.T) {
	socket := os.Getenv("HZY_PRODUCT_CENTER_TEST_SOCKET")
	if socket == "" {
		t.Skip("requires explicit isolated MySQL socket")
	}
	admin, err := sql.Open("mysql", "root@unix("+socket+")/?multiStatements=true&parseTime=true")
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := "dept_cabinet_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, table := range []string{"cabinet_folders", "cabinet_files", "service_command_receipt"} {
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
	if _, err = db.Exec(`INSERT INTO test_manager_scope VALUES ('actor-1','D1',1)`); err != nil {
		t.Fatal(err)
	}
	check := func(ctx context.Context, tx *sql.Tx, actor, department string) error {
		var active bool
		if err := tx.QueryRowContext(ctx, `SELECT active FROM test_manager_scope WHERE uid=? AND dept_code=? FOR UPDATE`, actor, department).Scan(&active); err != nil {
			return err
		}
		if !active {
			return httperror.New(403, "department_manager_required", "Manager revoked")
		}
		return nil
	}
	a := &Adapter{db: db}
	identity := departmentCabinetIdentity()
	payload := map[string]any{"name": "Plans", "folder_id": nil}
	first, err := a.EnterpriseDepartmentCabinetCommand(context.Background(), identity, "folder-create", payload, check)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.EnterpriseDepartmentCabinetCommand(context.Background(), identity, "folder-create", payload, check)
	if err != nil || second["id"] != first["id"] {
		t.Fatalf("replay=%v err=%v", second, err)
	}
	var folders, receipts int
	if err = db.QueryRow(`SELECT COUNT(*) FROM cabinet_folders`).Scan(&folders); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM service_command_receipt`).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if folders != 1 || receipts != 1 {
		t.Fatalf("duplicate effects folders=%d receipts=%d", folders, receipts)
	}
	if _, err = a.EnterpriseDepartmentCabinetCommand(context.Background(), identity, "folder-create", map[string]any{"name": "Different", "folder_id": nil}, check); err == nil {
		t.Fatal("same key different payload accepted")
	}
	if _, err = db.Exec(`UPDATE test_manager_scope SET active=0 WHERE uid='actor-1' AND dept_code='D1'`); err != nil {
		t.Fatal(err)
	}
	if _, err = a.EnterpriseDepartmentCabinetCommand(context.Background(), identity, "folder-create", payload, check); err == nil {
		t.Fatal("revoked manager replayed receipt")
	}
}
