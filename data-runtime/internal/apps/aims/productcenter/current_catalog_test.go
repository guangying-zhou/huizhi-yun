package productcenter

import "testing"

func TestCurrentCatalogSourceRejectsUntrustedSQLAndInvalidScope(t *testing.T) {
	for _, name := range []string{"products", "`schema`.`products`", "`products` WHERE 1=1", "`products;DROP`", ""} {
		if _, err := NewCurrentCatalogSource(name, "`groups`", "reader", 1, true, nil); err == nil {
			t.Fatal("arbitrary SQL/table path accepted", name)
		}
	}
	for _, codes := range [][]string{{"A", "A"}, {" A"}, {""}} {
		if _, err := NewCurrentCatalogSource("`products`", "`groups`", "reader", 1, false, codes); err == nil {
			t.Fatal("invalid scope accepted", codes)
		}
	}
	if _, err := NewCurrentCatalogSource("`products`", "`groups`", "reader", 1, true, []string{"A"}); err == nil {
		t.Fatal("ambiguous global grant accepted")
	}
	if _, err := NewCurrentCatalogSource("`products`", "`groups`", "reader", 1, false, nil); err != nil {
		t.Fatal("empty scope must be a valid denial", err)
	}
}
