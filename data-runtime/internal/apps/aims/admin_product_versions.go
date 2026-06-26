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
	if err := a.requireProductVersionAdmin(query, body); err != nil {
		return nil, err
	}
	productCode = strings.TrimSpace(productCode)
	versionCode := firstBodyText(body, "version_code", "versionCode")
	if productCode == "" || versionCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_fields", "product_code and version_code are required")
	}
	status := firstNonEmptyText(firstBodyText(body, "status"), "planning")
	if !validProductVersionStatus(status) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_version_status", "invalid product version status")
	}
	ownerProjectID, err := nullableAdminOptionalID(body, "owner_project_id", "ownerProjectId")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_owner_project_id", "owner_project_id must be a positive integer or null")
	}
	milestoneID, err := nullableAdminOptionalID(body, "milestone_id", "milestoneId")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "milestone_id must be a positive integer or null")
	}
	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO product_versions (
		  product_code, version_code, name, description, status, planned_release_date, milestone_id, owner_project_id, sort_order, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, productCode, versionCode, nullableText(firstBodyText(body, "name")),
		nullableText(firstBodyText(body, "description")),
		status,
		nullableText(firstBodyText(body, "planned_release_date", "plannedReleaseDate")),
		milestoneID,
		ownerProjectID,
		bodyIntDefault(body, 0, "sort_order", "sortOrder"),
		currentUserFrom(query, body))
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return map[string]any{"created": true}, nil
	}
	_ = a.insertVersionLog(ctx, nil, id, "created", "", status, currentUserFrom(query, body), "version created by admin")
	return a.adminProductVersionByID(ctx, id)
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
	if err := a.requireProductVersionAdmin(query, body); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	fields := []string{}
	args := []any{}
	if hasAnyBodyKey(body, "version_code", "versionCode") {
		versionCode := firstBodyText(body, "version_code", "versionCode")
		if versionCode == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_version_code", "version_code is required")
		}
		fields = append(fields, "version_code = ?")
		args = append(args, versionCode)
	}
	for _, spec := range []struct {
		column string
		keys   []string
	}{
		{"name", []string{"name"}},
		{"description", []string{"description"}},
	} {
		if hasAnyBodyKey(body, spec.keys...) {
			fields = append(fields, spec.column+" = ?")
			args = append(args, nullableText(firstBodyText(body, spec.keys...)))
		}
	}
	if hasAnyBodyKey(body, "planned_release_date", "plannedReleaseDate") {
		fields = append(fields, "planned_release_date = ?")
		args = append(args, nullableText(firstBodyText(body, "planned_release_date", "plannedReleaseDate")))
	}
	if hasAnyBodyKey(body, "owner_project_id", "ownerProjectId") {
		value, err := nullableAdminOptionalID(body, "owner_project_id", "ownerProjectId")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_owner_project_id", "owner_project_id must be a positive integer or null")
		}
		fields = append(fields, "owner_project_id = ?")
		args = append(args, value)
	}
	if hasAnyBodyKey(body, "milestone_id", "milestoneId") {
		value, err := nullableAdminOptionalID(body, "milestone_id", "milestoneId")
		if err != nil {
			return nil, httperror.New(http.StatusBadRequest, "invalid_milestone_id", "milestone_id must be a positive integer or null")
		}
		fields = append(fields, "milestone_id = ?")
		args = append(args, value)
	}
	if hasAnyBodyKey(body, "sort_order", "sortOrder") {
		fields = append(fields, "sort_order = ?")
		args = append(args, bodyIntDefault(body, 0, "sort_order", "sortOrder"))
	}
	if len(fields) == 0 {
		return a.adminProductVersionByID(ctx, versionID)
	}
	args = append(args, versionID)
	if _, err := a.DB().ExecContext(ctx, "UPDATE product_versions SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	_ = a.insertVersionLog(ctx, nil, versionID, "updated", "", "", currentUserFrom(query, body), "version updated by admin")
	return a.adminProductVersionByID(ctx, versionID)
}

func (a *Adapter) adminTransitionProductVersion(ctx context.Context, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, body); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	toStatus := firstBodyText(body, "to_status", "toStatus", "status")
	if toStatus == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_status", "to_status is required")
	}
	version, err := a.versionByID(ctx, versionID)
	if err != nil {
		return nil, err
	}
	fromStatus := fmt.Sprint(version["status"])
	if !validVersionTransition(fromStatus, toStatus) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_version_transition", "invalid version status transition")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	actor := currentUserFrom(query, body)
	if toStatus == "released" {
		if _, err := tx.ExecContext(ctx, "UPDATE product_versions SET status = ?, released_at = UTC_TIMESTAMP(), released_by = ? WHERE id = ?", toStatus, actor, versionID); err != nil {
			return nil, err
		}
	} else {
		if _, err := tx.ExecContext(ctx, "UPDATE product_versions SET status = ? WHERE id = ?", toStatus, versionID); err != nil {
			return nil, err
		}
	}
	if err := a.insertVersionLog(ctx, tx, versionID, "status_changed", fromStatus, toStatus, actor, "status transition by admin"); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.adminProductVersionByID(ctx, versionID)
}

