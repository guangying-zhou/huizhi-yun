package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

type CatalogPermit struct {
	ActorUID  string `json:"actor_uid"`
	Resource  string `json:"resource"`
	Action    string `json:"action"`
	ExpiresAt int64  `json:"expires_at"`
}
type CatalogRefresh struct {
	ID        uint64  `json:"-"`
	BizID     string  `json:"refresh_id"`
	Status    string  `json:"status"`
	Watermark *string `json:"watermark"`
	RowCount  uint64  `json:"row_count"`
	Revision  uint64  `json:"revision"`
	NextPage  int     `json:"next_page"`
	Total     int64   `json:"total"`
	LastCode  string  `json:"-"`
}
type catalogCursor struct {
	NextPage int    `json:"next_page"`
	Total    int64  `json:"total"`
	LastCode string `json:"last_code"`
}
type CatalogSourceItem struct {
	ProductCode          string  `json:"product_code"`
	ProductName          string  `json:"product_name"`
	ProductLine          string  `json:"product_line"`
	ProductLineLabel     *string `json:"product_line_label"`
	ProductLineSortOrder *int    `json:"product_line_sort_order"`
	SourceStatus         string  `json:"source_status"`
	BusinessOwnerUID     *string `json:"business_owner_uid"`
	TechnicalOwnerUID    *string `json:"technical_owner_uid"`
	SourceUpdatedAt      string  `json:"source_updated_at"`
	Onboardable          bool    `json:"onboardable"`
}
type CatalogSourcePage struct {
	Items     []CatalogSourceItem `json:"items"`
	Total     int64               `json:"total"`
	Page      int                 `json:"page"`
	PageSize  int                 `json:"pageSize"`
	Watermark string              `json:"watermark"`
	NextPage  *int                `json:"nextPage"`
}

func authorizeCatalog(ctx context.Context, tx *sql.Tx, uid string, permit CatalogPermit, lock bool) error {
	if !validMemberUID(uid) || permit.ActorUID != uid || permit.Resource != "products" || permit.Action != "onboard" {
		return invalid("product_authorization_invalid", "目录刷新需要全租户接入授权")
	}
	if lock {
		var singleton int
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_catalog_control WHERE id=1 FOR UPDATE`).Scan(&singleton); err != nil {
			return err
		}
	}
	var now int64
	if err := tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)`).Scan(&now); err != nil {
		return err
	}
	if permit.ExpiresAt <= now || permit.ExpiresAt > now+30000 {
		return invalid("product_authorization_expired", "目录刷新授权已过期")
	}
	return nil
}
func loadCatalogRefresh(ctx context.Context, tx *sql.Tx, biz, uid string) (CatalogRefresh, error) {
	var r CatalogRefresh
	var cursor *string
	err := tx.QueryRowContext(ctx, `SELECT id,biz_id,status,source_watermark,source_cursor,row_count,revision FROM product_catalog_refreshes WHERE biz_id=? AND created_by=?`, biz, uid).Scan(&r.ID, &r.BizID, &r.Status, &r.Watermark, &cursor, &r.RowCount, &r.Revision)
	if err != nil {
		return r, err
	}
	r.NextPage = 1
	r.Total = -1
	if cursor != nil {
		var c catalogCursor
		if err := json.Unmarshal([]byte(*cursor), &c); err != nil {
			return r, err
		}
		r.NextPage, r.Total, r.LastCode = c.NextPage, c.Total, c.LastCode
	}
	return r, nil
}

