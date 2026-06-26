package aims

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) handleProjectEnvironmentRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if method == http.MethodGet {
		if projectCode, ok := pathParam(path, "/v1/aims/service/projects/", "/environments"); ok {
			projectCode, _ = url.PathUnescape(projectCode)
			data, err := a.listProjectEnvironmentsByProjectCode(ctx, projectCode)
			return data, "aims.service.projects.environments.list", true, err
		}
		if environmentCode, ok := pathParam(path, "/v1/aims/service/environments/", "/projects"); ok {
			environmentCode, _ = url.PathUnescape(environmentCode)
			data, err := a.listProjectEnvironmentsByEnvironmentCode(ctx, environmentCode)
			return data, "aims.service.environments.projects.list", true, err
		}
	}
	if method == http.MethodPost {
		if projectCode, ok := pathParam(path, "/v1/aims/service/projects/", "/environments"); ok {
			projectCode, _ = url.PathUnescape(projectCode)
			data, err := a.upsertProjectEnvironmentByProjectCode(ctx, projectCode, body)
			return data, "aims.service.projects.environments.upsert", true, err
		}
		if projectCode, environmentCode, action, ok := projectEnvironmentCommandPath(path); ok {
			data, err := a.changeProjectEnvironment(ctx, projectCode, environmentCode, action, body)
			return data, "aims.service.projects.environments." + action, true, err
		}
	}
	return nil, "", false, nil
}

