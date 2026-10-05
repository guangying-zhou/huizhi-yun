package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

func TestEmptyAimsProjectCreatesFirstWorkItemMySQL(t *testing.T) {
	socket := os.Getenv("HZY_PROJECT_MEMBER_SOCKET")
	if socket == "" {
		t.Skip("isolated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	mc := mysql.NewConfig()
	mc.User, mc.Net, mc.Addr, mc.ParseTime = "root", "unix", socket, true
	root, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	database := "hzy_counter_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := root.Exec("CREATE DATABASE " + database); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + database)
	mc.DBName = database
	db, err := sql.Open("mysql", mc.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	source, err := os.ReadFile("../../../../aims/docs/aims_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec("SET FOREIGN_KEY_CHECKS=0"); err != nil {
		t.Fatal(err)
	}
	for _, ddl := range regexp.MustCompile("(?ms)^CREATE TABLE IF NOT EXISTS `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		if _, err := db.Exec(ddl[0]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec("SET FOREIGN_KEY_CHECKS=1"); err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(8)
	var projects, counters int
	if err := db.QueryRow("SELECT COUNT(*) FROM aims_projects").Scan(&projects); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM project_counters").Scan(&counters); err != nil {
		t.Fatal(err)
	}
	if projects != 0 || counters != 0 {
		t.Fatalf("database was not empty: projects=%d counters=%d", projects, counters)
	}
	var port int
	if err := root.QueryRow("SELECT @@port").Scan(&port); err != nil {
		t.Fatal(err)
	}
	user := "hzy_counter"
	secret := uuid.NewString()
	if _, err := root.Exec(fmt.Sprintf("CREATE USER '%s'@'127.0.0.1' IDENTIFIED BY '%s'", user, secret)); err != nil {
		t.Fatal(err)
	}
	defer root.Exec(fmt.Sprintf("DROP USER '%s'@'127.0.0.1'", user))
	if _, err := root.Exec("GRANT ALL ON " + database + ".* TO '" + user + "'@'127.0.0.1'"); err != nil {
		t.Fatal(err)
	}
	a, err := New(config.AimsConfig{DB: config.DBConfig{Host: "127.0.0.1", Port: port, User: user, Password: secret, Database: database}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.DB().Close()
	ctx := context.Background()
	query := url.Values{"current_user": {"U1"}}
	project, err := a.createProjectWithProductBinding(ctx, query, map[string]any{
		"projectCode": "FRESH-COUNTER", "name": "Fresh project", "shortName": "Fresh", "leaderUid": "U1", "category": "routine",
	})
	if err != nil {
		t.Fatal("create first project", err)
	}
	projectID := fmt.Sprint(project["id"])
	var counter int
	if err := db.QueryRow("SELECT counter FROM project_counters WHERE project_id=?", projectID).Scan(&counter); err != nil {
		t.Fatal("project counter did not commit with project", err)
	}
	item, err := a.createProjectWorkItem(ctx, projectID, query, map[string]any{"title": "First work item", "type": "task"})
	if err != nil {
		t.Fatal("create first work item", err)
	}
	if fmt.Sprint(item["itemNumber"]) != "1" {
		t.Fatalf("first item number = %v, initial counter = %d", item["itemNumber"], counter)
	}
	if err := db.QueryRow("SELECT counter FROM project_counters WHERE project_id=?", projectID).Scan(&counter); err != nil {
		t.Fatal(err)
	}
	if counter != 1 {
		t.Fatalf("counter after first work item = %d", counter)
	}
}
