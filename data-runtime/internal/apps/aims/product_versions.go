package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type aimsProjectAccess struct {
	ID        int64
	Code      string
	Name      string
	Category  string
	LeaderUID string
	Role      string
	IsMember  bool
	IsManager bool
}

func (a *Adapter) handleProductVersionRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if productCode, ok := pathParam(path, "/v1/aims/admin/products/", "/versions"); ok {
		productCode = decodeProductVersionPathSegment(productCode)
		switch method {
		case http.MethodGet:
			data, err := a.adminProductVersions(ctx, productCode, query)
			return data, "aims.admin.product_versions.list", true, err
		case http.MethodPost:
			data, err := a.adminCreateProductVersion(ctx, productCode, query, body)
			return data, "aims.admin.product_versions.create", true, err
		}
	}
	if versionRest, ok := adminProductVersionRest(path); ok {
		switch {
		case strings.HasSuffix(versionRest, "/transition") && method == http.MethodPost:
			versionID := strings.TrimSuffix(versionRest, "/transition")
			data, err := a.adminTransitionProductVersion(ctx, versionID, query, body)
			return data, "aims.admin.product_versions.transition", true, err
		case strings.HasSuffix(versionRest, "/features") && method == http.MethodGet:
			versionID := strings.TrimSuffix(versionRest, "/features")
			data, err := a.adminListVersionFeatures(ctx, versionID, query)
			return data, "aims.admin.product_version_features.list", true, err
		case strings.HasSuffix(versionRest, "/features") && method == http.MethodPost:
			versionID := strings.TrimSuffix(versionRest, "/features")
			data, err := a.adminCreateVersionFeature(ctx, versionID, query, body)
			return data, "aims.admin.product_version_features.create", true, err
		case strings.Contains(versionRest, "/features/") && (method == http.MethodPut || method == http.MethodPatch):
			parts := strings.Split(versionRest, "/features/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(parts[1], "/") {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			data, err := a.adminUpdateVersionFeature(ctx, parts[0], parts[1], query, body)
			return data, "aims.admin.product_version_features.update", true, err
		case strings.Contains(versionRest, "/features/") && method == http.MethodDelete:
			parts := strings.Split(versionRest, "/features/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(parts[1], "/") {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			data, err := a.adminDeleteVersionFeature(ctx, parts[0], parts[1], query)
			return data, "aims.admin.product_version_features.delete", true, err
		case strings.Contains(versionRest, "/"):
			return nil, "", false, nil
		case method == http.MethodGet:
			data, err := a.adminProductVersionDetail(ctx, versionRest, query)
			return data, "aims.admin.product_versions.detail", true, err
		case method == http.MethodPut || method == http.MethodPatch:
			data, err := a.adminUpdateProductVersion(ctx, versionRest, query, body)
			return data, "aims.admin.product_versions.update", true, err
		case method == http.MethodDelete:
			data, err := a.adminDeleteProductVersion(ctx, versionRest, query)
			return data, "aims.admin.product_versions.delete", true, err
		}
	}

	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/products"); ok {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectProducts(ctx, projectID, query)
			return data, "aims.project_products.list", true, err
		case http.MethodPost:
			data, err := a.saveProjectProduct(ctx, projectID, "", query, body)
			return data, "aims.project_products.create", true, err
		}
	}
	if projectID, productCode, ok := projectNestedRest(path, "/v1/aims/projects/", "/products/"); ok {
		if strings.HasSuffix(productCode, "/primary") {
			productCode = strings.TrimSuffix(productCode, "/primary")
			if productCode == "" || strings.Contains(productCode, "/") {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			if method == http.MethodPut {
				data, err := a.setPrimaryProjectProduct(ctx, projectID, productCode, query)
				return data, "aims.project_products.primary", true, err
			}
		}
		if strings.Contains(productCode, "/") {
			return nil, "", false, nil
		}
		switch method {
		case http.MethodPut, http.MethodPatch:
			data, err := a.saveProjectProduct(ctx, projectID, productCode, query, body)
			return data, "aims.project_products.update", true, err
		case http.MethodDelete:
			data, err := a.deleteProjectProduct(ctx, projectID, productCode, query)
			return data, "aims.project_products.delete", true, err
		}
	}

	if projectID, ok := pathParam(path, "/v1/aims/projects/", "/releases"); ok {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectReleases(ctx, projectID, query)
			return data, "aims.product_versions.list", true, err
		case http.MethodPost:
			data, err := a.createProductVersion(ctx, projectID, query, body)
			return data, "aims.product_versions.create", true, err
		}
	}
	if projectID, versionID, ok := projectNestedRest(path, "/v1/aims/projects/", "/releases/"); ok {
		switch {
		case strings.HasSuffix(versionID, "/claim") && method == http.MethodPost:
			versionID = strings.TrimSuffix(versionID, "/claim")
			data, err := a.claimProductVersion(ctx, projectID, versionID, query)
			return data, "aims.product_versions.claim", true, err
		case strings.HasSuffix(versionID, "/transition") && method == http.MethodPost:
			versionID = strings.TrimSuffix(versionID, "/transition")
			data, err := a.transitionProductVersion(ctx, projectID, versionID, query, body)
			return data, "aims.product_versions.transition", true, err
		case strings.HasSuffix(versionID, "/items") && method == http.MethodPost:
			versionID = strings.TrimSuffix(versionID, "/items")
			data, err := a.attachVersionItems(ctx, projectID, versionID, query, body)
			return data, "aims.product_version_items.attach", true, err
		case strings.Contains(versionID, "/items/") && method == http.MethodDelete:
			parts := strings.Split(versionID, "/items/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(parts[1], "/") {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			data, err := a.detachVersionItem(ctx, projectID, parts[0], parts[1], query)
			return data, "aims.product_version_items.detach", true, err
		case strings.HasSuffix(versionID, "/features") && method == http.MethodGet:
			versionID = strings.TrimSuffix(versionID, "/features")
			data, err := a.listVersionFeatures(ctx, projectID, versionID, query)
			return data, "aims.product_version_features.list", true, err
		case strings.HasSuffix(versionID, "/features") && method == http.MethodPost:
			versionID = strings.TrimSuffix(versionID, "/features")
			data, err := a.createVersionFeature(ctx, projectID, versionID, query, body)
			return data, "aims.product_version_features.create", true, err
		case strings.Contains(versionID, "/features/") && (method == http.MethodPut || method == http.MethodPatch):
			parts := strings.Split(versionID, "/features/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(parts[1], "/") {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			data, err := a.updateVersionFeature(ctx, projectID, parts[0], parts[1], query, body)
			return data, "aims.product_version_features.update", true, err
		case strings.Contains(versionID, "/features/") && method == http.MethodDelete:
			parts := strings.Split(versionID, "/features/")
			if len(parts) != 2 || parts[0] == "" || parts[1] == "" || strings.Contains(parts[1], "/") {
				return nil, "", true, httperror.New(http.StatusNotFound, "not_found", "Route not found")
			}
			data, err := a.deleteVersionFeature(ctx, projectID, parts[0], parts[1], query)
			return data, "aims.product_version_features.delete", true, err
		case strings.Contains(versionID, "/"):
			return nil, "", false, nil
		case method == http.MethodGet:
			data, err := a.productVersionDetail(ctx, projectID, versionID, query)
			return data, "aims.product_versions.detail", true, err
		case method == http.MethodPut || method == http.MethodPatch:
			data, err := a.updateProductVersion(ctx, projectID, versionID, query, body)
			return data, "aims.product_versions.update", true, err
		case method == http.MethodDelete:
			data, err := a.deleteProductVersion(ctx, projectID, versionID, query)
			return data, "aims.product_versions.delete", true, err
		}
	}

	if productCode, ok := pathParam(path, "/v1/aims/service/products/", "/versions"); ok && method == http.MethodGet {
		data, err := a.serviceProductVersions(ctx, productCode, query)
		return data, "aims.service.product_versions.list", true, err
	}

	return nil, "", false, nil
}

func projectNestedRest(path string, prefix string, separator string) (string, string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.SplitN(rest, separator, 2)
	if len(parts) != 2 {
		return "", "", false
	}
	projectID := strings.TrimSpace(parts[0])
	nested := strings.TrimSpace(parts[1])
	if projectID == "" || nested == "" || strings.Contains(projectID, "/") {
		return "", "", false
	}
	return projectID, nested, true
}

func (a *Adapter) listProjectProducts(ctx context.Context, projectIDText string, query url.Values) (map[string]any, error) {
	projectID, access, err := a.requireProjectMember(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  app.id,
		  app.project_id,
		  app.product_code,
		  app.product_name,
		  app.version_id,
		  app.is_primary,
		  DATE_FORMAT(app.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  pv.version_code,
		  pv.name AS version_name,
		  pv.status AS version_status
		FROM aims_project_products app
		LEFT JOIN product_versions pv ON pv.id = app.version_id
		WHERE app.project_id = ?
		ORDER BY app.is_primary DESC, app.product_code ASC, app.id ASC
	`, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "project": accessMap(access)}, nil
}

func (a *Adapter) saveProjectProduct(ctx context.Context, projectIDText string, productCodePath string, query url.Values, body map[string]any) (map[string]any, error) {
	projectID, access, err := a.requireProjectManager(ctx, projectIDText, query, body)
	if err != nil {
		return nil, err
	}
	if !productAssociableCategory(access.Category) {
		return nil, httperror.New(http.StatusForbidden, "project_category_not_allowed", "project category cannot associate products")
	}
	productCode := strings.TrimSpace(productCodePath)
	if productCode == "" {
		productCode = firstBodyText(body, "product_code", "productCode")
	}
	if productCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_product_code", "product_code is required")
	}
	productName := firstBodyText(body, "product_name", "productName")
	versionID, hasVersion, err := optionalBodyID(body, "version_id", "versionId")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_version_id", "version_id must be a positive integer or null")
	}
	var storedVersion any
	if hasVersion && versionID > 0 {
		versionProductCode, err := a.versionProductCode(ctx, versionID)
		if err != nil {
			return nil, err
		}
		if versionProductCode != productCode {
			return nil, httperror.New(http.StatusBadRequest, "version_product_mismatch", "version does not belong to product")
		}
		if err := a.ensureNoOtherVersionItems(ctx, projectID, productCode, versionID); err != nil {
			return nil, err
		}
		storedVersion = versionID
	}
	if hasVersion && versionID == 0 {
		storedVersion = nil
	}
	if !hasVersion {
		storedVersion = nil
	}
	isPrimary := bodyBool(body, "is_primary", "isPrimary")
	if productCodePath == "" && !hasAnyBodyKey(body, "is_primary", "isPrimary") {
		isPrimary = true
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if isPrimary {
		if _, err := tx.ExecContext(ctx, "UPDATE aims_project_products SET is_primary = 0 WHERE project_id = ?", projectID); err != nil {
			return nil, err
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO aims_project_products (project_id, product_code, product_name, version_id, is_primary, created_by)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  product_name = COALESCE(VALUES(product_name), product_name),
		  version_id = VALUES(version_id),
		  is_primary = VALUES(is_primary)
	`, projectID, productCode, nullableText(productName), storedVersion, boolToInt(isPrimary), currentUserFrom(query, body))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.projectProductByCode(ctx, projectID, productCode)
}

func (a *Adapter) setPrimaryProjectProduct(ctx context.Context, projectIDText string, productCode string, query url.Values) (map[string]any, error) {
	projectID, _, err := a.requireProjectManager(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	exists, err := a.projectProductExists(ctx, projectID, productCode)
	if err != nil {
		return nil, err
	}
	if !exists {
		return nil, httperror.New(http.StatusNotFound, "project_product_not_found", "project product association not found")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "UPDATE aims_project_products SET is_primary = 0 WHERE project_id = ?", projectID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE aims_project_products SET is_primary = 1 WHERE project_id = ? AND product_code = ?", projectID, productCode); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.projectProductByCode(ctx, projectID, productCode)
}

func (a *Adapter) deleteProjectProduct(ctx context.Context, projectIDText string, productCode string, query url.Values) (map[string]any, error) {
	projectID, _, err := a.requireProjectManager(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	var count int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM work_items wi
		JOIN product_versions pv ON pv.id = wi.version_id
		WHERE wi.project_id = ? AND pv.product_code = ?
	`, projectID, productCode).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, httperror.New(http.StatusConflict, "project_product_in_use", "product has versioned work items in this project")
	}
	result, err := a.DB().ExecContext(ctx, "DELETE FROM aims_project_products WHERE project_id = ? AND product_code = ?", projectID, productCode)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "project_product_not_found", "project product association not found")
	}
	return map[string]any{"deleted": true, "product_code": productCode}, nil
}

func (a *Adapter) listProjectReleases(ctx context.Context, projectIDText string, query url.Values) (map[string]any, error) {
	projectID, _, err := a.requireProjectMember(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	where := []string{`
		EXISTS (
		  SELECT 1 FROM aims_project_products app
		  WHERE app.project_id = ?
		    AND app.product_code = pv.product_code
		    AND (app.version_id IS NULL OR app.version_id = pv.id)
		)`}
	args := []any{projectID}
	if productCode := strings.TrimSpace(query.Get("product_code")); productCode != "" {
		where = append(where, "pv.product_code = ?")
		args = append(args, productCode)
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "pv.status = ?")
		args = append(args, status)
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  pv.id,
		  pv.product_code,
		  COALESCE(app_primary.product_name, app_any.product_name) AS product_name,
		  pv.version_code,
		  pv.name,
		  pv.description,
		  pv.status,
		  DATE_FORMAT(pv.planned_release_date, '%Y-%m-%d') AS planned_release_date,
		  DATE_FORMAT(pv.released_at, '%Y-%m-%d %H:%i:%s') AS released_at,
		  pv.released_by,
		  pv.milestone_id,
		  pv.owner_project_id,
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
		LEFT JOIN aims_project_products app_primary
		  ON app_primary.project_id = ? AND app_primary.product_code = pv.product_code AND app_primary.is_primary = 1
		LEFT JOIN aims_project_products app_any
		  ON app_any.project_id = ? AND app_any.product_code = pv.product_code
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
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY pv.product_code ASC, pv.sort_order ASC, pv.created_at DESC, pv.id DESC
	`, append([]any{projectID, projectID}, args...)...)
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

func (a *Adapter) createProductVersion(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	projectID, access, err := a.requireProjectManager(ctx, projectIDText, query, body)
	if err != nil {
		return nil, err
	}
	if access.Category != "product_dev" {
		return nil, httperror.New(http.StatusForbidden, "project_category_not_allowed", "only product_dev projects can create versions")
	}
	productCode := firstBodyText(body, "product_code", "productCode")
	versionCode := firstBodyText(body, "version_code", "versionCode")
	if productCode == "" || versionCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_fields", "product_code and version_code are required")
	}
	ok, err := a.projectProductExists(ctx, projectID, productCode)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, httperror.New(http.StatusForbidden, "product_not_associated", "project is not associated with product")
	}
	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO product_versions (
		  product_code, version_code, name, description, status, planned_release_date, milestone_id, owner_project_id, sort_order, created_by
		) VALUES (?, ?, ?, ?, 'planning', ?, ?, ?, ?, ?)
	`, productCode, versionCode, nullableText(firstBodyText(body, "name")), nullableText(firstBodyText(body, "description")),
		nullableText(firstBodyText(body, "planned_release_date", "plannedReleaseDate")), nullableOptionalID(body, "milestone_id", "milestoneId"),
		projectID, bodyIntDefault(body, 0, "sort_order", "sortOrder"), currentUserFrom(query, body))
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return map[string]any{"created": true}, nil
	}
	_ = a.insertVersionLog(ctx, nil, id, "created", "", "planning", currentUserFrom(query, body), "version created")
	return a.versionByID(ctx, id)
}

func (a *Adapter) createProjectWithProductBinding(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	uid := currentUserFrom(query, body)
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	projectCode := firstBodyText(body, "project_code", "projectCode")
	name := firstBodyText(body, "name")
	shortName := firstBodyText(body, "short_name", "shortName")
	if projectCode == "" || name == "" || shortName == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_fields", "project_code, name and short_name are required")
	}
	var duplicate int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects WHERE project_code = ? AND lifecycle_status <> 'archived'", projectCode).Scan(&duplicate); err != nil {
		return nil, err
	}
	if duplicate > 0 {
		return nil, httperror.New(http.StatusConflict, "project_code_exists", "project_code is already used")
	}

	category := firstNonEmptyText(firstBodyText(body, "category"), "product_dev")
	binding := bodyMap(body, "product_binding", "productBinding")
	if binding != nil && category != "product_dev" {
		return nil, httperror.New(http.StatusForbidden, "project_category_not_allowed", "product_binding is only supported for product_dev projects")
	}
	requestedTemplateVersionID, err := int64BodyValueOrZero(body, "template_version_id", "templateVersionId")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_template_version_id", "template_version_id must be a positive integer")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	templateVersion, err := resolveProjectTemplateVersionTx(ctx, tx, category, requestedTemplateVersionID)
	if err != nil {
		return nil, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO aims_projects (
		  project_code, name, short_name, internal_code, description, category, methodology,
		  portfolio_id, domain_code, dept_code, leader_uid, security_level, access_whitelist,
		  start_date, end_date, opp_id, contract_id, customer_code, customer_name, contract_code,
		  module_config, board_config, workflow_config, notification_config,
		  template_set_id, template_version_id, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, projectCode, name, shortName,
		nullableText(firstBodyText(body, "internal_code", "internalCode")),
		nullableText(firstBodyText(body, "description")),
		category,
		firstNonEmptyText(firstBodyText(body, "methodology"), "PIVR"),
		nullableOptionalID(body, "portfolio_id", "portfolioId"),
		nullableText(firstBodyText(body, "domain_code", "domainCode")),
		nullableText(firstBodyText(body, "dept_code", "deptCode")),
		nullableText(firstBodyText(body, "leader_uid", "leaderUid")),
		firstNonEmptyText(firstBodyText(body, "security_level", "securityLevel"), "company"),
		nullableText(bodyJSONText(body, "access_whitelist", "accessWhitelist")),
		nullableText(firstBodyText(body, "start_date", "startDate")),
		nullableText(firstBodyText(body, "end_date", "endDate")),
		nullableOptionalID(body, "opp_id", "oppId"),
		nullableOptionalID(body, "contract_id", "contractId"),
		nullableText(firstBodyText(body, "customer_code", "customerCode")),
		nullableText(firstBodyText(body, "customer_name", "customerName")),
		nullableText(firstBodyText(body, "contract_code", "contractCode")),
		nullableText(bodyJSONText(body, "module_config", "moduleConfig")),
		nullableText(bodyJSONText(body, "board_config", "boardConfig")),
		nullableText(bodyJSONText(body, "workflow_config", "workflowConfig")),
		nullableText(bodyJSONText(body, "notification_config", "notificationConfig")),
		templateVersion.TemplateSetID,
		templateVersion.TemplateVersionID,
		uid)
	if err != nil {
		return nil, err
	}
	projectID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO project_counters (project_id, counter) VALUES (?, 0)", projectID); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO aims_project_members (project_id, uid, role, status) VALUES (?, ?, 'manager', 'active')", projectID, uid); err != nil {
		return nil, err
	}
	if err := instantiateProjectFromTemplateTx(ctx, tx, projectID, projectCode, uid, templateVersion.Definition, excludedTemplateWorkItemKeys(body)); err != nil {
		return nil, err
	}

	var versionID any
	if binding != nil {
		productCode := firstBodyText(binding, "product_code", "productCode")
		mode := firstNonEmptyText(firstBodyText(binding, "mode"), "all_versions")
		if productCode == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_product_code", "product_binding.product_code is required")
		}
		switch mode {
		case "new_version":
			versionCode := firstBodyText(binding, "version_code", "versionCode")
			if versionCode == "" {
				return nil, httperror.New(http.StatusBadRequest, "missing_version_code", "product_binding.version_code is required")
			}
			versionResult, err := tx.ExecContext(ctx, `
				INSERT INTO product_versions (
				  product_code, version_code, name, status, planned_release_date, milestone_id, owner_project_id, created_by
				) VALUES (?, ?, ?, 'planning', ?, ?, ?, ?)
			`, productCode, versionCode, nullableText(firstBodyText(binding, "name")), nullableText(firstBodyText(binding, "planned_release_date", "plannedReleaseDate")), nullableOptionalID(binding, "milestone_id", "milestoneId"), projectID, uid)
			if err != nil {
				return nil, err
			}
			newVersionID, err := versionResult.LastInsertId()
			if err != nil {
				return nil, err
			}
			versionID = newVersionID
			if err := a.insertVersionLog(ctx, tx, newVersionID, "created", "", "planning", uid, "version created with project"); err != nil {
				return nil, err
			}
		case "existing_version":
			existingVersionID, ok, err := optionalBodyID(binding, "version_id", "versionId")
			if err != nil || !ok || existingVersionID == 0 {
				return nil, httperror.New(http.StatusBadRequest, "missing_version_id", "product_binding.version_id is required")
			}
			versionProductCode, err := a.versionProductCodeTx(ctx, tx, existingVersionID)
			if err != nil {
				return nil, err
			}
			if versionProductCode != productCode {
				return nil, httperror.New(http.StatusBadRequest, "version_product_mismatch", "version does not belong to product")
			}
			versionID = existingVersionID
		case "all_versions":
			versionID = nil
		default:
			return nil, httperror.New(http.StatusBadRequest, "invalid_product_binding_mode", "invalid product_binding.mode")
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO aims_project_products (project_id, product_code, product_name, version_id, is_primary, created_by)
			VALUES (?, ?, ?, ?, 1, ?)
		`, projectID, productCode, nullableText(firstBodyText(binding, "product_name", "productName")), versionID, uid); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.projectDetail(ctx, strconv.FormatInt(projectID, 10), query)
}

func (a *Adapter) productVersionDetail(ctx context.Context, projectIDText string, versionIDText string, query url.Values) (map[string]any, error) {
	projectID, _, err := a.requireProjectMember(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return nil, err
	}
	version, err := a.versionByID(ctx, versionID)
	if err != nil {
		return nil, err
	}
	features, err := a.versionFeatures(ctx, versionID, false)
	if err != nil {
		return nil, err
	}
	items, err := a.versionWorkItems(ctx, versionID, projectID)
	if err != nil {
		return nil, err
	}
	logs, err := a.versionLogs(ctx, versionID)
	if err != nil {
		return nil, err
	}
	version["features"] = features
	version["items"] = items
	version["logs"] = logs
	return version, nil
}

func (a *Adapter) updateProductVersion(ctx context.Context, projectIDText string, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	_, versionID, err := a.requireVersionOwnerManager(ctx, projectIDText, versionIDText, query, body)
	if err != nil {
		return nil, err
	}
	fields := []string{}
	args := []any{}
	addTextField := func(bodyKeys []string, column string) {
		if !hasAnyBodyKey(body, bodyKeys...) {
			return
		}
		value := firstBodyText(body, bodyKeys...)
		fields = append(fields, column+" = ?")
		args = append(args, nullableText(value))
	}
	addTextField([]string{"version_code", "versionCode"}, "version_code")
	addTextField([]string{"name"}, "name")
	addTextField([]string{"description"}, "description")
	if hasAnyBodyKey(body, "planned_release_date", "plannedReleaseDate") {
		fields = append(fields, "planned_release_date = ?")
		args = append(args, nullableText(firstBodyText(body, "planned_release_date", "plannedReleaseDate")))
	}
	if hasAnyBodyKey(body, "milestone_id", "milestoneId") {
		fields = append(fields, "milestone_id = ?")
		args = append(args, nullableOptionalID(body, "milestone_id", "milestoneId"))
	}
	if hasAnyBodyKey(body, "sort_order", "sortOrder") {
		fields = append(fields, "sort_order = ?")
		args = append(args, bodyIntDefault(body, 0, "sort_order", "sortOrder"))
	}
	if len(fields) == 0 {
		return a.versionByID(ctx, versionID)
	}
	args = append(args, versionID)
	if _, err := a.DB().ExecContext(ctx, "UPDATE product_versions SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	_ = a.insertVersionLog(ctx, nil, versionID, "updated", "", "", currentUserFrom(query, body), "version updated")
	return a.versionByID(ctx, versionID)
}

func (a *Adapter) transitionProductVersion(ctx context.Context, projectIDText string, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	_, versionID, err := a.requireVersionOwnerManager(ctx, projectIDText, versionIDText, query, body)
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
	if err := a.insertVersionLog(ctx, tx, versionID, "status_changed", fromStatus, toStatus, actor, "status transition"); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.versionByID(ctx, versionID)
}

func (a *Adapter) claimProductVersion(ctx context.Context, projectIDText string, versionIDText string, query url.Values) (map[string]any, error) {
	projectID, access, err := a.requireProjectManager(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	if access.Category != "product_dev" {
		return nil, httperror.New(http.StatusForbidden, "project_category_not_allowed", "only product_dev projects can claim versions")
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	version, err := a.versionByID(ctx, versionID)
	if err != nil {
		return nil, err
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return nil, err
	}
	ownerID := int64FromMap(version, "owner_project_id")
	if ownerID > 0 {
		var exists int
		if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_projects WHERE id = ?", ownerID).Scan(&exists); err != nil {
			return nil, err
		}
		if exists > 0 {
			return nil, httperror.New(http.StatusConflict, "version_owner_still_exists", "version owner project still exists")
		}
	}
	if _, err := a.DB().ExecContext(ctx, "UPDATE product_versions SET owner_project_id = ? WHERE id = ?", projectID, versionID); err != nil {
		return nil, err
	}
	_ = a.insertVersionLog(ctx, nil, versionID, "claimed", fmt.Sprint(ownerID), fmt.Sprint(projectID), strings.TrimSpace(query.Get("current_user")), "version owner claimed")
	return a.versionByID(ctx, versionID)
}

func (a *Adapter) deleteProductVersion(ctx context.Context, projectIDText string, versionIDText string, query url.Values) (map[string]any, error) {
	_, versionID, err := a.requireVersionOwnerManager(ctx, projectIDText, versionIDText, query, nil)
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

func (a *Adapter) attachVersionItems(ctx context.Context, projectIDText string, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	projectID, _, err := a.requireProjectMember(ctx, projectIDText, query, body)
	if err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return nil, err
	}
	version, err := a.versionByID(ctx, versionID)
	if err != nil {
		return nil, err
	}
	status := fmt.Sprint(version["status"])
	if status != "planning" && status != "developing" {
		return nil, httperror.New(http.StatusConflict, "version_not_editable", "version does not accept work items")
	}
	featureID, hasFeature, err := optionalBodyID(body, "feature_id", "featureId")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_feature_id", "feature_id must be a positive integer or null")
	}
	if hasFeature && featureID > 0 {
		if err := a.ensureFeatureBelongsToVersion(ctx, featureID, versionID); err != nil {
			return nil, err
		}
	}
	itemIDs, err := bodyIDList(body, "work_item_ids", "workItemIds")
	if err != nil {
		return nil, err
	}
	if len(itemIDs) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_work_items", "work_item_ids is required")
	}
	for _, itemID := range itemIDs {
		if err := a.ensureAttachableWorkItem(ctx, projectID, itemID); err != nil {
			return nil, err
		}
	}
	featureValue := any(nil)
	if hasFeature && featureID > 0 {
		featureValue = featureID
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, itemID := range itemIDs {
		if _, err := tx.ExecContext(ctx, "UPDATE work_items SET version_id = ?, feature_id = ? WHERE id = ? AND project_id = ? AND tier = 'target'", versionID, featureValue, itemID, projectID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"attached": len(itemIDs), "version_id": versionID}, nil
}

func (a *Adapter) detachVersionItem(ctx context.Context, projectIDText string, versionIDText string, workItemIDText string, query url.Values) (map[string]any, error) {
	projectID, _, err := a.requireProjectMember(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	workItemID, err := parseID(workItemIDText, "work_item_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return nil, err
	}
	result, err := a.DB().ExecContext(ctx, "UPDATE work_items SET version_id = NULL, feature_id = NULL WHERE id = ? AND project_id = ? AND version_id = ?", workItemID, projectID, versionID)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "version_item_not_found", "work item is not attached to version")
	}
	return map[string]any{"detached": true, "work_item_id": workItemID}, nil
}

func (a *Adapter) updateWorkItemVersionFields(ctx context.Context, workItemIDText string, query url.Values, body map[string]any) error {
	workItemID, err := parseID(workItemIDText, "work_item_id")
	if err != nil {
		return err
	}
	uid := currentUserFrom(query, body)
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	var projectID int64
	var tier string
	var currentVersionID sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT project_id, tier, version_id
		FROM work_items
		WHERE id = ?
	`, workItemID).Scan(&projectID, &tier, &currentVersionID); err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "work_item_not_found", "work item not found")
	} else if err != nil {
		return err
	}
	if tier != "target" {
		return httperror.New(http.StatusBadRequest, "work_item_tier_not_allowed", "only target work items can be attached to versions")
	}
	access, err := a.projectAccess(ctx, projectID, uid)
	if err != nil {
		return err
	}
	if !access.IsMember {
		return httperror.New(http.StatusForbidden, "project_access_denied", "project member access required")
	}

	versionID := int64(0)
	if currentVersionID.Valid {
		versionID = currentVersionID.Int64
	}
	if hasAnyBodyKey(body, "version_id", "versionId") {
		parsed, _, err := optionalBodyID(body, "version_id", "versionId")
		if err != nil {
			return httperror.New(http.StatusBadRequest, "invalid_version_id", "version_id must be a positive integer or null")
		}
		versionID = parsed
	}

	featureID := int64(0)
	if hasAnyBodyKey(body, "feature_id", "featureId") {
		parsed, _, err := optionalBodyID(body, "feature_id", "featureId")
		if err != nil {
			return httperror.New(http.StatusBadRequest, "invalid_feature_id", "feature_id must be a positive integer or null")
		}
		featureID = parsed
	}

	if versionID == 0 {
		if _, err := a.DB().ExecContext(ctx, "UPDATE work_items SET version_id = NULL, feature_id = NULL WHERE id = ?", workItemID); err != nil {
			return err
		}
		return nil
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return err
	}
	version, err := a.versionByID(ctx, versionID)
	if err != nil {
		return err
	}
	status := fmt.Sprint(version["status"])
	if status != "planning" && status != "developing" {
		return httperror.New(http.StatusConflict, "version_not_editable", "version does not accept work items")
	}
	if featureID > 0 {
		if err := a.ensureFeatureBelongsToVersion(ctx, featureID, versionID); err != nil {
			return err
		}
	}

	featureValue := any(nil)
	if featureID > 0 {
		featureValue = featureID
	}
	_, err = a.DB().ExecContext(ctx, "UPDATE work_items SET version_id = ?, feature_id = ? WHERE id = ?", versionID, featureValue, workItemID)
	return err
}

func (a *Adapter) listVersionFeatures(ctx context.Context, projectIDText string, versionIDText string, query url.Values) (map[string]any, error) {
	projectID, _, err := a.requireProjectMember(ctx, projectIDText, query, nil)
	if err != nil {
		return nil, err
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return nil, err
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return nil, err
	}
	items, err := a.versionFeatures(ctx, versionID, false)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) createVersionFeature(ctx context.Context, projectIDText string, versionIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	_, versionID, err := a.requireVersionOwnerManager(ctx, projectIDText, versionIDText, query, body)
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
	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO product_version_features (
		  version_id, title, description, category, status, is_public, sort_order, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, versionID, title, nullableText(firstBodyText(body, "description")), nullableText(firstBodyText(body, "category")),
		firstNonEmptyText(firstBodyText(body, "status"), "planned"), boolToInt(defaultBodyBool(body, true, "is_public", "isPublic")),
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

func (a *Adapter) updateVersionFeature(ctx context.Context, projectIDText string, versionIDText string, featureIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	_, versionID, err := a.requireVersionOwnerManager(ctx, projectIDText, versionIDText, query, body)
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
	for _, spec := range []struct {
		column string
		keys   []string
	}{
		{"title", []string{"title"}},
		{"description", []string{"description"}},
		{"category", []string{"category"}},
		{"status", []string{"status"}},
	} {
		if hasAnyBodyKey(body, spec.keys...) {
			fields = append(fields, spec.column+" = ?")
			args = append(args, nullableText(firstBodyText(body, spec.keys...)))
		}
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

func (a *Adapter) deleteVersionFeature(ctx context.Context, projectIDText string, versionIDText string, featureIDText string, query url.Values) (map[string]any, error) {
	_, versionID, err := a.requireVersionOwnerManager(ctx, projectIDText, versionIDText, query, nil)
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

func (a *Adapter) serviceProductVersions(ctx context.Context, productCode string, query url.Values) (map[string]any, error) {
	query.Set("product_code", productCode)
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
		  pv.owner_project_id,
		  p.project_code AS owner_project_code,
		  p.name AS owner_project_name,
		  COALESCE(progress.target_count, 0) AS target_count,
		  COALESCE(progress.completed_count, 0) AS completed_count,
		  COALESCE(progress.total_weight, 0) AS total_weight,
		  COALESCE(progress.completed_weight, 0) AS completed_weight,
		  CASE WHEN COALESCE(progress.total_weight, 0) = 0 THEN 0
		       ELSE ROUND(progress.completed_weight / progress.total_weight * 100, 2)
		  END AS progress_percent
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
		  WHERE is_public = 1
		  GROUP BY version_id
		) features ON features.version_id = pv.id
		WHERE pv.product_code = ?
		ORDER BY pv.sort_order ASC, pv.created_at DESC, pv.id DESC
	`, productCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	for _, item := range items {
		id := int64FromMap(item, "id")
		features, err := a.versionFeatures(ctx, id, true)
		if err != nil {
			return nil, err
		}
		projects, err := a.versionAssociatedProjects(ctx, id, fmt.Sprint(item["product_code"]))
		if err != nil {
			return nil, err
		}
		item["features"] = features
		item["projects"] = projects
	}
	return map[string]any{"items": items}, nil
}

func (a *Adapter) requireProjectMember(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (int64, aimsProjectAccess, error) {
	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return 0, aimsProjectAccess{}, err
	}
	uid := currentUserFrom(query, body)
	if uid == "" {
		return 0, aimsProjectAccess{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	access, err := a.projectAccess(ctx, projectID, uid)
	if err != nil {
		return 0, aimsProjectAccess{}, err
	}
	if !access.IsMember {
		if currentUserIsProjectAdmin(query) {
			access.IsMember = true
			access.IsManager = true
			return projectID, access, nil
		}
		return 0, aimsProjectAccess{}, httperror.New(http.StatusForbidden, "project_access_denied", "project member access required")
	}
	if currentUserIsProjectAdmin(query) {
		access.IsManager = true
	}
	return projectID, access, nil
}

func (a *Adapter) requireProjectManager(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (int64, aimsProjectAccess, error) {
	projectID, access, err := a.requireProjectMember(ctx, projectIDText, query, body)
	if err != nil {
		return 0, aimsProjectAccess{}, err
	}
	if !access.IsManager {
		return 0, aimsProjectAccess{}, httperror.New(http.StatusForbidden, "project_manager_required", "project manager access required")
	}
	return projectID, access, nil
}

func (a *Adapter) requireVersionOwnerManager(ctx context.Context, projectIDText string, versionIDText string, query url.Values, body map[string]any) (int64, int64, error) {
	projectID, access, err := a.requireProjectManager(ctx, projectIDText, query, body)
	if err != nil {
		return 0, 0, err
	}
	if access.Category != "product_dev" {
		return 0, 0, httperror.New(http.StatusForbidden, "project_category_not_allowed", "only product_dev projects can manage versions")
	}
	versionID, err := parseID(versionIDText, "version_id")
	if err != nil {
		return 0, 0, err
	}
	if err := a.ensureVersionVisibleToProject(ctx, projectID, versionID); err != nil {
		return 0, 0, err
	}
	var ownerProjectID sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, "SELECT owner_project_id FROM product_versions WHERE id = ?", versionID).Scan(&ownerProjectID); err == sql.ErrNoRows {
		return 0, 0, httperror.New(http.StatusNotFound, "version_not_found", "product version not found")
	} else if err != nil {
		return 0, 0, err
	}
	if !ownerProjectID.Valid || ownerProjectID.Int64 != projectID {
		return 0, 0, httperror.New(http.StatusForbidden, "version_owner_required", "only owner project manager can manage version")
	}
	return projectID, versionID, nil
}

func (a *Adapter) projectAccess(ctx context.Context, projectID int64, uid string) (aimsProjectAccess, error) {
	var access aimsProjectAccess
	var role sql.NullString
	if err := a.DB().QueryRowContext(ctx, `
		SELECT p.id, p.project_code, p.name, p.category, p.leader_uid, m.role
		FROM aims_projects p
		LEFT JOIN aims_project_members m
		  ON m.project_id = p.id AND m.uid = ? AND m.status = 'active'
		WHERE p.id = ?
	`, uid, projectID).Scan(&access.ID, &access.Code, &access.Name, &access.Category, &access.LeaderUID, &role); err == sql.ErrNoRows {
		return access, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	} else if err != nil {
		return access, err
	}
	if role.Valid {
		access.Role = role.String
	}
	access.IsMember = access.LeaderUID == uid || access.Role != ""
	access.IsManager = access.LeaderUID == uid || access.Role == "manager"
	return access, nil
}

func (a *Adapter) ensureVersionVisibleToProject(ctx context.Context, projectID int64, versionID int64) error {
	var count int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM product_versions pv
		JOIN aims_project_products app
		  ON app.project_id = ?
		 AND app.product_code = pv.product_code
		 AND (app.version_id IS NULL OR app.version_id = pv.id)
		WHERE pv.id = ?
	`, projectID, versionID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusForbidden, "version_not_visible", "version is not visible to project")
	}
	return nil
}

func (a *Adapter) ensureNoOtherVersionItems(ctx context.Context, projectID int64, productCode string, versionID int64) error {
	var count int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM work_items wi
		JOIN product_versions pv ON pv.id = wi.version_id
		WHERE wi.project_id = ? AND pv.product_code = ? AND wi.version_id <> ?
	`, projectID, productCode, versionID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return httperror.New(http.StatusConflict, "project_product_version_narrowing_conflict", "project has work items attached to other versions")
	}
	return nil
}

func (a *Adapter) ensureAttachableWorkItem(ctx context.Context, projectID int64, workItemID int64) error {
	var count int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM work_items WHERE id = ? AND project_id = ? AND tier = 'target'", workItemID, projectID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusBadRequest, "invalid_work_item", "work item must be a target in current project")
	}
	return nil
}

func (a *Adapter) ensureFeatureBelongsToVersion(ctx context.Context, featureID int64, versionID int64) error {
	var count int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM product_version_features WHERE id = ? AND version_id = ?", featureID, versionID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		return httperror.New(http.StatusBadRequest, "feature_version_mismatch", "feature does not belong to version")
	}
	return nil
}

func (a *Adapter) ensureVersionFeatureEditable(ctx context.Context, versionID int64) error {
	var status string
	if err := a.DB().QueryRowContext(ctx, "SELECT status FROM product_versions WHERE id = ?", versionID).Scan(&status); err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "version_not_found", "product version not found")
	} else if err != nil {
		return err
	}
	if status == "released" || status == "archived" {
		return httperror.New(http.StatusConflict, "version_features_locked", "version features are locked")
	}
	return nil
}

