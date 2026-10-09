package aims

import (
	"net/url"
	"reflect"
	"strings"
	"testing"
)

func TestProductHandoffProjectFilterComposesWithProjectFilters(t *testing.T) {
	query := url.Values{"product_code": {"P-'?"}, "category": {"product_dev"}, "lifecycle_status": {"active"}, "search": {"身份"}}
	where, args := memberProjectsWhere(query, "pm")
	sql := strings.Join(where, " AND ")
	if !strings.Contains(sql, "EXISTS (SELECT 1 FROM aims_project_products hpp WHERE hpp.project_id = p.id AND BINARY hpp.product_code = ?)") || strings.Contains(sql, "P-'?") {
		t.Fatalf("product binding must be parameterized: %s", sql)
	}
	if len(args) < 3 || !reflect.DeepEqual(args[:3], []any{"P-'?", "product_dev", "active"}) {
		t.Fatalf("combined args: %#v", args)
	}
	if !strings.Contains(sql, "p.category = ?") || !strings.Contains(sql, "p.lifecycle_status = ?") {
		t.Fatalf("missing project filters: %s", sql)
	}
	without, _ := memberProjectsWhere(url.Values{}, "pm")
	if strings.Contains(strings.Join(without, " "), "aims_project_products") {
		t.Fatal("unfiltered project listing changed")
	}
}
