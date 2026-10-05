package altoc

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestBasicReadsIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ALTOC_BASIC_SOCKET")
	if socket == "" {
		t.Skip("dedicated MySQL required")
	}
	if !strings.HasPrefix(filepath.Clean(socket), "/tmp/hzy-test-mysql-") || filepath.Base(socket) != "mysql.sock" {
		t.Fatal("unsafe socket")
	}
	cfg := mysql.NewConfig()
	cfg.User = "root"
	cfg.Net = "unix"
	cfg.Addr = socket
	cfg.ParseTime = true
	root, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	name := "hzy_basic_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = root.Exec("CREATE DATABASE " + name); err != nil {
		t.Fatal(err)
	}
	defer root.Exec("DROP DATABASE " + name)
	cfg.DBName = name
	db, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	exec := func(q string) {
		t.Helper()
		if _, err := db.Exec(q); err != nil {
			t.Fatalf("fixture SQL: %v", err)
		}
	}
	source, err := os.ReadFile("../../../../altoc/docs/altoc_schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	tables := map[string]string{}
	needed := map[string]bool{}
	for _, table := range BasicReadTables {
		needed[table] = true
		tables[table] = "altoc_" + table
	}
	exec("SET FOREIGN_KEY_CHECKS=0")
	for _, part := range regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		if needed[part[1]] {
			q := strings.Replace(part[0], "CREATE TABLE "+part[1], "CREATE TABLE altoc_"+part[1], 1)
			for logical, physical := range tables {
				q = strings.ReplaceAll(q, "REFERENCES "+logical+"(", "REFERENCES "+physical+"(")
			}
			exec(q)
		}
	}
	exec("SET FOREIGN_KEY_CHECKS=1")
	for _, q := range []string{
		"INSERT INTO altoc_customer(id,code,name,owner_user_id,owner_dept_code) VALUES(1,'CU1','Visible','actor','D1'),(2,'CU2','Hidden','other','D2'),(3,'CU3','Department','other','D1')",
		"INSERT INTO altoc_contract(id,code,name,customer_id,owner_user_id,owner_dept_code) VALUES(1,'CT1','Contract',1,'actor','D1'),(2,'CT2','Hidden contract',2,'other','D2')",
		"INSERT INTO altoc_receivable_plan(id,code,contract_id,customer_id,plan_name,amount,owner_user_id,collection_responsible_uid) VALUES(1,'RP1',1,1,'Plan',10,'actor',NULL),(2,'RP2',2,2,'Collection plan',20,'other','actor'),(3,'RP3',2,2,'Hidden plan',30,'other',NULL)",
	} {
		exec(q)
	}
	r, err := NewBasicReader(tables)
	if err != nil {
		t.Fatal(err)
	}
	read := func(resource, id, actor string, scope BasicReadScope, q BasicReadQuery) (map[string]any, error) {
		tx, err := db.BeginTx(context.Background(), &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback()
		return r.ReadInTransaction(context.Background(), tx, resource, id, actor, scope, q)
	}
	q := BasicReadQuery{Page: 1, PageSize: 1}
	out, err := read("customer", "", "actor", BasicReadScope{Access: "self"}, q)
	if err != nil {
		t.Fatal(err)
	}
	if out["total"] != int64(1) {
		t.Fatalf("self total %#v", out)
	}
	out, err = read("customer", "", "actor", BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, q)
	if err != nil {
		t.Fatal(err)
	}
	if out["total"] != int64(2) || len(out["items"].([]map[string]any)) != 1 {
		t.Fatalf("COUNT/page drift %#v", out)
	}
	if _, err = read("customer", "2", "actor", BasicReadScope{Access: "self"}, q); err == nil {
		t.Fatal("hidden customer visible")
	}
	out, err = read("contract", "1", "actor", BasicReadScope{Access: "self"}, q)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := out["stats"]; ok {
		t.Fatal("Finance enriched contract")
	}
	for _, child := range basicContractChildren {
		if _, ok := out[child.key]; !ok {
			t.Fatal("missing safe child")
		}
	}
	out, err = read("receivable", "", "actor", BasicReadScope{Access: "self"}, q)
	if err != nil {
		t.Fatal(err)
	}
	if out["total"] != int64(2) {
		t.Fatalf("collection relation ignored %#v", out)
	}
	out, err = read("receivable", "2", "actor", BasicReadScope{Access: "self"}, q)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"customer_name", "contract_name", "invoices", "payments", "received_amount"} {
		if _, ok := out[field]; ok {
			t.Fatalf("unsafe field %s", field)
		}
	}
	if _, err = read("receivable", "3", "actor", BasicReadScope{Access: "self"}, q); err == nil {
		t.Fatal("hidden plan visible")
	}
}