func (a *Adapter) versionProductCode(ctx context.Context, versionID int64) (string, error) {
	var productCode string
	if err := a.DB().QueryRowContext(ctx, "SELECT product_code FROM product_versions WHERE id = ?", versionID).Scan(&productCode); err == sql.ErrNoRows {
		return "", httperror.New(http.StatusNotFound, "version_not_found", "product version not found")
	} else if err != nil {
		return "", err
	}
	return productCode, nil
}

func (a *Adapter) versionProductCodeTx(ctx context.Context, tx *sql.Tx, versionID int64) (string, error) {
	var productCode string
	if err := tx.QueryRowContext(ctx, "SELECT product_code FROM product_versions WHERE id = ?", versionID).Scan(&productCode); err == sql.ErrNoRows {
		return "", httperror.New(http.StatusNotFound, "version_not_found", "product version not found")
	} else if err != nil {
		return "", err
	}
	return productCode, nil
}

func (a *Adapter) projectProductExists(ctx context.Context, projectID int64, productCode string) (bool, error) {
	var count int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM aims_project_products WHERE project_id = ? AND product_code = ?", projectID, productCode).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (a *Adapter) projectProductByCode(ctx context.Context, projectID int64, productCode string) (map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  app.id,
		  app.project_id,
		  app.product_code,
		  app.product_name,
		  app.version_id,
		  app.is_primary,
		  DATE_FORMAT(app.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  pv.version_code,
		  pv.name AS version_name,
		  pv.status AS version_status
		FROM aims_project_products app
		LEFT JOIN product_versions pv ON pv.id = app.version_id
		WHERE app.project_id = ? AND app.product_code = ?
		LIMIT 1
	`, projectID, productCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "project_product_not_found", "project product association not found")
	}
	return items[0], nil
}

func (a *Adapter) versionByID(ctx context.Context, versionID int64) (map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  id,
		  product_code,
		  version_code,
		  name,
		  description,
		  status,
		  DATE_FORMAT(planned_release_date, '%Y-%m-%d') AS planned_release_date,
		  DATE_FORMAT(released_at, '%Y-%m-%d %H:%i:%s') AS released_at,
		  released_by,
		  milestone_id,
		  owner_project_id,
		  sort_order,
		  created_by,
		  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM product_versions
		WHERE id = ?
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

func (a *Adapter) featureByID(ctx context.Context, featureID int64) (map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  id,
		  version_id,
		  title,
		  description,
		  category,
		  status,
		  is_public,
		  sort_order,
		  created_by,
		  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM product_version_features
		WHERE id = ?
		LIMIT 1
	`, featureID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, httperror.New(http.StatusNotFound, "feature_not_found", "version feature not found")
	}
	return items[0], nil
}

