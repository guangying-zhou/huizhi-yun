package aims

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func adminProductVersionRest(path string) (string, bool) {
	const prefix = "/v1/aims/admin/product-versions/"
	if !strings.HasPrefix(path, prefix) {
		return "", false
	}
	rest := strings.TrimSpace(strings.TrimPrefix(path, prefix))
	if rest == "" {
		return "", false
	}
	return rest, true
}

func decodeProductVersionPathSegment(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return strings.TrimSpace(value)
	}
	return strings.TrimSpace(decoded)
}

func (a *Adapter) requireProductVersionAdmin(query url.Values, body map[string]any) error {
	if currentUserFrom(query, body) == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if strings.TrimSpace(query.Get("current_user_is_project_admin")) != "1" {
		return httperror.New(http.StatusForbidden, "admin_access_required", "Aims administrator access is required")
	}
	return nil
}

func (a *Adapter) adminProductVersions(ctx context.Context, productCode string, query url.Values) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, nil); err != nil {
		return nil, err
	}
	if strings.TrimSpace(productCode) == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_product_code", "product_code is required")
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  pv.id,
		  pv.product_code,
		  pv.version_code,
		  pv.name,
		  pv.description,
		  pv.status,
		  DATE_FORMAT(pv.planned_release_date, '%Y-%m-%d') AS planned_release_date,
		  DATE_FORMAT(pv.released_at, '%Y-%m-%d %H:%i:%s') AS released_at,
		  pv.released_by,
		  pv.milestone_id,
		  pv.owner_project_id,
		  p.project_code AS owner_project_code,
		  p.name AS owner_project_name,
		  pv.sort_order,
		  DATE_FORMAT(pv.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  DATE_FORMAT(pv.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
		  COALESCE(progress.target_count, 0) AS target_count,
		  COALESCE(progress.completed_count, 0) AS completed_count,
		  COALESCE(progress.total_weight, 0) AS total_weight,
		  COALESCE(progress.completed_weight, 0) AS completed_weight,
		  CASE WHEN COALESCE(progress.total_weight, 0) = 0 THEN 0
		       ELSE ROUND(progress.completed_weight / progress.total_weight * 100, 2)
		  END AS progress_percent,
		  COALESCE(features.feature_count, 0) AS feature_count,
		  COALESCE(features.delivered_feature_count, 0) AS delivered_feature_count
		FROM product_versions pv
		LEFT JOIN aims_projects p ON p.id = pv.owner_project_id
		LEFT JOIN (
		  SELECT
		    version_id,
		    COUNT(*) AS target_count,
		    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
		    COALESCE(SUM(weight), 0) AS total_weight,
		    COALESCE(SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END), 0) AS completed_weight
		  FROM work_items
		  WHERE tier = 'target' AND version_id IS NOT NULL
		  GROUP BY version_id
		) progress ON progress.version_id = pv.id
		LEFT JOIN (
		  SELECT
		    version_id,
		    COUNT(*) AS feature_count,
		    SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered_feature_count
		  FROM product_version_features
		  GROUP BY version_id
		) features ON features.version_id = pv.id
		WHERE pv.product_code = ?
		ORDER BY pv.sort_order ASC, pv.planned_release_date IS NULL, pv.planned_release_date ASC, pv.created_at DESC, pv.id DESC
	`, productCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) adminCreateProductVersion(ctx context.Context, productCode string, query url.Values, body map[string]any) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_create_retired", "版本管理已迁移到产品中心，请使用带产品权限、修订校验和幂等键的命令")
}

func (a *Adapter) adminProductVersionDetail(ctx context.Context, versionIDText string, query url.Values) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, nil); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	version, err := a.adminProductVersionByID(ctx, versionID)
	if err != nil {
		return nil, err
	}
	features, err := a.versionFeatures(ctx, versionID, false)
	if err != nil {
		return nil, err
	}
	logs, err := a.versionLogs(ctx, versionID)
	if err != nil {
		return nil, err
	}
	projects, err := a.versionAssociatedProjects(ctx, versionID, fmt.Sprint(version["product_code"]))
	if err != nil {
		return nil, err
	}
	version["features"] = features
	version["logs"] = logs
	version["projects"] = projects
	return version, nil
}

func (a *Adapter) adminUpdateProductVersion(ctx context.Context, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_edit_retired", "版本管理已迁移到产品中心，请使用带产品权限、修订校验和幂等键的命令")
}

func (a *Adapter) adminTransitionProductVersion(ctx context.Context, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_transition_retired", "版本状态管理已迁移到产品中心，请使用专用验收、发布和更正命令")
}

func (a *Adapter) adminDeleteProductVersion(ctx context.Context, versionIDText string, query url.Values) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_delete_retired", "版本删除已迁移到产品中心，请使用带产品权限、版本校验和幂等键的删除命令")
}

func (a *Adapter) adminListVersionFeatures(ctx context.Context, versionIDText string, query url.Values) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, nil); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	items, err := a.versionFeatures(ctx, versionID, false)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) adminCreateVersionFeature(ctx context.Context, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_scope_create_retired", "新增版本范围已迁移到产品中心，请先选择已决策的规划事项")
}

func (a *Adapter) adminUpdateVersionFeature(ctx context.Context, versionIDText string, featureIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_scope_edit_retired", "版本特性修改已迁移到产品中心，请使用范围编辑、交付确认及公开设置命令")
}

func (a *Adapter) adminDeleteVersionFeature(ctx context.Context, versionIDText string, featureIDText string, query url.Values) (map[string]any, error) {
	return nil, httperror.New(http.StatusGone, "legacy_product_version_scope_delete_retired", "旧版本范围删除入口已停用；请在产品中心保留原范围，通过顺延、重新验收或公开设置调整")
}

func (a *Adapter) adminProductVersionByID(ctx context.Context, versionID int64) (map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  pv.id,
		  pv.product_code,
		  pv.version_code,
		  pv.name,
		  pv.description,
		  pv.status,
		  DATE_FORMAT(pv.planned_release_date, '%Y-%m-%d') AS planned_release_date,
		  DATE_FORMAT(pv.released_at, '%Y-%m-%d %H:%i:%s') AS released_at,
		  pv.released_by,
		  pv.milestone_id,
		  pv.owner_project_id,
		  p.project_code AS owner_project_code,
		  p.name AS owner_project_name,
		  pv.sort_order,
		  pv.created_by,
		  DATE_FORMAT(pv.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  DATE_FORMAT(pv.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
		  COALESCE(progress.target_count, 0) AS target_count,
		  COALESCE(progress.completed_count, 0) AS completed_count,
		  COALESCE(progress.total_weight, 0) AS total_weight,
		  COALESCE(progress.completed_weight, 0) AS completed_weight,
		  CASE WHEN COALESCE(progress.total_weight, 0) = 0 THEN 0
		       ELSE ROUND(progress.completed_weight / progress.total_weight * 100, 2)
		  END AS progress_percent,
		  COALESCE(features.feature_count, 0) AS feature_count,
		  COALESCE(features.delivered_feature_count, 0) AS delivered_feature_count
		FROM product_versions pv
		LEFT JOIN aims_projects p ON p.id = pv.owner_project_id
		LEFT JOIN (
		  SELECT
		    version_id,
		    COUNT(*) AS target_count,
		    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
		    COALESCE(SUM(weight), 0) AS total_weight,
		    COALESCE(SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END), 0) AS completed_weight
		  FROM work_items
		  WHERE tier = 'target' AND version_id IS NOT NULL
		  GROUP BY version_id
		) progress ON progress.version_id = pv.id
		LEFT JOIN (
		  SELECT
		    version_id,
		    COUNT(*) AS feature_count,
		    SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered_feature_count
		  FROM product_version_features
		  GROUP BY version_id
		) features ON features.version_id = pv.id
		WHERE pv.id = ?
		LIMIT 1
	`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "version_not_found", "product version not found")
	}
	return items[0], nil
}

func nullableAdminOptionalID(body map[string]any, keys ...string) (any, error) {
	id, ok, err := optionalBodyID(body, keys...)
	if err != nil {
		return nil, err
	}
	if !ok || id == 0 {
		return nil, nil
	}
	return id, nil
}

func validProductVersionStatus(status string) bool {
	switch status {
	case "planning", "developing", "released", "archived":
		return true
	default:
		return false
	}
}

func validProductVersionFeatureStatus(status string) bool {
	switch status {
	case "planned", "delivered", "deferred":
		return true
	default:
		return false
	}
}
