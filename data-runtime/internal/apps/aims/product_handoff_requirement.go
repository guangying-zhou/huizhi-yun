package aims

import (
	"context"
	"database/sql"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/apps/aims/productcenter"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// resolveProductHandoffRequirementTx is called only after project requirement
// edit authorization. It rechecks target eligibility under row locks and never
// commits independently of the product handoff command.
func (a *Adapter) resolveProductHandoffRequirementTx(ctx context.Context, tx *sql.Tx, productCode, uid string, authorizedProjectID int64, input productcenter.PlanningHandoffInput) (int64, error) {
	if err := productcenter.ValidatePlanningHandoffInput(input); err != nil {
		return 0, err
	}
	if authorizedProjectID <= 0 || uid == "" {
		return 0, httperror.New(http.StatusForbidden, "planning_handoff_project_invalid", "缺少目标项目授权")
	}
	var projectID int64
	var category, lifecycle string
	if err := tx.QueryRowContext(ctx, `SELECT id,category,lifecycle_status FROM aims_projects WHERE project_code=? FOR UPDATE`, input.ProjectCode).Scan(&projectID, &category, &lifecycle); err != nil {
		return 0, err
	}
	if projectID != authorizedProjectID {
		return 0, httperror.New(http.StatusForbidden, "planning_handoff_project_mismatch", "目标项目与授权不一致")
	}
	if category != "product_dev" || lifecycle != "active" {
		return 0, httperror.New(http.StatusConflict, "planning_handoff_project_ineligible", "仅可转交到启用中的产品研发项目")
	}
	var bindingID int64
	var boundVersion sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT id,version_id FROM aims_project_products WHERE project_id=? AND BINARY product_code=? FOR UPDATE`, projectID, productCode).Scan(&bindingID, &boundVersion); err != nil {
		return 0, err
	}
	if input.PlannedVersionID > 0 {
		if boundVersion.Valid && boundVersion.Int64 != input.PlannedVersionID {
			return 0, httperror.New(http.StatusConflict, "planning_handoff_version_binding_mismatch", "目标项目限定了其他产品版本")
		}
		var versionCode, status string
		if err := tx.QueryRowContext(ctx, `SELECT product_code,status FROM product_versions WHERE id=? FOR UPDATE`, input.PlannedVersionID).Scan(&versionCode, &status); err != nil {
			return 0, err
		}
		if versionCode != productCode || (status != "planning" && status != "developing") {
			return 0, httperror.New(http.StatusConflict, "planning_handoff_version_invalid", "交付意图版本不属于该产品或已关闭")
		}
		if input.PlannedVersionFeatureID > 0 {
			var versionID int64
			var featureStatus string
			var itemBizID sql.NullString
			if err := tx.QueryRowContext(ctx, `SELECT f.version_id,f.status,i.biz_id FROM product_version_features f LEFT JOIN product_planning_items i ON i.id=f.planning_item_id AND i.product_code=? WHERE f.id=? FOR UPDATE`, productCode, input.PlannedVersionFeatureID).Scan(&versionID, &featureStatus, &itemBizID); err != nil {
				return 0, err
			}
			if versionID != input.PlannedVersionID || featureStatus != "planned" || !itemBizID.Valid || itemBizID.String != input.ItemBizID {
				return 0, httperror.New(http.StatusConflict, "planning_handoff_version_feature_invalid", "版本特性不属于本次规划范围")
			}
		}
	}
	if input.Operation == "link" {
		var status string
		if err := tx.QueryRowContext(ctx, `SELECT status FROM requirement_items WHERE id=? AND project_id=? FOR UPDATE`, input.RequirementID, projectID).Scan(&status); err != nil {
			return 0, err
		}
		switch status {
		case "draft", "in_review", "baselined", "change_pending":
			return input.RequirementID, nil
		}
		return 0, httperror.New(http.StatusConflict, "planning_handoff_requirement_readonly", "已废弃需求不能新增来源关联")
	}
	draft, err := parseProjectRequirementCreateInput(projectID, uid, map[string]any{
		"title": input.Title, "scopeNote": input.ScopeSummary, "source": "internal", "priority": "P2",
		"content": map[string]any{"kind": "module", "headingDepth": 2, "contentMd": input.ScopeSummary},
	})
	if err != nil {
		return 0, err
	}
	result, err := a.createProjectRequirementTx(ctx, tx, draft)
	if err != nil {
		return 0, err
	}
	id, ok := result["id"].(int64)
	if !ok || id <= 0 {
		return 0, httperror.New(http.StatusInternalServerError, "planning_handoff_requirement_invalid", "项目需求创建结果无效")
	}
	return id, nil
}
