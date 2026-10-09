package enterpriseapf

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestAPFW3CustomerHierarchyAndPrimaryContactMySQL(t *testing.T) {
	for _, installed := range []bool{true, false} {
		t.Run(fmt.Sprint("installed=", installed), func(t *testing.T) {
			s, db := customerFixture(t)
			ctx := context.Background()
			if !installed {
				// The fixture creates tables from the fresh DDL only; the deferred FK is not present.
				for _, q := range []string{"ALTER TABLE altoc_customer DROP INDEX idx_altoc_customer_primary_contact", "ALTER TABLE altoc_customer DROP COLUMN primary_contact_id, DROP COLUMN contact_name_text, DROP COLUMN sort_no", "ALTER TABLE altoc_contact DROP COLUMN star_level"} {
					if _, e := db.Exec(q); e != nil {
						t.Fatal(q, e)
					}
				}
			}
			for _, q := range []string{
				"INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES(1,'C1','root','person',NULL),(2,'C2','child','person',1),(3,'C3','grandchild','person',2),(4,'C4','other','person',NULL),(5,'C5','foreign','stranger',NULL)",
				"INSERT INTO altoc_contact(id,code,customer_id,name,owner_uid) VALUES(11,'CN11',1,'own contact','person'),(12,'CN12',4,'other contact','person')",
			} {
				if _, e := db.Exec(q); e != nil {
					t.Fatal(e)
				}
			}
			scope := altoc.BasicReadScope{Access: "self"}
			n := 0
			call := func(op, customer, child string, payload map[string]any) (map[string]any, error) {
				n++
				who := Identity{Actor: "person", Tenant: "C000001", Deployment: "host-test", Client: "enterprise.runtime", Key: fmt.Sprint("h-", n), RequestID: "isolated"}
				v, e := s.Customer(ctx, op, CustomerInput{CustomerID: customer, ChildCode: child, Payload: payload}, who, scope)
				if e != nil {
					return nil, e
				}
				return v.(map[string]any)["data"].(map[string]any), nil
			}
			refused := func(e error, status int, code string) {
				t.Helper()
				var he httperror.Error
				if !errors.As(e, &he) || he.Status != status || he.Code != code {
					t.Fatal("expected", status, code, "got", e)
				}
			}
			version := func(table string, id int) float64 {
				t.Helper()
				var v int
				if e := db.QueryRow("SELECT row_version FROM "+table+" WHERE id=?", id).Scan(&v); e != nil {
					t.Fatal(e)
				}
				return float64(v)
			}

			// Hierarchy uses a base column and works in both states.
			_, e := call("customers-set-parent", "1", "", map[string]any{"expectedVersion": version("altoc_customer", 1), "parent_customer_id": "1"})
			refused(e, 409, "altoc_customer_hierarchy_invalid")
			_, e = call("customers-set-parent", "1", "", map[string]any{"expectedVersion": version("altoc_customer", 1), "parent_customer_id": "3"})
			refused(e, 409, "altoc_customer_hierarchy_invalid")
			_, e = call("customers-set-parent", "4", "", map[string]any{"expectedVersion": version("altoc_customer", 4), "parent_customer_id": "5"})
			refused(e, 403, "altoc_customer_scope_denied")
			_, e = call("customers-set-parent", "4", "", map[string]any{"expectedVersion": version("altoc_customer", 4), "parent_customer_id": "404"})
			refused(e, 403, "altoc_customer_scope_denied")
			out, e := call("customers-set-parent", "4", "", map[string]any{"expectedVersion": version("altoc_customer", 4), "parent_customer_id": "3"})
			if e != nil || fmt.Sprint(out["parent_customer_id"]) != "3" {
				t.Fatal("set parent", out, e)
			}
			if out, e = call("customers-set-parent", "4", "", map[string]any{"expectedVersion": version("altoc_customer", 4), "parent_customer_id": nil}); e != nil || out["parent_customer_id"] != nil {
				t.Fatal("clear parent", out, e)
			}
			// Depth: a chain of ten above is the limit, counting what hangs below.
			for id := 100; id < 108; id++ {
				parent := id - 1
				if id == 100 {
					parent = 3
				}
				if _, e = db.Exec("INSERT INTO altoc_customer(id,code,name,owner_uid,parent_customer_id) VALUES(?,?,?,'person',?)", id, fmt.Sprint("D", id), "deep", parent); e != nil {
					t.Fatal(e)
				}
			}
			_, e = call("customers-set-parent", "4", "", map[string]any{"expectedVersion": version("altoc_customer", 4), "parent_customer_id": "107"})
			refused(e, 409, "altoc_customer_hierarchy_invalid")
			for name, payload := range map[string]map[string]any{"extra field": {"expectedVersion": float64(1), "parent_customer_id": "1", "name": "x"}, "wrong key": {"expectedVersion": float64(1), "primary_contact_id": "11"}, "numeric id": {"expectedVersion": float64(1), "parent_customer_id": float64(1)}, "missing": {"expectedVersion": float64(1)}} {
				if _, e = call("customers-set-parent", "4", "", payload); e == nil {
					t.Fatal(name)
				}
			}

			if !installed {
				// Without the W1 columns: the two new writes are unavailable, everything else is as before.
				_, e = call("customers-set-primary-contact", "1", "", map[string]any{"expectedVersion": version("altoc_customer", 1), "primary_contact_id": "11"})
				refused(e, 409, "altoc_customer_fields_unavailable")
				_, e = call("contacts-update", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11), "star_level": float64(3)})
				refused(e, 409, "altoc_customer_fields_unavailable")
				if out, e = call("contacts-update", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11), "job_title": "manager"}); e != nil || out["job_title"] != "manager" {
					t.Fatal("existing contact update", out, e)
				}
				if _, ok := out["star_level"]; ok {
					t.Fatal("uninstalled column returned")
				}
				if _, e = call("contacts-delete", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11)}); e != nil {
					t.Fatal("contact delete", e)
				}
				return
			}

			// Primary contact: one of the customer's own contacts.
			_, e = call("customers-set-primary-contact", "1", "", map[string]any{"expectedVersion": version("altoc_customer", 1), "primary_contact_id": "12"})
			refused(e, 409, "altoc_primary_contact_invalid")
			if out, e = call("customers-set-primary-contact", "1", "", map[string]any{"expectedVersion": version("altoc_customer", 1), "primary_contact_id": "11"}); e != nil || fmt.Sprint(out["primary_contact_id"]) != "11" {
				t.Fatal("set primary", out, e)
			}
			// It cannot be deleted while it is the primary contact.
			_, e = call("contacts-delete", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11)})
			refused(e, 409, "altoc_contact_is_primary")
			// Star level: 1..6 or cleared.
			if out, e = call("contacts-update", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11), "star_level": float64(6)}); e != nil || fmt.Sprint(out["star_level"]) != "6" || fmt.Sprint(out["is_key_contact"]) != "0" {
				t.Fatal("star level", out, e)
			}
			for _, bad := range []any{float64(0), float64(7), float64(2.5), "3"} {
				if _, e = call("contacts-update", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11), "star_level": bad}); e == nil {
					t.Fatal("star level accepted", bad)
				}
			}
			if out, e = call("contacts-update", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11), "star_level": nil}); e != nil || out["star_level"] != nil {
				t.Fatal("clear star level", out, e)
			}
			if out, e = call("customers-set-primary-contact", "1", "", map[string]any{"expectedVersion": version("altoc_customer", 1), "primary_contact_id": nil}); e != nil || out["primary_contact_id"] != nil {
				t.Fatal("clear primary", out, e)
			}
			if _, e = call("contacts-delete", "1", "CN11", map[string]any{"expectedVersion": version("altoc_contact", 11)}); e != nil {
				t.Fatal("delete after clearing", e)
			}
			// Detail read carries the hierarchy and W1 fields.
			detail, e := s.CustomerRead(ctx, "2", "person", scope, altoc.BasicReadQuery{Page: 1, PageSize: 20})
			if e != nil || fmt.Sprint(detail.(map[string]any)["parent_customer_id"]) != "1" {
				t.Fatal("detail", detail, e)
			}
			if _, ok := detail.(map[string]any)["sort_no"]; !ok {
				t.Fatal("installed column missing from detail")
			}
		})
	}
}