func (a *Adapter) versionFeatures(ctx context.Context, versionID int64, publicOnly bool) ([]map[string]any, error) {
	where := "WHERE f.version_id = ?"
	if publicOnly {
		where += " AND f.is_public = 1"
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  f.id,
		  f.version_id,
		  f.title,
		  f.description,
		  f.category,
		  f.status,
		  f.is_public,
		  f.sort_order,
		  DATE_FORMAT(f.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		  DATE_FORMAT(f.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
		  COALESCE(progress.target_count, 0) AS target_count,
		  COALESCE(progress.completed_count, 0) AS completed_count,
		  COALESCE(progress.total_weight, 0) AS total_weight,
		  COALESCE(progress.completed_weight, 0) AS completed_weight
		FROM product_version_features f
		LEFT JOIN (
		  SELECT
		    feature_id,
		    COUNT(*) AS target_count,
		    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
		    COALESCE(SUM(weight), 0) AS total_weight,
		    COALESCE(SUM(CASE WHEN status = 'completed' THEN weight ELSE 0 END), 0) AS completed_weight
		  FROM work_items
		  WHERE tier = 'target' AND feature_id IS NOT NULL
		  GROUP BY feature_id
		) progress ON progress.feature_id = f.id
		`+where+`
		ORDER BY f.sort_order ASC, f.id ASC
	`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return aimsRowsToMaps(rows)
}

func (a *Adapter) versionWorkItems(ctx context.Context, versionID int64, projectID int64) ([]map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  wi.id,
		  wi.project_id,
		  wi.item_key,
		  wi.title,
		  wi.status,
		  wi.priority,
		  wi.weight,
		  wi.assignee_uid,
		  wi.milestone_id,
		  wi.feature_id,
		  wi.sort_order,
		  DATE_FORMAT(wi.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
		  m.name AS milestone_name
		FROM work_items wi
		LEFT JOIN milestones m ON m.id = wi.milestone_id
		WHERE wi.version_id = ? AND wi.project_id = ? AND wi.tier = 'target'
		ORDER BY wi.sort_order ASC, wi.id ASC
	`, versionID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return aimsRowsToMaps(rows)
}

func (a *Adapter) versionLogs(ctx context.Context, versionID int64) ([]map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT
		  id,
		  version_id,
		  action,
		  old_value,
		  new_value,
		  operator_uid,
		  note,
		  DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM product_version_logs
		WHERE version_id = ?
		ORDER BY created_at DESC, id DESC
		LIMIT 20
	`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return aimsRowsToMaps(rows)
}

func (a *Adapter) versionAssociatedProjects(ctx context.Context, versionID int64, productCode string) ([]map[string]any, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT DISTINCT
		  p.id,
		  p.project_code,
		  p.name,
		  p.category,
		  app.version_id,
		  app.is_primary
		FROM aims_project_products app
		JOIN aims_projects p ON p.id = app.project_id
		WHERE app.product_code = ?
		  AND (app.version_id IS NULL OR app.version_id = ?)
		ORDER BY p.project_code ASC, p.id ASC
	`, productCode, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return aimsRowsToMaps(rows)
}

func (a *Adapter) insertVersionLog(ctx context.Context, tx *sql.Tx, versionID int64, action string, oldValue string, newValue string, actor string, note string) error {
	exec := func(query string, args ...any) (sql.Result, error) {
		if tx != nil {
			return tx.ExecContext(ctx, query, args...)
		}
		return a.DB().ExecContext(ctx, query, args...)
	}
	_, err := exec(`
		INSERT INTO product_version_logs (version_id, action, old_value, new_value, operator_uid, note)
		VALUES (?, ?, ?, ?, ?, ?)
	`, versionID, action, nullableText(oldValue), nullableText(newValue), nullableText(actor), nullableText(note))
	return err
}

func aimsRowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(columns))
	targets := make([]any, len(columns))
	for i := range values {
		targets[i] = &values[i]
	}
	result := make([]map[string]any, 0)
	for rows.Next() {
		if err := rows.Scan(targets...); err != nil {
			return nil, err
		}
		item := make(map[string]any, len(columns))
		for i, column := range columns {
			item[column] = normalizeAimsSQLValue(values[i])
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func normalizeAimsSQLValue(value any) any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []byte:
		return string(typed)
	case time.Time:
		return typed.UTC().Format("2006-01-02 15:04:05")
	default:
		return typed
	}
}

func parseID(text string, field string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil || id <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "invalid_"+field, field+" must be a positive integer")
	}
	return id, nil
}

