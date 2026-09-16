package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// OnboardPermit is constructed by the BFF after an explicit tenant-global
// Console products:onboard decision. It is never accepted from a browser.
type OnboardPermit struct {
	ProductCode string `json:"product_code"`
	ActorUID    string `json:"actor_uid"`
	Resource    string `json:"resource"`
	Action      string `json:"action"`
	ExpiresAt   int64  `json:"expires_at"`
}
type OnboardSourceEvidence struct {
	ProductLine string `json:"product_line"`
	ProductCode string `json:"product_code"`
	Watermark   string `json:"watermark"`
	Onboardable bool   `json:"onboardable"`
	ExpiresAt   int64  `json:"expires_at"`
}
type OnboardInput struct {
	ManagerUID     string  `json:"manager_uid"`
	Positioning    *string `json:"positioning"`
	TargetUsers    *string `json:"target_users"`
	ValueStatement *string `json:"value_statement"`
	Reason         string  `json:"reason"`
}

func OnboardWorkspace(ctx context.Context, db *sql.DB, identity CommandIdentity, permit OnboardPermit, source OnboardSourceEvidence, directory MemberDirectoryEvidence, input OnboardInput) (CommandResult, error) {
	if strings.HasPrefix(identity.ProductCode, "~line-") || identity.Action != "products:onboard" || !validMemberUID(input.ManagerUID) || strings.TrimSpace(input.Reason) == "" || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_onboard_input_invalid", "接入须指定有效负责人和原因")
	}
	for _, v := range []*string{input.Positioning, input.TargetUsers, input.ValueStatement} {
		if v != nil && (!utf8.ValidString(*v) || utf8.RuneCountInString(*v) > 10000) {
			return CommandResult{}, invalid("product_text_invalid", "产品定位字段最多一万字")
		}
	}
	created := false
	candidateID := uuid.NewString()
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		if permit.ProductCode != identity.ProductCode || permit.ActorUID != identity.ActorUID || permit.Resource != "products" || permit.Action != "onboard" {
			return invalid("product_authorization_invalid", "产品接入授权不匹配")
		}
		if source.ProductCode != identity.ProductCode || !source.Onboardable || len(source.Watermark) > 191 || strings.TrimSpace(source.Watermark) == "" {
			return invalid("product_source_evidence_invalid", "产品主档不可接入或证据不完整")
		}
		if len(directory.ActiveUIDs) != 1 || directory.ActiveUIDs[0] != input.ManagerUID {
			return invalid("product_directory_evidence_invalid", "负责人缺少有效目录证据")
		}
		// Serialize individual and whole-line onboarding with catalog activation.
		var singleton int
		if err := tx.QueryRowContext(ctx, `SELECT id FROM product_catalog_control WHERE id=1 FOR UPDATE`).Scan(&singleton); err != nil {
			return err
		}
		var owned int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM product_component_sources WHERE source_product_code=?`, identity.ProductCode).Scan(&owned); err != nil {
			return err
		}
		if owned > 0 {
			return invalid("product_managed_by_line", "该产品已作为功能模块纳入产品线统一管理")
		}
		// A unified line owns only the modules it actually took in. Products left
		// out of it, and products added to the line later, stay independent and
		// may still open their own space.
		// A concurrent onboarding holds this same root. The candidate UUID tells
		// creation from reuse without depending on MySQL clientFoundRows settings.
		_, err := tx.ExecContext(ctx, `INSERT INTO product_workspaces(product_code,biz_id,positioning,target_users,value_statement,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE product_code=product_workspaces.product_code`, identity.ProductCode, candidateID, input.Positioning, input.TargetUsers, input.ValueStatement, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return err
		}
		var actualID string
		if err := tx.QueryRowContext(ctx, `SELECT biz_id FROM product_workspaces WHERE product_code=? FOR UPDATE`, identity.ProductCode).Scan(&actualID); err != nil {
			return err
		}
		// Check after waiting for the root lock, also on receipt replay.
		var now int64
		if err := tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)`).Scan(&now); err != nil {
			return err
		}
		for _, deadline := range []int64{permit.ExpiresAt, source.ExpiresAt, directory.ExpiresAt} {
			if deadline <= now || deadline > now+30000 {
				return invalid("product_authorization_expired", "接入授权或来源核验已过期，请重试")
			}
		}
		created = actualID == candidateID
		return nil
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		if !created {
			return nil, invalid("product_already_onboarded", "产品空间已存在，请进入已有空间")
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO product_members(product_code,uid,relation_type,status,valid_from,created_by,updated_by,created_at,updated_at) VALUES (?,?,'manager','active',UTC_TIMESTAMP(3),?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, identity.ProductCode, input.ManagerUID, identity.ActorUID, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		workspace, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"after": workspace, "manager_uid": input.ManagerUID, "source_watermark": source.Watermark, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'workspace',?,'onboard',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, workspace.BizID, identity.ActorUID, changes, identity.IdempotencyKey)
		return workspace, err
	})
}