func (a *Adapter) listProjectEnvironmentsByProjectCode(ctx context.Context, projectCode string) (map[string]any, error) {
	project, err := projectByCode(ctx, a.DB(), projectCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	items, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT pe.*, p.project_code, p.name AS project_name, p.customer_code, p.contract_code
		FROM project_environments pe
		INNER JOIN aims_projects p ON p.id = pe.project_id
		WHERE pe.project_id = ?
		  AND pe.deleted_at IS NULL
		ORDER BY pe.is_primary DESC, pe.delivery_status ASC, pe.id DESC
	`, project["id"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"project": project, "items": items, "total": len(items)}, nil
}

func (a *Adapter) listProjectEnvironmentsByEnvironmentCode(ctx context.Context, environmentCode string) (map[string]any, error) {
	environmentCode = strings.TrimSpace(environmentCode)
	if environmentCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_environment_code", "environmentCode is required")
	}
	items, err := aimsQueryMaps(ctx, a.DB(), `
		SELECT pe.*, p.project_code, p.name AS project_name, p.customer_code, p.contract_code
		FROM project_environments pe
		INNER JOIN aims_projects p ON p.id = pe.project_id
		WHERE pe.environment_code = ?
		  AND pe.deleted_at IS NULL
		  AND p.lifecycle_status <> 'archived'
		ORDER BY pe.created_at ASC, pe.id ASC
	`, environmentCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{"environment_code": environmentCode, "items": items, "total": len(items)}, nil
}

func (a *Adapter) upsertProjectEnvironmentByProjectCode(ctx context.Context, projectCode string, body map[string]any) (map[string]any, error) {
	environmentCode := firstBodyText(body, "environmentCode", "environment_code")
	if environmentCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_environment_code", "environmentCode must be a formal Assets code")
	}
	if strings.HasPrefix(strings.ToUpper(environmentCode), "TEMP-") || strings.HasPrefix(strings.ToUpper(environmentCode), "PENDING-") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_environment_code", "Aims must not create placeholder environment codes")
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := upsertProjectEnvironmentTx(ctx, tx, projectCode, body)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func upsertProjectEnvironmentTx(ctx context.Context, tx *sql.Tx, projectCode string, body map[string]any) (map[string]any, error) {
	environmentCode := firstBodyText(body, "environmentCode", "environment_code")
	if environmentCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_environment_code", "environmentCode must be a formal Assets code")
	}
	if strings.HasPrefix(strings.ToUpper(environmentCode), "TEMP-") || strings.HasPrefix(strings.ToUpper(environmentCode), "PENDING-") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_environment_code", "Aims must not create placeholder environment codes")
	}
	relationType, err := projectEnvironmentRelationTypeInput(body, "initial_delivery", "relationType", "relation_type")
	if err != nil {
		return nil, err
	}
	deliveryAssetCode := firstBodyText(body, "deliveryAssetCode", "delivery_asset_code")
	deliveryStatus, err := projectEnvironmentDeliveryStatusInput(body, "planned", "deliveryStatus", "delivery_status")
	if err != nil {
		return nil, err
	}
	handoverStatus := normalizeProjectEnvironmentHandoverStatus(firstBodyText(body, "handoverStatus", "handover_status"))
	assetsSyncStatus, err := projectEnvironmentAssetsSyncStatusInput(body, "pending", "assetsSyncStatus", "assets_sync_status")
	if err != nil {
		return nil, err
	}
	operator := aimsActor(body)

	project, err := lockProjectByCodeTx(ctx, tx, projectCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}

	isPrimary := aimsBoolInput(body, "isPrimary", "is_primary")
	if isPrimary {
		if _, err := tx.ExecContext(ctx, `
			UPDATE project_environments
			SET is_primary = 0,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE project_id = ?
			  AND deleted_at IS NULL
			  AND is_primary = 1
		`, nullableText(aimsActor(body)), project["id"]); err != nil {
			return nil, err
		}
	}

	activeRelationKey := projectEnvironmentActiveRelationKey(project["id"], environmentCode, deliveryAssetCode, relationType)

	_, err = tx.ExecContext(ctx, `
		INSERT INTO project_environments (
		  project_id,
		  environment_code,
		  delivery_asset_code,
		  relation_type,
		  delivery_status,
		  is_primary,
		  planned_go_live_at,
		  actual_go_live_at,
		  accepted_at,
		  handover_status,
		  handover_at,
		  delivery_version_snapshot,
		  assets_sync_status,
		  assets_sync_error,
		  assets_synced_at,
		  source_contract_line_code,
		  source_obligation_code,
		  active_relation_key,
		  created_by,
		  updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  delivery_status = VALUES(delivery_status),
		  is_primary = VALUES(is_primary),
		  planned_go_live_at = COALESCE(VALUES(planned_go_live_at), planned_go_live_at),
		  actual_go_live_at = COALESCE(VALUES(actual_go_live_at), actual_go_live_at),
		  accepted_at = COALESCE(VALUES(accepted_at), accepted_at),
		  handover_status = VALUES(handover_status),
		  handover_at = COALESCE(VALUES(handover_at), handover_at),
		  delivery_version_snapshot = COALESCE(VALUES(delivery_version_snapshot), delivery_version_snapshot),
		  assets_sync_status = VALUES(assets_sync_status),
		  assets_sync_error = VALUES(assets_sync_error),
		  assets_synced_at = VALUES(assets_synced_at),
		  source_contract_line_code = COALESCE(VALUES(source_contract_line_code), source_contract_line_code),
		  source_obligation_code = COALESCE(VALUES(source_obligation_code), source_obligation_code),
		  active_relation_key = VALUES(active_relation_key),
		  deleted_at = NULL,
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP
	`,
		project["id"],
		environmentCode,
		nullableText(deliveryAssetCode),
		relationType,
		deliveryStatus,
		aimsBoolInt(isPrimary),
		nullableText(firstBodyText(body, "plannedGoLiveAt", "planned_go_live_at")),
		nullableText(firstBodyText(body, "actualGoLiveAt", "actual_go_live_at")),
		nullableText(firstBodyText(body, "acceptedAt", "accepted_at")),
		handoverStatus,
		nullableText(firstBodyText(body, "handoverAt", "handover_at")),
		nullableText(firstBodyText(body, "deliveryVersionSnapshot", "delivery_version_snapshot", "deployedVersion", "deployed_version")),
		assetsSyncStatus,
		nullableText(firstBodyText(body, "assetsSyncError", "assets_sync_error")),
		nullableText(firstBodyText(body, "assetsSyncedAt", "assets_synced_at")),
		nullableText(firstBodyText(body, "sourceContractLineCode", "source_contract_line_code")),
		nullableText(firstBodyText(body, "sourceObligationCode", "source_obligation_code")),
		activeRelationKey,
		nullableText(operator),
		nullableText(operator),
	)
	if err != nil {
		return nil, err
	}
	relation, err := projectEnvironmentByKeyTx(ctx, tx, project["id"], environmentCode, deliveryAssetCode, relationType)
	if err != nil {
		return nil, err
	}
	return map[string]any{"project": project, "relation": relation}, nil
}

func (a *Adapter) changeProjectEnvironment(ctx context.Context, projectCode string, environmentCode string, action string, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	result, err := changeProjectEnvironmentTx(ctx, tx, projectCode, environmentCode, action, body)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func changeProjectEnvironmentTx(ctx context.Context, tx *sql.Tx, projectCode string, environmentCode string, action string, body map[string]any) (map[string]any, error) {
	var statusTarget string
	if action == "status" {
		rawTarget := firstBodyText(body, "deliveryStatus", "delivery_status", "status")
		if rawTarget == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_status", "deliveryStatus is required")
		}
		statusTarget = normalizeProjectEnvironmentDeliveryStatus(rawTarget)
		if statusTarget == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_environment_transition", "invalid project environment status")
		}
	}

	project, err := lockProjectByCodeTx(ctx, tx, projectCode)
	if err != nil {
		return nil, err
	}
	if project == nil {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "project not found")
	}
	relation, err := lockProjectEnvironmentForCommandTx(ctx, tx, project["id"], environmentCode, body)
	if err != nil {
		return nil, err
	}
	if relation == nil {
		return nil, httperror.New(http.StatusNotFound, "project_environment_not_found", "project environment relation not found")
	}
	operator := aimsActor(body)
	switch action {
	case "status":
		target := statusTarget
		if !validProjectEnvironmentTransition(cleanAimsText(relation["delivery_status"]), target) {
			return nil, httperror.New(http.StatusConflict, "invalid_environment_transition", "invalid project environment status transition")
		}
		updates := projectEnvironmentStatusTimes(target, body)
		if _, err := tx.ExecContext(ctx, `
			UPDATE project_environments
			SET delivery_status = ?,
			    actual_go_live_at = COALESCE(?, actual_go_live_at),
			    accepted_at = COALESCE(?, accepted_at),
			    handover_status = COALESCE(?, handover_status),
			    handover_at = COALESCE(?, handover_at),
			    assets_sync_status = 'pending',
			    assets_sync_error = NULL,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, target, updates.actualGoLiveAt, updates.acceptedAt, updates.handoverStatus, updates.handoverAt, nullableText(operator), relation["id"]); err != nil {
			return nil, err
		}
	case "assets-sync":
		rawStatus := firstBodyText(body, "assetsSyncStatus", "assets_sync_status", "status")
		if rawStatus == "" {
			return nil, httperror.New(http.StatusBadRequest, "missing_assets_sync_status", "assetsSyncStatus is required")
		}
		status := normalizeAssetsSyncStatus(rawStatus)
		if status == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_assets_sync_status", "invalid assetsSyncStatus")
		}
		var syncedAt any
		if status == "synced" {
			syncedAt = firstNonEmptyText(firstBodyText(body, "assetsSyncedAt", "assets_synced_at"), time.Now().UTC().Format("2006-01-02 15:04:05"))
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE project_environments
			SET assets_sync_status = ?,
			    assets_sync_error = ?,
			    assets_synced_at = COALESCE(?, assets_synced_at),
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, status, nullableText(firstBodyText(body, "assetsSyncError", "assets_sync_error", "error")), syncedAt, nullableText(operator), relation["id"]); err != nil {
			return nil, err
		}
	case "remove":
		if cleanAimsText(relation["delivery_status"]) == "accepted" || cleanAimsText(relation["delivery_status"]) == "handed_over" {
			return nil, httperror.New(http.StatusConflict, "coverage_already_active", "accepted or handed-over project environment cannot be removed")
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE project_environments
			SET deleted_at = CURRENT_TIMESTAMP,
			    delivery_status = 'cancelled',
			    is_primary = 0,
			    active_relation_key = NULL,
			    updated_by = COALESCE(?, updated_by),
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nullableText(operator), relation["id"]); err != nil {
			return nil, err
		}
	default:
		return nil, httperror.New(http.StatusNotFound, "not_found", "Route not found")
	}
	updated, err := projectEnvironmentByIDTx(ctx, tx, relation["id"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"project": project, "relation": updated}, nil
}

