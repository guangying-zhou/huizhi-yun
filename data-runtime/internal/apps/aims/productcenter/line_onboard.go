package productcenter

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/google/uuid"
	"strings"
	"unicode/utf8"
)

type LineOnboardInput struct {
	LineCode          string   `json:"line_code"`
	ExpectedWatermark string   `json:"expected_watermark"`
	ManagerUID        string   `json:"manager_uid"`
	ProductCodes      []string `json:"product_codes"`
}
type LineSourceEvidence struct {
	Total     int                 `json:"total"`
	LineCode  string              `json:"line_code"`
	Watermark string              `json:"watermark"`
	Items     []CatalogSourceItem `json:"items"`
	ExpiresAt int64               `json:"expires_at"`
}

func LineWorkspaceCode(line string) string {
	digest := sha256.Sum256([]byte(line))
	return "~line-" + hex.EncodeToString(digest[:])[:56]
}
func validateLineInput(input LineOnboardInput, source LineSourceEvidence) error {
	if input.LineCode == "" || strings.TrimSpace(input.LineCode) != input.LineCode || utf8.RuneCountInString(input.LineCode) > 64 || !utf8.ValidString(input.LineCode) || strings.ContainsAny(input.LineCode, "\x00\r\n") || !validMemberUID(input.ManagerUID) {
		return invalid("product_line_input_invalid", "产品线或负责人无效")
	}
	if source.LineCode != input.LineCode || source.Watermark == "" || len(source.Watermark) > 191 || source.Watermark != input.ExpectedWatermark || len(source.Items) == 0 || len(source.Items) > 1000 || source.Total != len(source.Items) {
		return invalid("product_line_source_changed", "产品线目录已变化或为空，请重新确认")
	}
	seen := map[string]bool{}
	onboardable := map[string]bool{}
	for _, item := range source.Items {
		if item.ProductLine != input.LineCode || item.ProductCode == "" || len(item.ProductCode) > 256 || utf8.RuneCountInString(item.ProductCode) > 64 || strings.HasPrefix(item.ProductCode, "~line-") || seen[item.ProductCode] || strings.TrimSpace(item.ProductName) == "" || utf8.RuneCountInString(item.ProductName) > 255 {
			return invalid("product_line_source_invalid", "产品线包含重复或不匹配的产品")
		}
		seen[item.ProductCode] = true
		onboardable[item.ProductCode] = item.Onboardable
	}
	// The caller picks which products join the unified workspace; every pick must
	// come from this exact source evidence, so a stale page cannot widen it.
	if len(input.ProductCodes) == 0 || len(input.ProductCodes) > len(source.Items) {
		return invalid("product_line_selection_invalid", "请选择要纳入统一管理的产品")
	}
	picked := map[string]bool{}
	for _, code := range input.ProductCodes {
		if !seen[code] || picked[code] {
			return invalid("product_line_selection_invalid", "所选产品不属于当前产品线目录或重复")
		}
		// Unselected products keep their own lifecycle; only the picked ones must
		// currently be onboardable.
		if !onboardable[code] {
			return invalid("product_line_source_invalid", "所选产品当前生命周期不允许接入")
		}
		picked[code] = true
	}
	return nil
}

func selectedLineItems(input LineOnboardInput, source LineSourceEvidence) []CatalogSourceItem {
	picked := map[string]bool{}
	for _, code := range input.ProductCodes {
		picked[code] = true
	}
	items := make([]CatalogSourceItem, 0, len(input.ProductCodes))
	for _, item := range source.Items {
		if picked[item.ProductCode] {
			items = append(items, item)
		}
	}
	return items
}

