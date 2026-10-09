package enterprisescheduler

import (
	"context"
	"database/sql"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"os"
	"strings"
	"testing"
)

func schedulerCompletionTables(t *testing.T, db *sql.DB, mapping map[string]string) {
	t.Helper()
	ddl, err := os.ReadFile("../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	run := func(q string) {
		t.Helper()
		if _, err := conn.ExecContext(context.Background(), q); err != nil {
			t.Fatal(err)
		}
	}
	run("SET FOREIGN_KEY_CHECKS=0")
	for _, name := range CompletionViewNames() {
		marker := "CREATE TABLE IF NOT EXISTS `" + name + "` ("
		start := strings.Index(string(ddl), marker)
		if start < 0 {
			marker = "CREATE TABLE IF NOT EXISTS " + name + " ("
			start = strings.Index(string(ddl), marker)
		}
		if start < 0 {
			t.Fatal("missing real DDL", name)
		}
		end := strings.Index(string(ddl)[start:], ";\n")
		if end < 0 {
			t.Fatal("missing terminator", name)
		}
		run(string(ddl)[start : start+end])
		run("RENAME TABLE `" + name + "` TO `u_" + name + "`")
		mapping[name] = "u_" + name
	}
	run("SET FOREIGN_KEY_CHECKS=1")
}
func schedulerCompletionViews(t *testing.T, db *sql.DB, b e.Binding) {
	t.Helper()
	ctx := context.Background()
	if _, err := db.Exec("UPDATE enterprise_schema_registry SET generation=0 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
	plan, err := e.PlanCompatibilityViews(ctx, db, b, "aims", CompletionViewNames())
	if err != nil {
		t.Fatal(err)
	}
	if err = e.ApplyCompatibilityViews(ctx, db, b, "aims", CompletionViewNames(), plan.ReviewHash); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("UPDATE enterprise_schema_registry SET generation=1 WHERE id=1"); err != nil {
		t.Fatal(err)
	}
}