func projectByCode(ctx context.Context, conn aimsQueryer, projectCode string) (map[string]any, error) {
	return aimsQueryOneMap(ctx, conn, `
		SELECT *
		FROM aims_projects
		WHERE project_code = ?
		  AND lifecycle_status <> 'archived'
		LIMIT 1
	`, strings.TrimSpace(projectCode))
}

func lockProjectByCodeTx(ctx context.Context, tx *sql.Tx, projectCode string) (map[string]any, error) {
	return aimsQueryOneMap(ctx, tx, `
		SELECT *
		FROM aims_projects
		WHERE project_code = ?
		  AND lifecycle_status <> 'archived'
		LIMIT 1
		FOR UPDATE
	`, strings.TrimSpace(projectCode))
}

func projectEnvironmentByIDTx(ctx context.Context, tx *sql.Tx, id any) (map[string]any, error) {
	return aimsQueryOneMap(ctx, tx, "SELECT * FROM project_environments WHERE id = ? LIMIT 1", id)
}

func projectEnvironmentByKeyTx(ctx context.Context, tx *sql.Tx, projectID any, environmentCode string, deliveryAssetCode string, relationType string) (map[string]any, error) {
	where := []string{"project_id = ?", "environment_code = ?", "relation_type = ?", "deleted_at IS NULL"}
	args := []any{projectID, environmentCode, relationType}
	if strings.TrimSpace(deliveryAssetCode) == "" {
		where = append(where, "(delivery_asset_code IS NULL OR delivery_asset_code = '')")
	} else {
		where = append(where, "delivery_asset_code = ?")
		args = append(args, strings.TrimSpace(deliveryAssetCode))
	}
	return aimsQueryOneMap(ctx, tx, `
		SELECT *
		FROM project_environments
		WHERE `+strings.Join(where, " AND ")+`
		LIMIT 1
	`, args...)
}

