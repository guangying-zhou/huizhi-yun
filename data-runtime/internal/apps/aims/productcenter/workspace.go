package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

// AuthorizationPermit is produced only by the AIMS BFF after Console grants
// the exact action. The internal Runtime service capability protects this
// envelope; it is never accepted as browser input. Runtime does not reinterpret
// roles or scopes: it checks the facts on which Console made its decision.
type AuthorizationPermit struct {
	Resource  string             `json:"resource"`
	Action    string             `json:"action"`
	Facts     AuthorizationFacts `json:"facts"`
	ExpiresAt int64              `json:"expires_at"`
}

func AuthorizeWorkspaceTransaction(ctx context.Context, tx *sql.Tx, code, uid, resource, action string, permit AuthorizationPermit) error {
	if permit.Resource != resource || permit.Action != action || permit.Facts.ProductCode != code || permit.Facts.ActorUID != uid {
		return invalid("product_authorization_invalid", "产品授权上下文不匹配")
	}
	var revision uint64
	// Every product mutation, including membership updates, must take this root
	// lock first. A revoked member cannot reuse an earlier decision or receipt.
	if err := tx.QueryRowContext(ctx, `SELECT revision FROM product_workspaces WHERE product_code=? FOR UPDATE`, code).Scan(&revision); err != nil {
		return err
	}
	var now int64
	if err := tx.QueryRowContext(ctx, `SELECT CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS SIGNED)`).Scan(&now); err != nil {
		return err
	}
	if permit.ExpiresAt <= now || permit.ExpiresAt > now+30000 {
		return invalid("product_authorization_expired", "产品授权已过期，请重试")
	}
	facts, err := LoadAuthorizationFacts(ctx, tx, code, uid)
	if err != nil {
		return err
	}
	if facts != permit.Facts {
		return invalid("product_authorization_changed", "产品或成员关系已变化，请重新授权")
	}
	return nil
}

