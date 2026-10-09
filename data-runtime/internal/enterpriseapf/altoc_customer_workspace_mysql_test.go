package enterpriseapf

import (
	"context"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"testing"
)

func TestAPFCustomerWorkspaceMySQL(t *testing.T) {
	for _, installed := range []bool{false, true} {
		t.Run(fmt.Sprint(installed), func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			// These ALTERs affect only the fresh random fixture database, never hzy0.
			for _, f := range []struct{ table, column, definition string }{{"altoc_customer", "primary_contact_id", "BIGINT NULL"}, {"altoc_contact", "star_level", "INT NULL"}} {
				var count int
				if e := db.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?", f.table, f.column).Scan(&count); e != nil {
					t.Fatal(e)
				}
				if installed && count == 0 {
					w3Exec(t, db, "ALTER TABLE "+f.table+" ADD "+f.column+" "+f.definition)
				}
				if !installed && count > 0 {
					w3Exec(t, db, "ALTER TABLE "+f.table+" DROP "+f.column)
				}
			}
			w3Exec(t, db, "INSERT INTO altoc_customer(id,code,name,owner_uid,industry_code,region_code,updated_at) VALUES(1,'CU1','Visible','person','IT','SD','2026-01-01 16:00:00'),(2,'CU2','HIDDEN','other','IT','SD','2026-01-02 15:59:59'),(3,'CU3','Older','person','OTHER','JS','2025-12-31 16:00:00')")
			for n := 1; n <= 23; n++ {
				if _, e := db.Exec("INSERT INTO altoc_contact(id,code,customer_id,name,job_title,decision_role,status) VALUES(?, ?,1,?,'Manager','buyer','active')", n, fmt.Sprintf("CN%d", n), fmt.Sprintf("Contact %02d", n)); e != nil {
					t.Fatal(e)
				}
			}
			w3Exec(t, db, "INSERT INTO altoc_contact(id,code,customer_id,name,status) VALUES(30,'CN30',2,'PRIVATE-CONTACT','active')")
			if installed {
				w3Exec(t, db, "UPDATE altoc_customer SET primary_contact_id=23,updated_at=updated_at WHERE id=1", "UPDATE altoc_contact SET star_level=5 WHERE id=22")
			}
			read := func(id string, q altoc.BasicReadQuery) map[string]any {
				t.Helper()
				v, e := s.CustomerRead(ctx, id, "person", altoc.BasicReadScope{Access: "self"}, q)
				if e != nil {
					t.Fatal(q, e)
				}
				return v.(map[string]any)
			}
			q := altoc.BasicReadQuery{Page: 1, PageSize: 20, OwnerUID: "person", IndustryCode: "IT", RegionCode: "SD", UpdatedDateFrom: "2026-01-02", UpdatedDateTo: "2026-01-02", CustomerSort: "updated_desc"}
			out := read("", q)
			if fmt.Sprint(out["total"]) != "1" {
				t.Fatal(out)
			}
			item := out["items"].([]map[string]any)[0]
			if fmt.Sprint(item["id"]) != "1" {
				t.Fatal(item)
			}
			if _, present := item["primary_contact_name"]; present != installed {
				t.Fatal("primary projection compatibility", item)
			}
			list := read("", altoc.BasicReadQuery{Page: 1, PageSize: 1, CustomerSort: "updated_desc"})
			if fmt.Sprint(list["total"]) != "2" || fmt.Sprint(list["items"].([]map[string]any)[0]["id"]) != "1" {
				t.Fatal(list)
			}
			detail := read("1", altoc.BasicReadQuery{Page: 1, PageSize: 20, Workspace: true})
			if len(detail["contacts"].([]map[string]any)) != 0 {
				t.Fatal("workspace fetched full contact collection")
			}
			contacts := altoc.BasicReadQuery{Page: 1, PageSize: 20, ContactsOnly: true}
			first := read("1", contacts)
			if fmt.Sprint(first["total"]) != "23" || len(first["items"].([]map[string]any)) != 20 {
				t.Fatal(first)
			}
			if installed {
				items := first["items"].([]map[string]any)
				if fmt.Sprint(items[0]["id"]) != "23" || fmt.Sprint(items[1]["id"]) != "22" {
					t.Fatal("primary/star order", items[:2])
				}
			}
			contacts.Page = 2
			second := read("1", contacts)
			if fmt.Sprint(second["total"]) != "23" || len(second["items"].([]map[string]any)) != 3 {
				t.Fatal(second)
			}
			contacts.Search = "Contact 02"
			contacts.Page = 1
			filtered := read("1", contacts)
			if fmt.Sprint(filtered["total"]) != "1" {
				t.Fatal(filtered)
			}
			contacts.Search = ""
			contacts.DecisionRole = "none"
			if fmt.Sprint(read("1", contacts)["total"]) != "0" {
				t.Fatal("role filter ignored")
			}
			contacts.DecisionRole = ""
			contacts.PrimaryOnly = true
			_, e := s.CustomerRead(ctx, "1", "person", altoc.BasicReadScope{Access: "self"}, contacts)
			if installed && e != nil {
				t.Fatal(e)
			}
			if !installed && e == nil {
				t.Fatal("uninstalled primary filter silently ignored")
			}
			contacts.PrimaryOnly = false
			contacts.StarredOnly = true
			_, e = s.CustomerRead(ctx, "1", "person", altoc.BasicReadScope{Access: "self"}, contacts)
			if installed && e != nil {
				t.Fatal(e)
			}
			if !installed && e == nil {
				t.Fatal("uninstalled star filter ignored")
			}
			contacts.StarredOnly = false
			if _, e = s.CustomerRead(ctx, "2", "person", altoc.BasicReadScope{Access: "self"}, contacts); e == nil {
				t.Fatal("hidden customer contact count leaked")
			}
		})
	}
}