func projectEnvironmentActiveRelationKey(projectID any, environmentCode string, deliveryAssetCode string, relationType string) string {
	return fmt.Sprintf(
		"%v:%s:%s:%s",
		projectID,
		strings.TrimSpace(environmentCode),
		strings.TrimSpace(deliveryAssetCode),
		relationType,
	)
}

func lockProjectEnvironmentForCommandTx(ctx context.Context, tx *sql.Tx, projectID any, environmentCode string, body map[string]any) (map[string]any, error) {
	relationType := firstBodyText(body, "relationType", "relation_type")
	deliveryAssetCode := firstBodyText(body, "deliveryAssetCode", "delivery_asset_code")
	where := []string{"project_id = ?", "environment_code = ?", "deleted_at IS NULL"}
	args := []any{projectID, environmentCode}
	if relationType != "" {
		normalizedRelationType := normalizeProjectEnvironmentRelationType(relationType)
		if normalizedRelationType == "" {
			return nil, httperror.New(http.StatusBadRequest, "invalid_environment_relation_type", "invalid project environment relationType")
		}
		where = append(where, "relation_type = ?")
		args = append(args, normalizedRelationType)
	}
	if deliveryAssetCode != "" {
		where = append(where, "delivery_asset_code = ?")
		args = append(args, deliveryAssetCode)
	}
	rows, err := aimsQueryMaps(ctx, tx, `
		SELECT *
		FROM project_environments
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY is_primary DESC, id DESC
		FOR UPDATE
	`, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	if relationType == "" && deliveryAssetCode == "" && len(rows) > 1 {
		return nil, httperror.New(http.StatusConflict, "environment_reference_ambiguous", "multiple project environment relations match; provide deliveryAssetCode or relationType")
	}
	return rows[0], nil
}

func projectEnvironmentCommandPath(path string) (string, string, string, bool) {
	const prefix = "/v1/aims/service/projects/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "environments" || parts[2] == "" {
		return "", "", "", false
	}
	projectCode, _ := url.PathUnescape(parts[0])
	envPart := parts[2]
	action := ""
	for _, candidate := range []string{":status", ":assets-sync", ":remove"} {
		if strings.HasSuffix(envPart, candidate) {
			action = strings.TrimPrefix(candidate, ":")
			envPart = strings.TrimSuffix(envPart, candidate)
			break
		}
	}
	if action == "" || envPart == "" {
		return "", "", "", false
	}
	environmentCode, _ := url.PathUnescape(envPart)
	return projectCode, environmentCode, action, true
}