type Workspace struct {
	ProductCode    string  `json:"product_code"`
	BizID          string  `json:"biz_id"`
	Positioning    *string `json:"positioning"`
	TargetUsers    *string `json:"target_users"`
	ValueStatement *string `json:"value_statement"`
	Status         string  `json:"status"`
	Revision       uint64  `json:"revision"`
	CreatedBy      string  `json:"created_by"`
	UpdatedBy      string  `json:"updated_by"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      string  `json:"updated_at"`
}

// WorkspaceDetail adds the read-only catalog identity used by the product
// workspace header. The catalog stays owned by Assets: a missing or stale
// projection keeps the product readable by code instead of inventing a name.
type WorkspaceDetail struct {
	ManagementKind string `json:"management_kind"`
	Workspace
	ProductName      *string `json:"product_name"`
	ProductLine      *string `json:"product_line"`
	ProductLineLabel *string `json:"product_line_label"`
}

func loadWorkspace(ctx context.Context, query AuthorizationQuery, code string) (Workspace, error) {
	var w Workspace
	err := query.QueryRowContext(ctx, `SELECT product_code,biz_id,positioning,target_users,value_statement,status,revision,created_by,updated_by,
		DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ'),DATE_FORMAT(updated_at,'%Y-%m-%dT%H:%i:%s.%fZ')
		FROM product_workspaces WHERE product_code=?`, code).Scan(&w.ProductCode, &w.BizID, &w.Positioning, &w.TargetUsers, &w.ValueStatement, &w.Status, &w.Revision, &w.CreatedBy, &w.UpdatedBy, &w.CreatedAt, &w.UpdatedAt)
	return w, err
}

func ReadWorkspace(ctx context.Context, db *sql.DB, code, uid string, permit AuthorizationPermit) (WorkspaceDetail, error) {
	detail := WorkspaceDetail{ManagementKind: "product"}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return detail, err
	}
	defer tx.Rollback()
	if err := AuthorizeWorkspaceTransaction(ctx, tx, code, uid, "products", "view", permit); err != nil {
		return detail, err
	}
	detail.Workspace, err = loadWorkspace(ctx, tx, code)
	if err != nil {
		return detail, err
	}
	// Display-only catalog identity from the active refresh generation. No active
	// generation, or a product absent from it, leaves the fields null.
	if err := tx.QueryRowContext(ctx, `SELECT c.product_name,c.product_line,c.product_line_label
		FROM product_catalog_refreshes r
		JOIN product_catalog_projection c ON c.generation=r.id AND c.product_code=?
		WHERE r.status='active'`, code).Scan(&detail.ProductName, &detail.ProductLine, &detail.ProductLineLabel); err != nil && err != sql.ErrNoRows {
		return detail, err
	}
	// Line management has its own explicit identity; never masquerades as an Assets product.
	var line, label string
	if err := tx.QueryRowContext(ctx, `SELECT l.line_code,COALESCE((SELECT MAX(NULLIF(TRIM(c.product_line_label),''))
 FROM product_catalog_projection c JOIN product_catalog_refreshes r ON r.id=c.generation AND r.status='active'
 WHERE BINARY c.product_line=BINARY l.line_code),l.line_label)
 FROM product_line_workspaces l WHERE l.product_code=?`, code).Scan(&line, &label); err == nil {
		detail.ManagementKind = "product_line"
		detail.ProductName = &label
		detail.ProductLine = &line
		detail.ProductLineLabel = &label
	} else if err != sql.ErrNoRows {
		return detail, err
	}
	return detail, tx.Commit()
}

type WorkspaceChange struct {
	ExpectedRevision uint64 `json:"expected_revision"`
	// The edit form sends all three positioning fields. nil explicitly clears a
	// field; absence is rejected by the BFF/adapter rather than clearing silently.
	Positioning    *string `json:"positioning"`
	TargetUsers    *string `json:"target_users"`
	ValueStatement *string `json:"value_statement"`
	Reason         string  `json:"reason"`
}

func ChangeWorkspace(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input WorkspaceChange) (CommandResult, error) {
	if identity.Action != "products:edit" && identity.Action != "products:archive" && identity.Action != "products:restore" {
		return CommandResult{}, invalid("product_action_invalid", "不支持的产品空间操作")
	}
	action := strings.TrimPrefix(identity.Action, "products:")
	if input.ExpectedRevision == 0 {
		return CommandResult{}, invalid("product_revision_required", "必须提供产品版本号")
	}
	for _, value := range []*string{input.Positioning, input.TargetUsers, input.ValueStatement} {
		if value != nil && (!utf8.ValidString(*value) || utf8.RuneCountInString(*value) > 10000) {
			return CommandResult{}, invalid("product_text_invalid", "产品定位字段最多一万字")
		}
	}
	if (action != "edit" && strings.TrimSpace(input.Reason) == "") || utf8.RuneCountInString(input.Reason) > 2000 {
		return CommandResult{}, invalid("product_reason_required", "归档或恢复必须填写原因，最多两千字")
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "products", action, permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		before, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if before.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品空间已被修改，请刷新后重试")
		}
		if action == "restore" {
			if before.Status != "archived" {
				return nil, invalid("product_state_conflict", "只能恢复已归档的产品空间")
			}
		} else if before.Status != "active" {
			return nil, invalid("product_archived", "产品空间已归档，请先恢复")
		}
		if action == "edit" {
			_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET positioning=?,target_users=?,value_statement=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, input.Positioning, input.TargetUsers, input.ValueStatement, identity.ActorUID, identity.ProductCode)
		} else {
			status := "archived"
			if action == "restore" {
				status = "active"
			}
			_, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET status=?,revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, status, identity.ActorUID, identity.ProductCode)
		}
		if err != nil {
			return nil, err
		}
		after, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		changes, err := json.Marshal(map[string]any{"before": before, "after": after, "reason": input.Reason})
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES (?,'workspace',?,?,?,?,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, before.BizID, action, identity.ActorUID, after.Revision, changes, identity.IdempotencyKey)
		return after, err
	})
}
