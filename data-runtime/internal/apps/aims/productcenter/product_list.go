package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

type ProductScopeOverride struct {
	ProductCode string `json:"product_code"`
	Mask        int    `json:"mask"`
}
type ProductListPermit struct {
	ActorUID    string                 `json:"actor_uid"`
	Resource    string                 `json:"resource"`
	Action      string                 `json:"action"`
	ExpiresAt   int64                  `json:"expires_at"`
	CanOnboard  bool                   `json:"can_onboard"`
	DefaultMask int                    `json:"default_mask"`
	Overrides   []ProductScopeOverride `json:"overrides"`
}
type ProductListQuery struct {
	Page        int     `json:"page"`
	PageSize    int     `json:"page_size"`
	Keyword     string  `json:"keyword"`
	ProductLine string  `json:"product_line"`
	Status      string  `json:"status"`
	Tree        bool    `json:"tree"`
	ChildLine   *string `json:"child_line"`
}
type ProductListItem struct {
	ProductCode           string  `json:"product_code"`
	BizID                 string  `json:"biz_id"`
	Status                string  `json:"status"`
	Revision              uint64  `json:"revision"`
	ProductName           *string `json:"product_name"`
	ProductLine           *string `json:"product_line"`
	ProductLineLabel      *string `json:"product_line_label"`
	SourceStatus          *string `json:"source_status"`
	SourceUpdatedAt       *string `json:"source_updated_at"`
	ManagementProductCode *string `json:"management_product_code"`
	ComponentID           *int64  `json:"component_id"`
}
type ProductListPage struct {
	Items            []ProductListItem  `json:"items"`
	Groups           []ProductLineGroup `json:"groups"`
	Total            int                `json:"total"`
	Page             int                `json:"page"`
	PageSize         int                `json:"pageSize"`
	Generation       *string            `json:"catalog_generation"`
	CatalogUpdatedAt *string            `json:"catalog_updated_at"`
}

func validateProductListInput(uid string, permit ProductListPermit, input ProductListQuery) error {
	if !validMemberUID(uid) || permit.ActorUID != uid || permit.Resource != "products" || permit.Action != "view" || permit.DefaultMask < 0 || permit.DefaultMask > 7 || len(permit.Overrides) > 512 {
		return invalid("product_authorization_invalid", "产品列表授权无效")
	}
	seen := map[string]bool{}
	for _, o := range permit.Overrides {
		if o.ProductCode == "" || o.ProductCode != strings.TrimSpace(o.ProductCode) || utf8.RuneCountInString(o.ProductCode) > 64 || o.Mask < 0 || o.Mask > 7 || seen[o.ProductCode] {
			return invalid("product_authorization_invalid", "产品范围无效")
		}
		seen[o.ProductCode] = true
	}
	if (input.ChildLine != nil && (!input.Tree || utf8.RuneCountInString(*input.ChildLine) > 64)) || input.Page < 1 || input.Page > 1000000 || input.PageSize < 1 || input.PageSize > 100 || utf8.RuneCountInString(input.Keyword) > 200 || utf8.RuneCountInString(input.ProductLine) > 64 || (input.Status != "" && input.Status != "active" && input.Status != "archived" && input.Status != "not_enabled") {
		return invalid("product_list_query_invalid", "产品列表筛选无效")
	}
	return nil
}

func ListProducts(ctx context.Context, db *sql.DB, uid string, permit ProductListPermit, input ProductListQuery) (ProductListPage, error) {
	if err := validateProductListInput(uid, permit, input); err != nil {
		return ProductListPage{Items: []ProductListItem{}, Page: input.Page, PageSize: input.PageSize}, err
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return ProductListPage{}, err
	}
	defer tx.Rollback()
	out, err := listProductsTx(ctx, tx, uid, permit, input, nil)
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}

// ListProductsInTransaction combines a caller-owned snapshot with an independently
// authorized current Assets catalog. The caller holds the tenant generation guard.
func ListProductsInTransaction(ctx context.Context, tx *sql.Tx, uid string, permit ProductListPermit, input ProductListQuery, source CurrentCatalogSource) (ProductListPage, error) {
	if tx == nil {
		return ProductListPage{}, invalid("product_command_configuration", "缺少产品列表事务")
	}
	if source.products == "" || source.actor != uid {
		_ = tx.Rollback()
		return ProductListPage{}, invalid("product_authorization_invalid", "当前目录授权无效")
	}
	out, err := listProductsTx(ctx, tx, uid, permit, input, &source)
	if err != nil {
		_ = tx.Rollback()
	}
	return out, err
}