func OnboardProductLine(ctx context.Context, db *sql.DB, identity CommandIdentity, permit OnboardPermit, source LineSourceEvidence, directory MemberDirectoryEvidence, input LineOnboardInput) (CommandResult, error) {
	if err := validateLineInput(input, source); err != nil {
		return CommandResult{}, err
	}
	if identity.Action != "products:onboard-line" || identity.ProductCode != LineWorkspaceCode(input.LineCode) {
		return CommandResult{}, invalid("product_command_identity_invalid", "统一管理命令不匹配")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if permit.ProductCode != identity.ProductCode || permit.ActorUID != identity.ActorUID || permit.Resource != "products" || permit.Action != "onboard" || len(directory.ActiveUIDs) != 1 || directory.ActiveUIDs[0] != input.ManagerUID {
			return invalid("product_authorization_invalid", "统一管理授权或负责人证据不匹配")
		}
		var singleton int
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_catalog_control WHERE id=1 FOR UPDATE`).Scan(&singleton); err != nil {
			return err
		}
		var now int64
		if err := tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)`).Scan(&now); err != nil {
			return err
		}
		for _, deadline := range []int64{permit.ExpiresAt, source.ExpiresAt, directory.ExpiresAt} {
			if deadline <= now || deadline > now+30000 {
				return invalid("product_authorization_expired", "统一管理授权或来源证据已过期")
			}
		}
		return nil
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_line_workspaces WHERE line_code=?`, input.LineCode).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, invalid("product_line_already_managed", "产品线已启用统一管理")
		}
		selected := selectedLineItems(input, source)
		// Products already managed individually keep their own space; only the
		// picked ones must still be free, so a hidden conflict is never merged.
		for _, item := range selected {
			if err := tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM product_workspaces WHERE product_code=?)+(SELECT COUNT(*) FROM product_component_sources WHERE source_product_code=?)`, item.ProductCode, item.ProductCode).Scan(&n); err != nil {
				return nil, err
			}
			if n > 0 {
				return nil, invalid("product_line_has_managed_products", "所选产品中已有产品启用管理，请取消勾选后重试")
			}
		}
		// A reserved management code cannot collide with an Assets product.
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_catalog_projection WHERE product_code=?`, identity.ProductCode).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, invalid("product_line_code_conflict", "统一管理编码与来源产品冲突")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO product_workspaces(product_code,biz_id,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, identity.ProductCode, uuid.NewString(), identity.ActorUID, identity.ActorUID); err != nil {
			return nil, err
		}
		label := input.LineCode
		if source.Items[0].ProductLineLabel != nil && strings.TrimSpace(*source.Items[0].ProductLineLabel) != "" {
			label = *source.Items[0].ProductLineLabel
		}
		if utf8.RuneCountInString(label) > 255 {
			return nil, invalid("product_line_label_invalid", "产品线名称过长")
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO product_line_workspaces(line_code,product_code,line_label,source_watermark) VALUES(?,?,?,?)`, input.LineCode, identity.ProductCode, label, source.Watermark); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES(?,?,'manager','active',UTC_TIMESTAMP(3),?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, identity.ProductCode, input.ManagerUID, identity.ActorUID, identity.ActorUID); err != nil {
			return nil, err
		}
		for i, item := range selected {
			inserted, err := tx.ExecContext(ctx, `INSERT INTO product_components(biz_id,product_code,name,description,sort_order,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, uuid.NewString(), identity.ProductCode, item.ProductName, "来源产品："+item.ProductCode, i, identity.ActorUID, identity.ActorUID)
			if err != nil {
				return nil, err
			}
			id, err := inserted.LastInsertId()
			if err != nil {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO product_component_sources(source_product_code,product_code,component_id,source_product_name) VALUES(?,?,?,?)`, item.ProductCode, identity.ProductCode, id, item.ProductName); err != nil {
				return nil, err
			}
		}
		w, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"after": w, "line_code": input.LineCode, "source": source.Items, "selected": input.ProductCodes, "watermark": source.Watermark, "manager_uid": input.ManagerUID})
		if err != nil {
			return nil, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'workspace',?,'onboard-line',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, w.BizID, identity.ActorUID, changes, identity.IdempotencyKey); err != nil {
			return nil, err
		}
		return map[string]any{"product_code": identity.ProductCode, "line_code": input.LineCode, "component_count": len(selected)}, nil
	})
}