func (a *Adapter) adminDeleteProductVersion(ctx context.Context, versionIDText string, query url.Values) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, nil); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	version, err := a.versionByID(ctx, versionID)
	if err != nil {
		return nil, err
	}
	if fmt.Sprint(version["status"]) != "planning" {
		return nil, httperror.New(http.StatusConflict, "version_not_planning", "only planning versions can be deleted")
	}
	checks := []struct {
		code string
		sql  string
	}{
		{"version_has_work_items", "SELECT COUNT(*) FROM work_items WHERE version_id = ?"},
		{"version_has_features", "SELECT COUNT(*) FROM product_version_features WHERE version_id = ?"},
		{"version_has_project_bindings", "SELECT COUNT(*) FROM aims_project_products WHERE version_id = ?"},
	}
	for _, check := range checks {
		var count int64
		if err := a.DB().QueryRowContext(ctx, check.sql, versionID).Scan(&count); err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, httperror.New(http.StatusConflict, check.code, "version cannot be deleted because it is still referenced")
		}
	}
	if _, err := a.DB().ExecContext(ctx, "DELETE FROM product_versions WHERE id = ?", versionID); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true, "id": versionID}, nil
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
	if err := a.requireProductVersionAdmin(query, body); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureVersionFeatureEditable(ctx, versionID); err != nil {
		return nil, err
	}
	title := firstBodyText(body, "title")
	if title == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_title", "title is required")
	}
	status := firstNonEmptyText(firstBodyText(body, "status"), "planned")
	if !validProductVersionFeatureStatus(status) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_feature_status", "invalid feature status")
	}
	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO product_version_features (
		  version_id, title, description, category, status, is_public, sort_order, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, versionID, title, nullableText(firstBodyText(body, "description")), nullableText(firstBodyText(body, "category")),
		status, boolToInt(defaultBodyBool(body, true, "is_public", "isPublic")),
		bodyIntDefault(body, 0, "sort_order", "sortOrder"), currentUserFrom(query, body))
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return map[string]any{"created": true}, nil
	}
	return a.featureByID(ctx, id)
}

func (a *Adapter) adminUpdateVersionFeature(ctx context.Context, versionIDText string, featureIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, body); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	featureID, err := parseID(featureIDText, "feature_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureFeatureBelongsToVersion(ctx, featureID, versionID); err != nil {
		return nil, err
	}
	if err := a.ensureVersionFeatureEditable(ctx, versionID); err != nil {
		return nil, err
	}
	fields := []string{}
	args := []any{}
	if hasAnyBodyKey(body, "title") {
		title := firstBodyText(body, "title")
		if title == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_title", "title is required")
		}
		fields = append(fields, "title = ?")
		args = append(args, title)
	}
	for _, spec := range []struct {
		column string
		keys   []string
	}{
		{"description", []string{"description"}},
		{"category", []string{"category"}},
	} {
		if hasAnyBodyKey(body, spec.keys...) {
			fields = append(fields, spec.column+" = ?")
			args = append(args, nullableText(firstBodyText(body, spec.keys...)))
		}
	}
	if hasAnyBodyKey(body, "status") {
		status := firstBodyText(body, "status")
		if !validProductVersionFeatureStatus(status) {
			return nil, httperror.New(http.StatusBadRequest, "invalid_feature_status", "invalid feature status")
		}
		fields = append(fields, "status = ?")
		args = append(args, status)
	}
	if hasAnyBodyKey(body, "is_public", "isPublic") {
		fields = append(fields, "is_public = ?")
		args = append(args, boolToInt(defaultBodyBool(body, true, "is_public", "isPublic")))
	}
	if hasAnyBodyKey(body, "sort_order", "sortOrder") {
		fields = append(fields, "sort_order = ?")
		args = append(args, bodyIntDefault(body, 0, "sort_order", "sortOrder"))
	}
	if len(fields) == 0 {
		return a.featureByID(ctx, featureID)
	}
	args = append(args, featureID)
	if _, err := a.DB().ExecContext(ctx, "UPDATE product_version_features SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	return a.featureByID(ctx, featureID)
}

func (a *Adapter) adminDeleteVersionFeature(ctx context.Context, versionIDText string, featureIDText string, query url.Values) (map[string]any, error) {
	if err := a.requireProductVersionAdmin(query, nil); err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	featureID, err := parseID(featureIDText, "feature_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureFeatureBelongsToVersion(ctx, featureID, versionID); err != nil {
		return nil, err
	}
	if err := a.ensureVersionFeatureEditable(ctx, versionID); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "UPDATE work_items SET feature_id = NULL WHERE feature_id = ?", featureID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM product_version_features WHERE id = ?", featureID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true, "id": featureID}, nil
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
