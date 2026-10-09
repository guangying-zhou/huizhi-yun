package enterpriseplanning

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	pc "github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/apps/assets"
	e "github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"strings"
	"time"
	"unicode/utf8"
)

type ProductCandidatesQuery struct {
	Keyword     string `json:"keyword"`
	Code        string `json:"code"`
	ProductLine string `json:"productLine"`
	Watermark   string `json:"watermark"`
	Page        int    `json:"page"`
	PageSize    int    `json:"pageSize"`
}

// ProductsCandidates returns authorized Assets records, including products not
// yet present in Aims. It streams the matching snapshot into the content digest
// while retaining only the requested page; hidden records affect neither count
// nor watermark. The digest is independent of page number and page size.
func (s *OnboardingService) ProductsCandidates(ctx context.Context, actor string, permit pc.OnboardPermit, q ProductCandidatesQuery, authorizer AssetsCatalogAuthorizer) (assets.ProductCatalogPage, error) {
	out := assets.ProductCatalogPage{Items: []assets.ProductCatalogItem{}}
	if err := onboardAccess(actor, "*", permit); err != nil {
		return out, err
	}
	if q.Page == 0 {
		q.Page = 1
	}
	if q.PageSize == 0 {
		q.PageSize = 100
	}
	if q.Page < 1 || q.Page > 1000000 || q.PageSize < 1 || q.PageSize > 100 || utf8.RuneCountInString(q.Keyword) > 200 || utf8.RuneCountInString(q.Code) > 64 || utf8.RuneCountInString(q.ProductLine) > 64 || len(q.Watermark) > 191 {
		return out, httperror.New(400, "product_catalog_query_invalid", "invalid catalog query")
	}
	for _, v := range []string{q.Keyword, q.Code, q.ProductLine} {
		if !utf8.ValidString(v) || strings.ContainsRune(v, '\x00') {
			return out, httperror.New(400, "product_catalog_query_invalid", "invalid catalog filter")
		}
	}
	if q.Page > 1 && q.Watermark == "" {
		return out, httperror.New(400, "product_catalog_watermark_required", "subsequent pages require watermark")
	}
	if authorizer == nil {
		return out, e.ErrDirectoryAccess
	}
	tx, err := s.begin(ctx, false)
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	c := s.catalog
	identity := e.DirectoryIdentity{SourceDomain: "aims", Key: c.aims.Key, ActorUID: actor, SchemaVersion: c.aims.SchemaVersion, Generation: c.aims.Generation, AssetsOwnerDeployment: c.assets.OwnerDeployment, AimsOwnerDeployment: c.aims.OwnerDeployment}
	grant, err := authorizer.AssetsProductsView(ctx, tx, identity)
	if err != nil {
		return out, err
	}
	if grant.Key != identity.Key || grant.ActorUID != actor || grant.SchemaVersion != identity.SchemaVersion || grant.Generation != identity.Generation || !time.Now().Before(grant.ExpiresAt) || grant.ExpiresAt.After(time.Now().Add(30*time.Second)) {
		return out, e.ErrDirectoryAccess
	}
	if _, err = pc.NewCurrentCatalogSource(c.products, c.groups, actor, grant.ExpiresAt.UnixMilli(), grant.AllProducts, grant.ProductCodes); err != nil {
		return out, err
	}
	predicate := "(?='' OR BINARY p.product_code=BINARY ?) AND (?='' OR BINARY p.product_line=BINARY ?) AND (?='' OR LOCATE(?,p.product_code)>0 OR LOCATE(?,p.product_name)>0)"
	args := []any{q.Code, q.Code, q.ProductLine, q.ProductLine, q.Keyword, q.Keyword, q.Keyword}
	if !grant.AllProducts {
		codes, _ := json.Marshal(grant.ProductCodes)
		predicate += " AND EXISTS(SELECT 1 FROM JSON_TABLE(?, '$[*]' COLUMNS(code VARCHAR(64) PATH '$')) visible WHERE BINARY visible.code=BINARY p.product_code)"
		args = append(args, string(codes))
	}
	rows, err := tx.QueryContext(ctx, "SELECT p.product_code,p.product_name,p.product_line,g.category_label,g.sort_order,p.status,p.business_owner_uid,p.technical_owner_uid,CONCAT(LEFT(DATE_FORMAT(GREATEST(p.updated_at,COALESCE(g.updated_at,p.updated_at)),'%Y-%m-%dT%H:%i:%s.%f'),23),'Z') FROM "+c.products+" p LEFT JOIN "+c.groups+" g ON g.category_scope='product' AND BINARY g.category_value=BINARY p.product_line WHERE "+predicate+" ORDER BY BINARY p.product_code", args...)
	if err != nil {
		return out, err
	}
	hash := sha256.New()
	encoder := json.NewEncoder(hash)
	_ = encoder.Encode(struct {
		Identity            e.DirectoryIdentity
		Keyword, Code, Line string
	}{identity, q.Keyword, q.Code, q.ProductLine})
	start := int64((q.Page - 1) * q.PageSize)
	for rows.Next() {
		var item assets.ProductCatalogItem
		if err = rows.Scan(&item.ProductCode, &item.ProductName, &item.ProductLine, &item.ProductLineLabel, &item.ProductLineSortOrder, &item.Status, &item.BusinessOwnerUID, &item.TechnicalOwnerUID, &item.SourceUpdatedAt); err != nil {
			rows.Close()
			return out, err
		}
		item.Onboardable = assets.ProductStatusOnboardable(item.Status)
		if err = encoder.Encode(item); err != nil {
			rows.Close()
			return out, err
		}
		if out.Total >= start && out.Total < start+int64(q.PageSize) {
			out.Items = append(out.Items, item)
		}
		out.Total++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	out.Watermark = "current-assets-page:v1:" + hex.EncodeToString(hash.Sum(nil))
	out.Page = q.Page
	out.PageSize = q.PageSize
	if q.Watermark != "" && q.Watermark != out.Watermark {
		return assets.ProductCatalogPage{}, httperror.New(409, "product_catalog_changed", "product catalog changed; restart pagination")
	}
	if start+int64(q.PageSize) < out.Total {
		next := q.Page + 1
		out.NextPage = &next
	}
	if err = tx.Commit(); err != nil {
		return out, err
	}
	return out, nil
}
