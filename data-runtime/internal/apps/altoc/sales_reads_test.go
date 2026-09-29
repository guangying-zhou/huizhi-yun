package altoc

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"regexp"
	"strings"
	"testing"
)

func salesReaderFixture(t *testing.T) *SalesReader {
	t.Helper()
	tables := map[string]string{}
	for _, name := range SalesReadTables {
		tables[name] = "altoc_" + name
	}
	r, err := NewSalesReader(tables)
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestSalesQueryFailsBeforeBusinessSQL(t *testing.T) {
	for _, test := range []struct {
		resource string
		scope    BasicReadScope
		q        SalesReadQuery
		id       string
	}{
		{"lead", BasicReadScope{Access: "all"}, SalesReadQuery{Page: 1, PageSize: 10, CustomerID: "1"}, ""},
		{"opportunity", BasicReadScope{Access: "all"}, SalesReadQuery{Page: 1, PageSize: 10, OpportunityID: "1"}, ""},
		{"quotation", BasicReadScope{Access: "all"}, SalesReadQuery{Page: 1, PageSize: 10, OpportunityID: "01"}, ""},
		{"quotation", BasicReadScope{Access: "all"}, SalesReadQuery{Page: 1, PageSize: 10, OpportunityID: "9007199254740992"}, ""},
		{"lead", BasicReadScope{Access: "self"}, SalesReadQuery{Page: 1, PageSize: 10}, "9007199254740992"},
		{"lead", BasicReadScope{Access: "none"}, SalesReadQuery{Page: 1, PageSize: 10}, ""},
		{"lead", BasicReadScope{Access: "unknown"}, SalesReadQuery{Page: 1, PageSize: 10}, ""},
		{"lead", BasicReadScope{Access: "self"}, SalesReadQuery{Page: 1, PageSize: 10, Search: strings.Repeat("中", 67)}, ""},
	} {
		db, m, _ := sqlmock.New()
		m.ExpectBegin()
		tx, _ := db.Begin()
		if _, e := salesReaderFixture(t).ReadInTransaction(context.Background(), tx, test.resource, test.id, "actor", test.scope, test.q); e == nil {
			t.Fatal("invalid request accepted")
		}
		m.ExpectRollback()
		tx.Rollback()
		if e := m.ExpectationsWereMet(); e != nil {
			t.Fatal(e)
		}
		db.Close()
	}
}
func TestSalesProjectionAndMappingAreClosed(t *testing.T) {
	for _, cols := range salesReadColumns {
		for _, col := range cols {
			for _, secret := range []string{"contact_", "reason", "remark", "url", "json", "cost_price", "gross_margin"} {
				if strings.Contains(col, secret) {
					t.Fatal("unsafe field " + col)
				}
			}
		}
	}
	tables := map[string]string{}
	for _, name := range SalesReadTables {
		tables[name] = "altoc_" + name
	}
	tables["lead"] = "lead;DROP TABLE customer"
	if _, e := NewSalesReader(tables); e == nil {
		t.Fatal("unsafe mapping")
	}
	delete(tables, "lead")
	if _, e := NewSalesReader(tables); e == nil {
		t.Fatal("missing mapping")
	}
}
func TestSalesOpportunityPipelineCountAndPageSameWhere(t *testing.T) {
	for _, modern := range []bool{true, false} {
		db, m, _ := sqlmock.New()
		m.ExpectBegin()
		tx, _ := db.Begin()
		rows := sqlmock.NewRows([]string{"COLUMN_NAME"}).AddRow("id")
		if modern {
			rows.AddRow("pipeline_code")
		}
		m.ExpectQuery("SELECT COLUMN_NAME").WithArgs("altoc_opportunity_stage").WillReturnRows(rows)
		suffix := " FROM `altoc_opportunity` s LEFT JOIN `altoc_opportunity_stage` os ON os.id=s.stage_id WHERE (s.owner_user_id = ? OR s.owner_dept_code IN (?)) AND s.deleted_at IS NULL"
		if modern {
			suffix += " AND os.pipeline_code = ?"
		}
		count := m.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*)" + suffix))
		page := m.ExpectQuery("SELECT .*" + regexp.QuoteMeta(suffix+" ORDER BY s.updated_at DESC,s.id DESC LIMIT ? OFFSET ?"))
		if modern {
			count.WithArgs("actor", "D1", "default")
			page.WithArgs("actor", "D1", "default", 10, 10)
		} else {
			count.WithArgs("actor", "D1")
			page.WithArgs("actor", "D1", 10, 10)
		}
		count.WillReturnRows(sqlmock.NewRows([]string{"total"}).AddRow(25))
		page.WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
		out, e := salesReaderFixture(t).ReadInTransaction(context.Background(), tx, "opportunity", "", "actor", BasicReadScope{Access: "dept", DepartmentCodes: []string{"D1"}}, SalesReadQuery{Page: 2, PageSize: 10})
		if e != nil || out["total"] != int64(25) {
			t.Fatalf("drift %v %#v", e, out)
		}
		m.ExpectRollback()
		tx.Rollback()
		if e = m.ExpectationsWereMet(); e != nil {
			t.Fatal(e)
		}
		db.Close()
	}
}
