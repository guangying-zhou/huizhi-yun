package productcenter

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

type ProductVersionDraft struct {
	BusinessOwnerUID   *string `json:"business_owner_uid,omitempty"`
	PlanningMode       string  `json:"planning_mode,omitempty"`
	ExpectedRevision   uint64  `json:"expected_revision"`
	VersionCode        string  `json:"version_code"`
	Name               string  `json:"name"`
	Description        string  `json:"description"`
	PlannedReleaseDate string  `json:"planned_release_date"`
}

func ValidateProductVersionDraft(input ProductVersionDraft) error {
	if input.PlanningMode != "" && input.PlanningMode != "cycle" && input.PlanningMode != "simple" {
		return invalid("product_version_planning_mode_required", "规划方式仅支持 cycle 或 simple")
	}
	if input.BusinessOwnerUID != nil {
		uid := *input.BusinessOwnerUID
		if uid == "" || uid != strings.TrimSpace(uid) || !utf8.ValidString(uid) || utf8.RuneCountInString(uid) > 64 || strings.IndexFunc(uid, unicode.IsControl) >= 0 {
			return invalid("product_version_owner_invalid", "版本负责人标识无效")
		}
	}

	if input.ExpectedRevision == 0 {
		return invalid("product_revision_required", "必须提供产品空间版本")
	}
	if input.VersionCode == "" || input.VersionCode != strings.TrimSpace(input.VersionCode) || !utf8.ValidString(input.VersionCode) || utf8.RuneCountInString(input.VersionCode) > 64 || strings.IndexFunc(input.VersionCode, unicode.IsControl) >= 0 {
		return invalid("product_version_code_invalid", "版本号须为1至64字且不能包含控制字符或首尾空白")
	}
	for _, field := range []struct {
		value string
		max   int
	}{{input.Name, 200}, {input.Description, 10000}} {
		if !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > field.max || strings.ContainsRune(field.value, '\x00') {
			return invalid("product_version_fields_invalid", "版本名称或说明无效")
		}
	}
	if input.PlannedReleaseDate != "" {
		date, err := time.Parse("2006-01-02", input.PlannedReleaseDate)
		if err != nil || date.Year() < 1000 || date.Format("2006-01-02") != input.PlannedReleaseDate {
			return invalid("product_version_date_invalid", "计划发布日期须为有效日期")
		}
	}
	return nil
}

func CreateProductCenterVersion(ctx context.Context, db *sql.DB, identity CommandIdentity, permit AuthorizationPermit, input ProductVersionDraft) (CommandResult, error) {
	if identity.Action != "product_versions:create" {
		return CommandResult{}, invalid("product_command_identity_invalid", "产品版本创建命令不匹配")
	}
	if err := ValidateProductVersionDraft(input); err != nil {
		return CommandResult{}, err
	}
	return ExecuteCommand(ctx, db, identity, input, func(ctx context.Context, tx *sql.Tx) error {
		return AuthorizeWorkspaceTransaction(ctx, tx, identity.ProductCode, identity.ActorUID, "product_versions", "edit", permit)
	}, func(ctx context.Context, tx *sql.Tx) (any, error) {
		root, err := loadWorkspace(ctx, tx, identity.ProductCode)
		if err != nil {
			return nil, err
		}
		if root.Status != "active" {
			return nil, invalid("product_archived", "产品已归档")
		}
		if root.Revision != input.ExpectedRevision {
			return nil, invalid("product_revision_conflict", "产品已变化，请刷新")
		}
		nullable := func(value string) any {
			if strings.TrimSpace(value) == "" {
				return nil
			}
			return value
		}
		// Planning is a product activity. No project, milestone, acceptance or
		// release attribution may be fabricated at version creation time.
		planningMode := input.PlanningMode
		if planningMode == "" {
			planningMode = "cycle"
		}
		result, err := tx.ExecContext(ctx, `INSERT INTO product_versions(product_code,version_code,name,description,status,planned_release_date,planning_mode,created_by,created_at,updated_at) VALUES(?,?,?,?,'planning',?,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, identity.ProductCode, input.VersionCode, nullable(input.Name), nullable(input.Description), nullable(input.PlannedReleaseDate), planningMode, identity.ActorUID)
		if err != nil {
			return nil, err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return nil, err
		}
		if planningMode == "simple" {
			if _, err = tx.ExecContext(ctx, `INSERT INTO product_version_plans(version_id,product_code,revision,scope_revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,1,1,?,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`, id, identity.ProductCode, identity.ActorUID, identity.ActorUID); err != nil {
				return nil, err
			}
		}
		if input.BusinessOwnerUID != nil {
			if err := validateVersionOwnerTx(ctx, tx, identity.ProductCode, *input.BusinessOwnerUID); err != nil {
				return nil, err
			}
			if _, err = tx.ExecContext(ctx, `UPDATE product_versions SET business_owner_uid=? WHERE id=?`, *input.BusinessOwnerUID, id); err != nil {
				return nil, err
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE product_workspaces SET revision=revision+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE product_code=?`, identity.ActorUID, identity.ProductCode); err != nil {
			return nil, err
		}
		out := map[string]any{"id": id, "product_code": identity.ProductCode, "version_code": input.VersionCode, "name": nullable(input.Name), "description": nullable(input.Description), "planned_release_date": nullable(input.PlannedReleaseDate), "planning_mode": planningMode, "status": "planning", "revision": 1, "scope_revision": 1, "workspace_revision": root.Revision + 1, "owner_project_id": nil}
		if input.BusinessOwnerUID != nil {
			out["business_owner_uid"] = *input.BusinessOwnerUID
		}
		changes, err := json.Marshal(out)
		if err != nil {
			return nil, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO product_activity_logs(product_code,object_type,object_id,action,actor_uid,revision,changes,request_id,created_at) VALUES(?,'version',?,'create',?,1,?,?,UTC_TIMESTAMP(3))`, identity.ProductCode, strconv.FormatInt(id, 10), identity.ActorUID, changes, identity.IdempotencyKey)
		return out, err
	})
}
