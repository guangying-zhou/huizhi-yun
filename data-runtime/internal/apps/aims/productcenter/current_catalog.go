package productcenter

import (
	"encoding/json"
	"regexp"
	"strings"
	"unicode/utf8"
)

// CurrentCatalogSource can only be built from a server-side validated Assets
// decision and registry table mapping. It is not a JSON/request data contract.
// No SQL fragment, schema, or predicate can be supplied by callers.
type CurrentCatalogSource struct {
	products, groups, actor, codes string
	expiresAt                      int64
	all                            bool
}

var currentCatalogTable = regexp.MustCompile("^`[A-Za-z_][A-Za-z0-9_]{0,63}`$")

func NewCurrentCatalogSource(productsTable, groupsTable, actor string, expiresAt int64, all bool, codes []string) (CurrentCatalogSource, error) {
	if !currentCatalogTable.MatchString(productsTable) || !currentCatalogTable.MatchString(groupsTable) || !validMemberUID(actor) || expiresAt <= 0 || len(codes) > 10000 || (all && len(codes) > 0) {
		return CurrentCatalogSource{}, invalid("product_authorization_invalid", "当前目录范围无效")
	}
	seen := map[string]bool{}
	for _, code := range codes {
		if code == "" || strings.TrimSpace(code) != code || !utf8.ValidString(code) || utf8.RuneCountInString(code) > 64 || seen[code] {
			return CurrentCatalogSource{}, invalid("product_authorization_invalid", "当前目录产品范围无效")
		}
		seen[code] = true
	}
	if codes == nil {
		codes = []string{}
	}
	encoded, err := json.Marshal(codes)
	if err != nil {
		return CurrentCatalogSource{}, err
	}
	return CurrentCatalogSource{products: productsTable, groups: groupsTable, actor: actor, expiresAt: expiresAt, all: all, codes: string(encoded)}, nil
}
func (s CurrentCatalogSource) cte() (string, []any) {
	predicate := "1=1"
	var args []any
	if !s.all {
		predicate = "EXISTS(SELECT 1 FROM JSON_TABLE(?, '$[*]' COLUMNS(product_code VARCHAR(64) PATH '$')) visible_asset WHERE BINARY visible_asset.product_code=BINARY p.product_code)"
		args = []any{s.codes}
	}
	return "WITH current_catalog AS (SELECT p.product_code,p.product_name,p.product_line,g.category_label product_line_label,g.sort_order product_line_sort_order,p.status source_status,GREATEST(p.updated_at,COALESCE(g.updated_at,p.updated_at)) source_updated_at FROM " + s.products + " p LEFT JOIN " + s.groups + " g ON g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line WHERE " + predicate + ") ", args
}

// ExpiresAtMillis is the trusted grant deadline, retained by intake evidence.
func (s CurrentCatalogSource) ExpiresAtMillis() int64 { return s.expiresAt }
