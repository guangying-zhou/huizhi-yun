package wizbiztool

import (
	"context"
	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"testing"
)

func TestRollbackCatalogCachesMetadataButRechecksReferencesAndSafety(t *testing.T) {
	db, m, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	child := &rollbackRow{seal: rowSeal{Table: "altoc_child"}, id: "77", safe: true}
	c := newRollbackReferenceChecker(map[string]*rollbackRow{"child": child})
	c.tables = []domaininstall.Table{{Physical: "altoc_child", Columns: []string{"id", "customer_id"}}}
	c.known["altoc_child"] = true
	target := &rollbackRow{seal: rowSeal{Table: "altoc_customer"}, id: "9", code: "CU-W000009", safe: true}
	m.ExpectQuery("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND TABLE_TYPE='BASE TABLE'").WithArgs("altoc_child").WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(1))
	q := "SELECT CAST(`id` AS CHAR) FROM `altoc_child` WHERE BINARY `customer_id`=BINARY ?"
	m.ExpectQuery(q).WithArgs("9").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("77"))
	for _, col := range []string{"customer_id", "parent_customer_id", "third_party_customer_id", "customer_code"} {
		m.ExpectQuery("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME=?").WithArgs(col).WillReturnRows(sqlmock.NewRows([]string{"TABLE_NAME"}))
	}
	if used, err := c.used(context.Background(), db, target); err != nil || used {
		t.Fatal("same-batch unchanged reference rejected")
	}
	child.safe = false
	m.ExpectQuery(q).WithArgs("9").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("77"))
	if used, err := c.used(context.Background(), db, target); err != nil || !used {
		t.Fatal("changed child did not retain parent")
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
func TestRollbackCatalogNeverCachesUnknownTableUsage(t *testing.T) {
	db, m, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	c := newRollbackReferenceChecker(nil)
	c.tables = nil
	c.unknown = map[string][]string{"customer_id": {"external_link"}, "parent_customer_id": {}, "third_party_customer_id": {}, "customer_code": {}}
	target := &rollbackRow{seal: rowSeal{Table: "altoc_customer"}, id: "9", code: "CU-W000009"}
	q := "SELECT COUNT(*) FROM `external_link` WHERE BINARY `customer_id`=BINARY ?"
	for _, n := range []int{0, 1} {
		m.ExpectQuery(q).WithArgs("9").WillReturnRows(sqlmock.NewRows([]string{"n"}).AddRow(n))
		used, err := c.used(context.Background(), db, target)
		if err != nil || used != (n == 1) {
			t.Fatal("unknown usage verdict cached or ignored")
		}
	}
	if err := m.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