func listProductsTx(ctx context.Context, tx *sql.Tx, uid string, permit ProductListPermit, input ProductListQuery, source *CurrentCatalogSource) (ProductListPage, error) {
	result := ProductListPage{Items: []ProductListItem{}, Page: input.Page, PageSize: input.PageSize}
	if err := validateProductListInput(uid, permit, input); err != nil {
		return result, err
	}
	var now int64
	var snapshotTime string
	if err := tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED),DATE_FORMAT(UTC_TIMESTAMP(3),'%Y-%m-%d %H:%i:%s.%f')`).Scan(&now, &snapshotTime); err != nil {
		return result, err
	}
	if permit.ExpiresAt <= now || permit.ExpiresAt > now+30000 || (source != nil && (source.expiresAt <= now || source.expiresAt > now+30000)) {
		return result, invalid("product_authorization_expired", "产品列表授权过期")
	}
	var generation uint64
	var err error
	if source == nil {
		err = tx.QueryRowContext(ctx, `SELECT id,biz_id,DATE_FORMAT(completed_at,'%Y-%m-%dT%H:%i:%s.%fZ') FROM product_catalog_refreshes WHERE status='active'`).Scan(&generation, &result.Generation, &result.CatalogUpdatedAt)
		if err != nil && err != sql.ErrNoRows {
			return result, err
		}
	}
	// Union the active catalog with workspaces without duplicates. Pending products
	// use the non-member view scope; membership cannot grant access before onboarding.
	// Count and page use the same snapshot and predicate. Missing/deleted catalog
	// entries keep their workspaces readable by code, without inventing a name.
	overrides := permit.Overrides
	if overrides == nil {
		overrides = []ProductScopeOverride{}
	}
	encoded, _ := json.Marshal(overrides)

	prefix := ""
	catalog := "product_catalog_projection"
	candidateGeneration, joinGeneration := "c0.generation=? AND ", "c.generation=? AND "
	refreshJoin := "JOIN product_catalog_refreshes r1 ON r1.id=c1.generation AND r1.status='active'"
	missingSources := ` UNION ALL SELECT b0.source_product_code,'','not_enabled',0 FROM product_component_sources b0 WHERE NOT EXISTS(SELECT 1 FROM product_catalog_projection c0 WHERE c0.generation=? AND c0.product_code=b0.source_product_code)`
	nameExpr := "COALESCE(IF(l.product_code IS NOT NULL,lc.label,NULL),l.line_label,c.product_name,b.source_product_name)"
	lineExpr := "COALESCE(bl.line_code,l.line_code,c.product_line)"
	lineLookup := lineExpr
	labelExpr := "COALESCE(lc.label,bl.line_label,l.line_label,c.product_line_label)"
	searchLineExpr := "COALESCE(lc.label,bl.line_label,l.line_label,c.product_line_label,c.product_line)"
	catalogArgs := []any{generation, generation, generation}
	group := productLineQuery{catalog: catalog, lineExpr: lineExpr, generation: generation, globalOnboard: permit.CanOnboard}
	if source != nil {
		prefix, catalogArgs = source.cte()
		catalog = "current_catalog"
		candidateGeneration = ""
		joinGeneration = ""
		refreshJoin = ""
		missingSources = ""
		nameExpr = "CASE WHEN l.product_code IS NOT NULL THEN lc.label ELSE c.product_name END"
		lineExpr = "COALESCE(c.product_line,lc.product_line)"
		lineLookup = "COALESCE(c.product_line,l.line_code)"
		labelExpr = "lc.label"
		searchLineExpr = "COALESCE(lc.label,c.product_line)"
		group = productLineQuery{prefix: prefix, prefixArgs: append([]any{}, catalogArgs...), catalog: catalog, lineExpr: lineExpr, current: true, globalOnboard: source.all && permit.CanOnboard && permit.DefaultMask == 7 && len(permit.Overrides) == 0}
		if err = tx.QueryRowContext(ctx, prefix+"SELECT DATE_FORMAT(MAX(source_updated_at),'%Y-%m-%dT%H:%i:%s.%fZ') FROM current_catalog", catalogArgs...).Scan(&result.CatalogUpdatedAt); err != nil {
			return result, err
		}
	}
	from := ` FROM (
 SELECT product_code,biz_id,CAST(status AS CHAR) status,revision FROM product_workspaces
 UNION ALL
 SELECT c0.product_code,'','not_enabled',0 FROM ` + catalog + ` c0
 WHERE ` + candidateGeneration + ` NOT EXISTS (SELECT 1 FROM product_workspaces existing WHERE existing.product_code=c0.product_code)
` + missingSources + `
 ) w
 LEFT JOIN ` + catalog + ` c ON ` + joinGeneration + ` c.product_code=w.product_code
 LEFT JOIN product_component_sources b ON b.source_product_code=w.product_code
 LEFT JOIN product_workspaces owner ON owner.product_code=b.product_code
 LEFT JOIN product_line_workspaces l ON l.product_code=w.product_code
 LEFT JOIN product_line_workspaces bl ON bl.product_code=b.product_code
 LEFT JOIN (
 SELECT c1.product_line,MAX(NULLIF(TRIM(c1.product_line_label),'')) label
 FROM ` + catalog + ` c1 ` + refreshJoin + `
 GROUP BY c1.product_line
 ) lc ON BINARY lc.product_line=BINARY ` + lineLookup + `
 LEFT JOIN JSON_TABLE(?, '$[*]' COLUMNS(product_code VARCHAR(64) PATH '$.product_code',mask INT PATH '$.mask')) s ON BINARY s.product_code=BINARY COALESCE(b.product_code,w.product_code)
 LEFT JOIN (SELECT product_code,MAX(relation_type='manager') is_manager FROM product_members
 WHERE uid=? AND status='active' AND valid_from<=? AND (valid_until IS NULL OR valid_until>?) GROUP BY product_code) m ON m.product_code=COALESCE(b.product_code,w.product_code)
 WHERE (COALESCE(s.mask,?) & CASE WHEN COALESCE(owner.status,w.status)='not_enabled' THEN 1 WHEN m.is_manager=1 THEN 4 WHEN m.product_code IS NOT NULL THEN 2 ELSE 1 END)<>0
 AND (?='' OR COALESCE(owner.status,w.status)=?) AND (?='' OR BINARY ` + lineExpr + `=BINARY ?)
 AND (?='' OR LOCATE(?,w.product_code)>0 OR LOCATE(?,` + nameExpr + `)>0 OR (? AND LOCATE(?,` + searchLineExpr + `)>0))
 AND (? OR b.source_product_code IS NULL)`
	args := append(catalogArgs, []any{string(encoded), uid, snapshotTime, snapshotTime, permit.DefaultMask, input.Status, input.Status, input.ProductLine, input.ProductLine, input.Keyword, input.Keyword, input.Keyword, input.Tree, input.Keyword, input.Tree}...)
	if source != nil {
		from += ` AND (b.source_product_code IS NULL OR c.product_code IS NOT NULL) AND (l.product_code IS NULL OR EXISTS(SELECT 1 FROM product_component_sources visible_source JOIN current_catalog visible_current ON BINARY visible_current.product_code=BINARY visible_source.source_product_code WHERE visible_source.product_code=l.product_code))`
	}
	if input.Tree && input.ChildLine == nil {
		return listProductLineGroups(ctx, tx, result, from, args, group, input)
	}
	if input.Tree {
		childExpr := "COALESCE(bl.line_code,c.product_line,'')"
		if source != nil {
			childExpr = "COALESCE(c.product_line,'')"
		}
		from += ` AND l.product_code IS NULL AND BINARY ` + childExpr + `=BINARY ?`
		args = append(args, *input.ChildLine)
	}

	if err := tx.QueryRowContext(ctx, prefix+`SELECT COUNT(*)`+from, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	rows, err := tx.QueryContext(ctx, prefix+`SELECT w.product_code,w.biz_id,COALESCE(owner.status,w.status),w.revision,`+nameExpr+`,`+lineExpr+`,`+labelExpr+`,c.source_status,DATE_FORMAT(c.source_updated_at,'%Y-%m-%dT%H:%i:%s.%fZ'),b.product_code,b.component_id`+from+` ORDER BY BINARY w.product_code LIMIT ? OFFSET ?`, append(args, input.PageSize, (input.Page-1)*input.PageSize)...)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var item ProductListItem
		if err := rows.Scan(&item.ProductCode, &item.BizID, &item.Status, &item.Revision, &item.ProductName, &item.ProductLine, &item.ProductLineLabel, &item.SourceStatus, &item.SourceUpdatedAt, &item.ManagementProductCode, &item.ComponentID); err != nil {
			rows.Close()
			return result, err
		}
		result.Items = append(result.Items, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return result, err
	}
	return result, nil
}