func optionalBodyID(body map[string]any, keys ...string) (int64, bool, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		if value == nil {
			return 0, true, nil
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			return 0, true, nil
		}
		id, err := strconv.ParseInt(text, 10, 64)
		if err != nil || id <= 0 {
			return 0, true, fmt.Errorf("invalid id")
		}
		return id, true, nil
	}
	return 0, false, nil
}

func nullableOptionalID(body map[string]any, keys ...string) any {
	id, ok, err := optionalBodyID(body, keys...)
	if err != nil || !ok || id == 0 {
		return nil
	}
	return id
}

func bodyIDList(body map[string]any, keys ...string) ([]int64, error) {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		rawItems, ok := value.([]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_id_list", key+" must be an array")
		}
		items := make([]int64, 0, len(rawItems))
		for _, raw := range rawItems {
			id, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(raw)), 10, 64)
			if err != nil || id <= 0 {
				return nil, httperror.New(http.StatusBadRequest, "invalid_id_list", key+" contains invalid id")
			}
			items = append(items, id)
		}
		return items, nil
	}
	return nil, nil
}

func bodyMap(body map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		if item, ok := value.(map[string]any); ok {
			return item
		}
	}
	return nil
}

func bodyJSONText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		if text, ok := value.(string); ok {
			return strings.TrimSpace(text)
		}
		encoded, err := json.Marshal(value)
		if err == nil {
			return string(encoded)
		}
	}
	return ""
}