// Start is idempotent for a signed actor/key pair. It creates no product root
// and does not reuse product command receipts with a fabricated product code.
func StartCatalogRefresh(ctx context.Context, db *sql.DB, uid, key string, permit CatalogPermit) (CatalogRefresh, error) {
	var result CatalogRefresh
	if !utf8.ValidString(key) || key == "" || key != strings.TrimSpace(key) || utf8.RuneCountInString(key) > 191 {
		return result, invalid("product_command_identity_invalid", "目录刷新需要幂等键")
	}
	for _, r := range key {
		if r < 32 || r == 127 {
			return result, invalid("product_command_identity_invalid", "幂等键包含控制字符")
		}
	}
	identity, _ := json.Marshal([]string{uid, key})
	biz := uuid.NewSHA1(uuid.NameSpaceURL, append([]byte("aims:catalog-refresh:"), identity...)).String()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := authorizeCatalog(ctx, tx, uid, permit, true); err != nil {
		return result, err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO product_catalog_refreshes(biz_id,created_by,created_at) VALUES (?,?,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE biz_id=product_catalog_refreshes.biz_id`, biz, uid)
	if err != nil {
		return result, err
	}
	result, err = loadCatalogRefresh(ctx, tx, biz, uid)
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func ReadCatalogRefresh(ctx context.Context, db *sql.DB, uid, biz string, permit CatalogPermit) (CatalogRefresh, error) {
	var result CatalogRefresh
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := authorizeCatalog(ctx, tx, uid, permit, false); err != nil {
		return result, err
	}
	result, err = loadCatalogRefresh(ctx, tx, biz, uid)
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func validateCatalogPage(p CatalogSourcePage) error {
	if p.Page < 1 || p.Page > 1000000 || p.PageSize != 100 || p.Total < 0 || p.Total > 100000000 || len(p.Watermark) > 191 || p.Watermark == "" {
		return invalid("product_catalog_page_invalid", "目录分页信息无效")
	}
	expected := p.Total - int64(p.Page-1)*100
	if expected < 0 {
		expected = 0
	}
	if expected > 100 {
		expected = 100
	}
	if int64(len(p.Items)) != expected {
		return invalid("product_catalog_page_invalid", "目录分页条目不完整")
	}
	more := int64(p.Page)*100 < p.Total
	if (more && (p.NextPage == nil || *p.NextPage != p.Page+1)) || (!more && p.NextPage != nil) {
		return invalid("product_catalog_page_invalid", "目录后续页无效")
	}
	previous := ""
	for _, item := range p.Items {
		if item.ProductCode == "" || item.ProductCode != strings.TrimSpace(item.ProductCode) || item.ProductCode <= previous || utf8.RuneCountInString(item.ProductCode) > 64 || !utf8.ValidString(item.ProductCode) || strings.TrimSpace(item.ProductName) == "" || utf8.RuneCountInString(item.ProductName) > 255 || utf8.RuneCountInString(item.ProductLine) > 64 || utf8.RuneCountInString(item.SourceStatus) > 64 {
			return invalid("product_catalog_page_invalid", "目录条目或排序无效")
		}
		if _, err := parseMemberDate(item.SourceUpdatedAt); err != nil {
			return invalid("product_catalog_page_invalid", "目录来源时间无效")
		}
		for _, owner := range []*string{item.BusinessOwnerUID, item.TechnicalOwnerUID} {
			if owner != nil && utf8.RuneCountInString(*owner) > 64 {
				return invalid("product_catalog_page_invalid", "目录负责人无效")
			}
		}
		if item.ProductLineLabel != nil && utf8.RuneCountInString(*item.ProductLineLabel) > 255 {
			return invalid("product_catalog_page_invalid", "产品线名称过长")
		}
		previous = item.ProductCode
	}
	return nil
}

// Append accepts only an Assets response carried by the trusted BFF. A complete
// page, cursor, receipt and active-generation switch commit together. The
// singleton lock prevents older concurrent refreshes replacing newer snapshots.
func AppendCatalogPage(ctx context.Context, db *sql.DB, uid, biz string, permit CatalogPermit, expectedRevision uint64, page CatalogSourcePage) (CatalogRefresh, error) {
	var result CatalogRefresh
	if err := validateCatalogPage(page); err != nil {
		return result, err
	}
	payload, _ := json.Marshal(page)
	digest := sha256.Sum256(payload)
	hash := hex.EncodeToString(digest[:])
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := authorizeCatalog(ctx, tx, uid, permit, true); err != nil {
		return result, err
	}
	r, err := loadCatalogRefresh(ctx, tx, biz, uid)
	if err != nil {
		return result, err
	}
	var storedHash string
	var storedResult []byte
	err = tx.QueryRowContext(ctx, `SELECT request_hash,result_json FROM product_catalog_page_receipts WHERE generation=? AND page_number=?`, r.ID, page.Page).Scan(&storedHash, &storedResult)
	if err == nil {
		if storedHash != hash {
			return result, invalid("idempotency_payload_mismatch", "相同目录页内容发生变化")
		}
		if err := json.Unmarshal(storedResult, &result); err != nil {
			return result, err
		}
		return result, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return result, err
	}
	if r.Status != "staging" || r.Revision != expectedRevision || r.NextPage != page.Page {
		return result, invalid("product_catalog_revision_conflict", "目录刷新状态或页码已变化")
	}
	if (r.Watermark != nil && *r.Watermark != page.Watermark) || (r.Total >= 0 && r.Total != page.Total) {
		return result, invalid("product_catalog_changed", "产品目录已变化，请重新刷新")
	}
	if len(page.Items) > 0 && page.Items[0].ProductCode <= r.LastCode {
		return result, invalid("product_catalog_page_invalid", "目录跨页顺序无效")
	}
	for _, item := range page.Items {
		stamp, _ := parseMemberDate(item.SourceUpdatedAt)
		_, err = tx.ExecContext(ctx, `INSERT INTO product_catalog_projection(generation,product_code,product_name,product_line,product_line_label,product_line_sort_order,source_status,business_owner_uid,technical_owner_uid,source_updated_at,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`, r.ID, item.ProductCode, item.ProductName, item.ProductLine, item.ProductLineLabel, item.ProductLineSortOrder, item.SourceStatus, item.BusinessOwnerUID, item.TechnicalOwnerUID, stamp)
		if err != nil {
			return result, err
		}
		r.LastCode = item.ProductCode
	}
	r.Watermark = &page.Watermark
	r.Total = page.Total
	r.RowCount += uint64(len(page.Items))
	r.Revision++
	r.NextPage = page.Page + 1
	if page.NextPage == nil {
		if r.RowCount != uint64(page.Total) {
			return result, invalid("product_catalog_page_invalid", "完整目录数量不匹配")
		}
		var newer int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_catalog_refreshes WHERE status='active' AND id>?`, r.ID).Scan(&newer); err != nil {
			return result, err
		}
		if newer > 0 {
			return result, invalid("product_catalog_superseded", "已有更新的目录批次生效")
		}
		if _, err := tx.ExecContext(ctx, `UPDATE product_catalog_refreshes SET status='superseded' WHERE status='active'`); err != nil {
			return result, err
		}
		r.Status = "active"
		r.NextPage = 0
	}
	cursor, _ := json.Marshal(catalogCursor{NextPage: r.NextPage, Total: r.Total, LastCode: r.LastCode})
	_, err = tx.ExecContext(ctx, `UPDATE product_catalog_refreshes SET status=?,source_watermark=?,source_cursor=?,row_count=?,revision=?,completed_at=IF(?='active',UTC_TIMESTAMP(3),NULL) WHERE id=?`, r.Status, page.Watermark, string(cursor), r.RowCount, r.Revision, r.Status, r.ID)
	if err != nil {
		return result, err
	}
	result = r
	encoded, _ := json.Marshal(result)
	_, err = tx.ExecContext(ctx, `INSERT INTO product_catalog_page_receipts(generation,page_number,request_hash,result_json,created_at) VALUES (?,?,?,?,UTC_TIMESTAMP(3))`, r.ID, page.Page, hash, encoded)
	if err != nil {
		return result, err
	}
	return result, tx.Commit()
}

func FailCatalogRefresh(ctx context.Context, db *sql.DB, uid, biz string, permit CatalogPermit) (CatalogRefresh, error) {
	var result CatalogRefresh
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	if err := authorizeCatalog(ctx, tx, uid, permit, true); err != nil {
		return result, err
	}
	result, err = loadCatalogRefresh(ctx, tx, biz, uid)
	if err != nil {
		return result, err
	}
	if result.Status == "staging" {
		_, err = tx.ExecContext(ctx, `UPDATE product_catalog_refreshes SET status='failed',revision=revision+1,completed_at=UTC_TIMESTAMP(3) WHERE id=?`, result.ID)
		if err != nil {
			return result, err
		}
		result.Status = "failed"
		result.Revision++
	}
	return result, tx.Commit()
}