func normalizeProjectEnvironmentRelationType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "initial_delivery", "upgrade", "migration", "maintenance", "decommission", "verification", "other":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func projectEnvironmentRelationTypeInput(body map[string]any, defaultType string, keys ...string) (string, error) {
	raw := firstBodyText(body, keys...)
	if raw == "" {
		return defaultType, nil
	}
	relationType := normalizeProjectEnvironmentRelationType(raw)
	if relationType == "" {
		return "", httperror.New(http.StatusBadRequest, "invalid_environment_relation_type", "invalid project environment relationType")
	}
	return relationType, nil
}

func normalizeProjectEnvironmentDeliveryStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "planned", "provisioning", "deployed", "online", "accepted", "handed_over", "suspended", "cancelled":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func projectEnvironmentDeliveryStatusInput(body map[string]any, defaultStatus string, keys ...string) (string, error) {
	raw := firstBodyText(body, keys...)
	if raw == "" {
		return defaultStatus, nil
	}
	status := normalizeProjectEnvironmentDeliveryStatus(raw)
	if status == "" {
		return "", httperror.New(http.StatusBadRequest, "invalid_environment_transition", "invalid project environment status")
	}
	return status, nil
}

func projectEnvironmentAssetsSyncStatusInput(body map[string]any, defaultStatus string, keys ...string) (string, error) {
	raw := firstBodyText(body, keys...)
	if raw == "" {
		return defaultStatus, nil
	}
	status := normalizeAssetsSyncStatus(raw)
	if status == "" {
		return "", httperror.New(http.StatusBadRequest, "invalid_assets_sync_status", "invalid assetsSyncStatus")
	}
	return status, nil
}

func normalizeProjectEnvironmentHandoverStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "pending", "ready", "completed", "rejected":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return "pending"
	}
}

func normalizeAssetsSyncStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "pending", "synced", "failed":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

func validProjectEnvironmentTransition(current string, target string) bool {
	if target == "" || current == target {
		return target != ""
	}
	order := map[string]int{
		"planned":      1,
		"provisioning": 2,
		"deployed":     3,
		"online":       4,
		"accepted":     5,
		"handed_over":  6,
	}
	if target == "suspended" || target == "cancelled" {
		return current != "handed_over"
	}
	if current == "suspended" {
		return target == "provisioning" || target == "deployed" || target == "online"
	}
	return order[target] >= order[current] && order[target] > 0
}

type projectEnvironmentStatusTimeUpdates struct {
	actualGoLiveAt any
	acceptedAt     any
	handoverStatus any
	handoverAt     any
}

func projectEnvironmentStatusTimes(status string, body map[string]any) projectEnvironmentStatusTimeUpdates {
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	result := projectEnvironmentStatusTimeUpdates{
		actualGoLiveAt: nullableText(firstBodyText(body, "actualGoLiveAt", "actual_go_live_at")),
		acceptedAt:     nullableText(firstBodyText(body, "acceptedAt", "accepted_at")),
		handoverAt:     nullableText(firstBodyText(body, "handoverAt", "handover_at")),
	}
	if result.actualGoLiveAt == nil && (status == "online" || status == "accepted" || status == "handed_over") {
		result.actualGoLiveAt = now
	}
	if result.acceptedAt == nil && (status == "accepted" || status == "handed_over") {
		result.acceptedAt = now
	}
	if status == "handed_over" {
		result.handoverStatus = "completed"
		if result.handoverAt == nil {
			result.handoverAt = now
		}
	}
	return result
}

func aimsActor(body map[string]any) string {
	return firstBodyText(body, "operator_uid", "current_user", "updated_by", "created_by")
}

func aimsBoolInput(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		value, ok := body[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case bool:
			return typed
		case string:
			text := strings.ToLower(strings.TrimSpace(typed))
			return text == "true" || text == "1" || text == "yes"
		default:
			return serviceBodyInt(map[string]any{key: value}, key) != 0
		}
	}
	return false
}

func aimsBoolInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func cleanAimsText(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}
