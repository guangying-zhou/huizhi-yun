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

func TestSalesReadsIsolatedMySQL(t *testing.T) {
	socket := os.Getenv("HZY_ALTOC_SALES_SOCKET")
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
	name := "hzy_sales_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	for _, table := range SalesReadTables {
		needed[table] = true
		tables[table] = "altoc_" + table
	}
	exec("SET FOREIGN_KEY_CHECKS=0")
	for _, part := range regexp.MustCompile("(?ms)^CREATE TABLE(?: IF NOT EXISTS)? `?([A-Za-z0-9_]+)`? \\(.*?^\\) ENGINE=.*?;").FindAllStringSubmatch(string(source), -1) {
		if needed[part[1]] {
			q := regexp.MustCompile("^CREATE TABLE `?"+part[1]+"`?").ReplaceAllString(part[0], "CREATE TABLE altoc_"+part[1])
			for logical, physical := range tables {
				q = strings.ReplaceAll(q, "REFERENCES "+logical+"(", "REFERENCES "+physical+"(")
			}
			exec(q)
		}
	}

	exec("INSERT INTO altoc_opportunity_stage(id,code,name,pipeline_code) VALUES(1,'default-stage','Default','default'),(2,'solution-stage','Solution','solution')")
	exec("INSERT INTO altoc_lead(id,code,name,owner_user_id,owner_dept_code,contact_email) VALUES(1,'LE1','Needle','actor','D1','secret@example.test'),(2,'LE2','Hidden','other','D2',NULL),(3,'LE3','Department','other','D1',NULL),(4,'LE4','Outside','actor','D2',NULL)")
	exec("INSERT INTO altoc_opportunity(id,code,name,customer_id,stage_id,owner_user_id,owner_dept_code) VALUES(1,'OP1','Needle',999,1,'actor','D1'),(2,'OP2','Hidden',999,1,'other','D2'),(3,'OP3','Department',999,1,'other','D1'),(4,'OP4','Outside',999,1,'actor','D2'),(5,'OP5','Other pipeline',999,2,'actor','D1')")
	exec("INSERT INTO altoc_quotation(id,code,quotation_no,customer_id,opportunity_id,owner_user_id,owner_dept_code,gross_margin_rate) VALUES(1,'QU1','Needle',999,2,'actor','D1',99),(2,'QU2','Hidden',999,1,'other','D2',99),(3,'QU3','Department',999,1,'other','D1',99),(4,'QU4','Outside',999,1,'actor','D2',99)")
	exec("INSERT INTO altoc_quotation_item(id,quotation_id,item_name,cost_price) VALUES(1,1,'Safe item',999),(2,2,'Hidden item',999)")
	// Missing customer/Finance/contact/activity tables prove the read closure.
	// Fixtures use root; the actual owning reader has only SELECT authority.
	username := "sales_" + strings.ReplaceAll(uuid.NewString(), "-", "")[:20]
	exec("CREATE USER '" + username + "'@'localhost'")
	defer root.Exec("DROP USER '" + username + "'@'localhost'")
	exec("GRANT SELECT ON " + name + ".* TO '" + username + "'@'localhost'")
	cfg.User = username
	readonly, err := sql.Open("mysql", cfg.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	defer readonly.Close()
	if _, e := readonly.Exec("UPDATE altoc_lead SET name='forbidden' WHERE id=1"); e == nil {
		t.Fatal("business reader unexpectedly has Write authority")
	}
	r, err := NewSalesReader(tables)
	if err != nil {
		t.Fatal(err)
	}
	read := func(resource, id string, scope BasicReadScope, q SalesReadQuery) (map[string]any, error) {
		t.Helper()
		tx, e := readonly.BeginTx(context.Background(), &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
		if e != nil {
			t.Fatal(e)
		}
		defer tx.Rollback()
		return r.ReadInTransaction(context.Background(), tx, resource, id, "actor", scope, q)
	}
	q := SalesReadQuery{Page: 1, PageSize: 1}
	for _, resource := range []string{"lead", "opportunity", "quotation"} {
		t.Run(resource, func(t *testing.T) {
			for _, test := range []struct {
				scope BasicReadScope
				total int64
			}{
				{BasicReadScope{Access: "all"}, 4}, {BasicReadScope{Access: "self"}, 2}, {BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, 3}, {BasicReadScope{Access: "self_dept", DepartmentCodes: []string{"D1"}}, 1},
			} {
				out, e := read(resource, "", test.scope, q)
				if e != nil {
					t.Fatal(e)
				}
				if out["total"] != test.total || len(out["items"].([]map[string]any)) != 1 {
					t.Fatalf("scope/count drift %#v", out)
				}
			}
			for _, scope := range []BasicReadScope{{Access: "none"}, {Access: "unknown"}, {Access: "dept"}} {
				if _, e := read(resource, "", scope, q); e == nil {
					t.Fatal("invalid scope accepted")
				}
			}
			if _, e := read(resource, "2", BasicReadScope{Access: "self"}, q); e == nil {
				t.Fatal("linked owner inherited")
			}
			out, e := read(resource, "1", BasicReadScope{Access: "self"}, q)
			if e != nil {
				t.Fatal(e)
			}
			for _, key := range []string{"contact_email", "contact_mobile", "activities", "contact_roles", "quotations", "customer_name", "opportunity_name", "gross_margin_rate", "stage_logs"} {
				if _, ok := out[key]; ok {
					t.Fatalf("unsafe field %s", key)
				}
			}
			filtered := q
			filtered.Search = "Needle"
			out, e = read(resource, "", BasicReadScope{Access: "all"}, filtered)
			if e != nil || out["total"] != int64(1) {
				t.Fatalf("filtered count %#v %v", out, e)
			}
			page2 := q
			page2.Page = 2
			out, e = read(resource, "", BasicReadScope{Access: "all"}, page2)
			if e != nil || out["total"] != int64(4) {
				t.Fatalf("page2 %#v %v", out, e)
			}
			table := tables[resource]
			exec("UPDATE " + table + " SET owner_user_id='other',owner_dept_code='D2' WHERE id=1")
			if _, e = read(resource, "1", BasicReadScope{Access: "self"}, q); e == nil {
				t.Fatal("stale owner authorized")
			}
			exec("UPDATE " + table + " SET owner_user_id='actor',owner_dept_code='D1' WHERE id=1")
			exec("UPDATE " + table + " SET owner_user_id='other',owner_dept_code='D2' WHERE id=3")
			if _, e = read(resource, "3", BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, q); e == nil {
				t.Fatal("stale department authorized")
			}
			exec("UPDATE " + table + " SET owner_user_id='other',owner_dept_code='D1' WHERE id=3")
		})
	}
	out, err := read("quotation", "1", BasicReadScope{Access: "self"}, q)
	if err != nil {
		t.Fatal(err)
	}
	items := out["items"].([]map[string]any)
	if len(items) != 1 || items[0]["item_name"] != "Safe item" {
		t.Fatalf("wrong parent items %#v", items)
	}
	if _, ok := items[0]["cost_price"]; ok {
		t.Fatal("cost exposed")
	}
	if _, err = read("opportunity", "5", BasicReadScope{Access: "self"}, q); err != nil {
		t.Fatalf("detail pipeline semantics changed %v", err)
	}
	customerFilter := q
	customerFilter.CustomerID = "123"
	out, err = read("quotation", "", BasicReadScope{Access: "all"}, customerFilter)
	if err != nil || out["total"] != int64(0) {
		t.Fatalf("customer filter %#v %v", out, err)
	}
	opportunityFilter := q
	opportunityFilter.OpportunityID = "2"
	out, err = read("quotation", "", BasicReadScope{Access: "all"}, opportunityFilter)
	if err != nil || out["total"] != int64(1) {
		t.Fatalf("opportunity filter %#v %v", out, err)
	}
	// Legacy stage schemas without pipeline_code intentionally include all stages.
	exec("ALTER TABLE altoc_opportunity_stage DROP INDEX idx_pipeline_sort,DROP COLUMN pipeline_code")
	out, err = read("opportunity", "", BasicReadScope{Access: "self"}, q)
	if err != nil || out["total"] != int64(3) {
		t.Fatalf("legacy pipeline %#v %v", out, err)
	}
	exec("UPDATE altoc_lead SET deleted_at=NOW() WHERE id=1")
	if _, err = read("lead", "1", BasicReadScope{Access: "all"}, q); err == nil {
		t.Fatal("soft deleted lead visible")
	}
	// Child overflow fails rather than silently truncating a valid detail.
	for i := 0; i < 1000; i++ {
		exec("INSERT INTO altoc_quotation_item(quotation_id,item_name) VALUES(1,'overflow')")
	}
	if _, err = read("quotation", "1", BasicReadScope{Access: "self"}, q); err == nil {
		t.Fatal("overflow silently truncated")
	}
}