func nullableText(text string) any {
	if strings.TrimSpace(text) == "" {
		return nil
	}
	return strings.TrimSpace(text)
}

func firstNonEmptyText(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func bodyBool(body map[string]any, keys ...string) bool {
	return defaultBodyBool(body, false, keys...)
}

func defaultBodyBool(body map[string]any, fallback bool, keys ...string) bool {
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case float64:
			return typed != 0
		case int:
			return typed != 0
		case string:
			text := strings.TrimSpace(strings.ToLower(typed))
			return text == "1" || text == "true" || text == "yes"
		default:
			return strings.TrimSpace(fmt.Sprint(value)) == "1"
		}
	}
	return fallback
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func bodyIntDefault(body map[string]any, fallback int64, keys ...string) int64 {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		parsed, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func int64FromMap(item map[string]any, key string) int64 {
	value := item[key]
	switch typed := value.(type) {
	case int64:
		return typed
	case int:
		return int64(typed)
	case float64:
		return int64(typed)
	case string:
		parsed, _ := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		return parsed
	default:
		return 0
	}
}

func accessMap(access aimsProjectAccess) map[string]any {
	return map[string]any{
		"id":        access.ID,
		"code":      access.Code,
		"name":      access.Name,
		"category":  access.Category,
		"role":      access.Role,
		"isManager": access.IsManager,
	}
}

func productAssociableCategory(category string) bool {
	switch category {
	case "product_dev", "delivery", "maintenance":
		return true
	default:
		return false
	}
}

func validVersionTransition(from string, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "planning":
		return to == "developing"
	case "developing":
		return to == "released"
	case "released":
		return to == "developing" || to == "archived"
	default:
		return false
	}
}
