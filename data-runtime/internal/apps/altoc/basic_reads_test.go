package altoc

import (
	"context"
	"database/sql/driver"
	"github.com/DATA-DOG/go-sqlmock"
	"regexp"
	"strings"
	"testing"
)

func basicReaderFixture(t *testing.T) *BasicReader {
	t.Helper()
	tables := map[string]string{}
	for _, name := range BasicReadTables {
		tables[name] = "altoc_" + name
	}
	r, err := NewBasicReader(tables)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestBasicReaderCountAndPageUseSameDynamicScope(t *testing.T) {
	for _, resource := range []string{"customer", "contract", "receivable"} {
		t.Run(resource, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tx, err := db.Begin()
			if err != nil {
				t.Fatal(err)
			}
			alias, table, name := "cu", "customer", "name"
			if resource == "contract" {
				alias, table = "ct", "contract"
			}
			if resource == "receivable" {
				alias, table, name = "rp", "receivable_plan", "plan_name"
			}
			predicate := "(" + alias + ".owner_user_id = ? OR " + alias + ".owner_dept_code IN (?))"
			args := []driver.Value{"actor", "D1", "%needle%", "%needle%", "active"}
			from := " FROM `altoc_" + table + "` " + alias
			if resource == "receivable" {
				from += " LEFT JOIN `altoc_contract` ct ON ct.id=rp.contract_id AND ct.deleted_at IS NULL"
				predicate = "(rp.owner_user_id = ? OR rp.collection_responsible_uid = ? OR ct.owner_user_id = ? OR ct.owner_dept_code IN (?))"
				args = []driver.Value{"actor", "actor", "actor", "D1", "%needle%", "%needle%", "active"}
			}
			suffix := from + " WHERE " + predicate + " AND " + alias + ".deleted_at IS NULL AND (" + alias + ".code LIKE ? OR " + alias + "." + name + " LIKE ?) AND " + alias + ".status = ?"
			mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*)" + suffix)).WithArgs(args...).WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(25))
			mock.ExpectQuery("SELECT .*" + regexp.QuoteMeta(suffix+" ORDER BY "+alias+".id DESC LIMIT ? OFFSET ?")).WithArgs(append(args, 10, 10)...).WillReturnRows(sqlmock.NewRows([]string{"id", "code", name}).AddRow(12, "CODE", "needle"))
			out, err := basicReaderFixture(t).ReadInTransaction(context.Background(), tx, resource, "", "actor", BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, BasicReadQuery{Page: 2, PageSize: 10, Search: "needle", Status: "active"})
			if err != nil {
				t.Fatal(err)
			}
			if out["total"] != int64(25) || out["page"] != 2 {
				t.Fatalf("wrong page %#v", out)
			}
			mock.ExpectRollback()
			_ = tx.Rollback()
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
func TestBasicScopeFailsBeforeQuery(t *testing.T) {
	for _, scope := range []BasicReadScope{{Access: "bogus"}, {Access: "self", DepartmentCodes: []string{"D1"}}, {Access: "dept"}, {Access: "dept", DepartmentCodes: []string{"D1", "D1"}}, {Access: "dept", DepartmentCodes: []string{"D1,D2"}}, {Access: "none"}} {
		db, mock, _ := sqlmock.New()
		mock.ExpectBegin()
		tx, _ := db.Begin()
		_, err := basicReaderFixture(t).ReadInTransaction(context.Background(), tx, "customer", "", "actor", scope, BasicReadQuery{Page: 1, PageSize: 10})
		if err == nil {
			t.Fatal("invalid scope accepted")
		}
		mock.ExpectRollback()
		_ = tx.Rollback()
		if err = mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}
func TestBasicReaderProjectionHasNoEnrichedOrSecretColumns(t *testing.T) {
	for _, columns := range basicReadColumns {
		for _, column := range columns {
			for _, forbidden := range []string{"scan", "invoice", "received_amount", "stats", "error", "json", "bank", "secret"} {
				if strings.Contains(column, forbidden) {
					t.Fatalf("unsafe column %s", column)
				}
			}
		}
	}
	tables := map[string]string{}
	for _, name := range BasicReadTables {
		tables[name] = "altoc_" + name
	}
	tables["customer"] = "customer; DROP TABLE contract"
	if _, err := NewBasicReader(tables); err == nil {
		t.Fatal("untrusted mapping accepted")
	}
}
func TestBasicQueryRejectsInvalidIDsAndBounds(t *testing.T) {
	for _, q := range []BasicReadQuery{{Page: 0, PageSize: 10}, {Page: 1, PageSize: 101}, {Page: 1, PageSize: 10, CustomerID: "01"}, {Page: 1, PageSize: 10, ContractID: "1"}} {
		if q.Validate("customer") == nil {
			t.Fatal("bad query accepted")
		}
	}
}
