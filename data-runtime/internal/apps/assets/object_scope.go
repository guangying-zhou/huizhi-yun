package assets

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const assetsObjectAccessQueryKey = "current_user_assets_object_access"
const assetsScopeUnitsQueryKey = "current_user_assets_scope_units"
const assetsPermissionActionQueryKey = "current_user_assets_permission_action"

type assetsScopeUnit struct {
	DirectRelation     bool     `json:"directRelation"`
	RelationPredicates []string `json:"relationPredicates"`
	DepartmentCodes    []string `json:"departmentCodes"`
	ProjectCodes       []string `json:"projectCodes"`
}

func assetsObjectAccess(query url.Values) (string, string, error) {
	access := strings.TrimSpace(query.Get(assetsObjectAccessQueryKey))
	actor := strings.TrimSpace(query.Get("current_user"))
	if actor == "" {
		return "", "", httperror.New(http.StatusUnauthorized, "missing_current_user", "trusted current_user is required")
	}
	if access != "all" && access != "relation" && access != "none" {
		return "", "", httperror.New(http.StatusForbidden, "assets_object_scope_required", "trusted Assets object scope is required")
	}
	if access == "none" {
		return "", "", httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this record")
	}
	return access, actor, nil
}

func assetsScopeUnits(query url.Values) ([]assetsScopeUnit, error) {
	var units []assetsScopeUnit
	if err := json.Unmarshal([]byte(strings.TrimSpace(query.Get(assetsScopeUnitsQueryKey))), &units); err != nil || len(units) == 0 {
		return nil, httperror.New(http.StatusForbidden, "assets_object_scope_required", "trusted Assets scope units are required")
	}
	if len(units) > 100 {
		return nil, httperror.New(http.StatusForbidden, "assets_object_scope_invalid", "trusted Assets scope units are invalid")
	}
	for _, unit := range units {
		if !unit.DirectRelation && len(unit.DepartmentCodes) == 0 && len(unit.ProjectCodes) == 0 {
			return nil, httperror.New(http.StatusForbidden, "assets_object_scope_invalid", "trusted Assets scope unit is empty")
		}
	}
	return units, nil
}

func placeholders(values []string) string {
	return strings.TrimRight(strings.Repeat("?,", len(values)), ",")
}

func assetItemScopeWhere(alias, actor string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		parts := []string{}
		if unit.DirectRelation {
			relationWhere, relationArgs := assetItemRelationWhere(alias, actor, unit.RelationPredicates)
			if relationWhere != "" {
				parts = append(parts, relationWhere)
				args = append(args, relationArgs...)
			}
		}
		if len(unit.DepartmentCodes) > 0 {
			parts = append(parts, alias+".dept_code IN ("+placeholders(unit.DepartmentCodes)+")")
			for _, code := range unit.DepartmentCodes {
				args = append(args, code)
			}
		}
		if len(unit.ProjectCodes) > 0 {
			parts = append(parts, alias+".project_code IN ("+placeholders(unit.ProjectCodes)+")")
			for _, code := range unit.ProjectCodes {
				args = append(args, code)
			}
		}
		if len(parts) > 0 {
			branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		}
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}

func ipAssetScopeWhere(alias, actor string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		// ip_assets has no department field; a department-constrained unit cannot match.
		if len(unit.DepartmentCodes) > 0 {
			continue
		}
		parts := []string{}
		if unit.DirectRelation {
			relationWhere, relationArgs := ipAssetRelationWhere(alias, actor, unit.RelationPredicates)
			if relationWhere != "" {
				parts = append(parts, relationWhere)
				args = append(args, relationArgs...)
			}
		}
		if len(unit.ProjectCodes) > 0 {
			parts = append(parts, "EXISTS (SELECT 1 FROM ip_asset_products scope_project_iap JOIN product_assets scope_project_product ON scope_project_product.id=scope_project_iap.product_asset_id WHERE scope_project_iap.ip_asset_id="+alias+".id AND scope_project_product.project_code IN ("+placeholders(unit.ProjectCodes)+"))")
			for _, code := range unit.ProjectCodes {
				args = append(args, code)
			}
		}
		if len(parts) > 0 {
			branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		}
	}
	if len(branches) == 0 {
		return "(1=0)", args
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}

// digitalAssetScopeWhere keeps the same trusted scope contract as the other
// Assets read models, while only using relations actually stored by
// digital_assets.  A department-constrained unit cannot match because a
// digital asset has no department column; treating it as a broader owner or
// project scope would widen access.
func digitalAssetScopeWhere(alias, actor string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		if len(unit.DepartmentCodes) > 0 {
			continue
		}
		parts := []string{}
		if unit.DirectRelation {
			relationWhere, relationArgs := digitalAssetRelationWhere(alias, actor, unit.RelationPredicates)
			if relationWhere == "" {
				// Relation and project restrictions are conjunctive within a unit.
				// An unsupported relation cannot become project-only access.
				continue
			}
			parts = append(parts, relationWhere)
			args = append(args, relationArgs...)
		}
		if len(unit.ProjectCodes) > 0 {
			parts = append(parts, alias+".project_code IN ("+placeholders(unit.ProjectCodes)+")")
			for _, code := range unit.ProjectCodes {
				args = append(args, code)
			}
		}
		if len(parts) > 0 {
			branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		}
	}
	if len(branches) == 0 {
		return "(1=0)", args
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}

func normalizedAssetRelationPredicates(predicates []string) []string {
	if len(predicates) == 0 {
		return []string{"assigned"}
	}
	seen := map[string]bool{}
	result := []string{}
	for _, predicate := range predicates {
		normalized := strings.ToLower(strings.TrimSpace(predicate))
		if normalized == "keeper" {
			normalized = "custodian"
		}
		if seen[normalized] {
			continue
		}
		switch normalized {
		case "self", "owner", "custodian", "user", "assigned":
			seen[normalized] = true
			result = append(result, normalized)
		}
	}
	return result
}

func assetItemRelationWhere(alias, actor string, predicates []string) (string, []any) {
	parts, args := []string{}, []any{}
	for _, predicate := range normalizedAssetRelationPredicates(predicates) {
		switch predicate {
		case "owner":
			parts = append(parts, alias+".owner_uid=?")
			args = append(args, actor)
		case "custodian":
			parts = append(parts, alias+".custodian_uid=?")
			args = append(args, actor)
		case "self", "user":
			parts = append(parts, alias+".user_uid=?")
			args = append(args, actor)
		case "assigned":
			parts = append(parts, "? IN (COALESCE("+alias+".owner_uid,''),COALESCE("+alias+".custodian_uid,''),COALESCE("+alias+".user_uid,''))")
			args = append(args, actor)
		}
	}
	if len(parts) == 0 {
		return "", args
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

func ipAssetRelationWhere(alias, actor string, predicates []string) (string, []any) {
	parts, args := []string{}, []any{}
	for _, predicate := range normalizedAssetRelationPredicates(predicates) {
		switch predicate {
		case "self", "owner", "assigned":
			parts = append(parts, "("+alias+".owner_uid=? OR EXISTS (SELECT 1 FROM ip_asset_products scope_iap JOIN product_assets scope_product ON scope_product.id=scope_iap.product_asset_id WHERE scope_iap.ip_asset_id="+alias+".id AND ? IN (COALESCE(scope_product.business_owner_uid,''),COALESCE(scope_product.technical_owner_uid,''))))")
			args = append(args, actor, actor)
		}
	}
	if len(parts) == 0 {
		return "", args
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

func digitalAssetRelationWhere(alias, actor string, predicates []string) (string, []any) {
	parts, args := []string{}, []any{}
	for _, predicate := range normalizedAssetRelationPredicates(predicates) {
		// digital_assets has owner_uid only.  "self" and "assigned" resolve to
		// that persisted relationship; custodian and user never silently match.
		switch predicate {
		case "self", "owner", "assigned":
			parts = append(parts, alias+".owner_uid=?")
			args = append(args, actor)
		}
	}
	if len(parts) == 0 {
		return "", args
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

func assignmentScopeWhere(assignmentAlias, assetAlias, actor string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		parts := []string{}
		if unit.DirectRelation {
			relations := []string{
				assignmentAlias + ".requested_by=?",
				"(" + assignmentAlias + ".target_type='user' AND " + assignmentAlias + ".target_ref=?)",
			}
			relationArgs := []any{actor, actor}
			assetWhere, assetArgs := assetItemRelationWhere(assetAlias, actor, unit.RelationPredicates)
			if assetWhere != "" && !onlySelfRelation(unit.RelationPredicates) {
				relations = append(relations, assetWhere)
				relationArgs = append(relationArgs, assetArgs...)
			}
			parts = append(parts, "("+strings.Join(relations, " OR ")+")")
			args = append(args, relationArgs...)
		}
		if len(unit.DepartmentCodes) > 0 {
			parts = append(parts, assetAlias+".dept_code IN ("+placeholders(unit.DepartmentCodes)+")")
			for _, code := range unit.DepartmentCodes {
				args = append(args, code)
			}
		}
		if len(unit.ProjectCodes) > 0 {
			parts = append(parts, assetAlias+".project_code IN ("+placeholders(unit.ProjectCodes)+")")
			for _, code := range unit.ProjectCodes {
				args = append(args, code)
			}
		}
		if len(parts) > 0 {
			branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		}
	}
	if len(branches) == 0 {
		return "(1=0)", args
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}

func onlySelfRelation(predicates []string) bool {
	normalized := normalizedAssetRelationPredicates(predicates)
	return len(normalized) == 1 && normalized[0] == "self"
}

func alertScopeWhere(alertAlias, assetAlias, actor string, units []assetsScopeUnit) (string, []any) {
	branches, args := []string{}, []any{}
	for _, unit := range units {
		parts := []string{}
		if unit.DirectRelation {
			assetWhere, assetArgs := assetItemRelationWhere(assetAlias, actor, unit.RelationPredicates)
			if assetWhere != "" {
				parts = append(parts, "("+alertAlias+".asset_id IS NOT NULL AND "+assetWhere+")")
				args = append(args, assetArgs...)
			}
		}
		if len(unit.DepartmentCodes) > 0 {
			parts = append(parts, assetAlias+".dept_code IN ("+placeholders(unit.DepartmentCodes)+")")
			for _, code := range unit.DepartmentCodes {
				args = append(args, code)
			}
		}
		if len(unit.ProjectCodes) > 0 {
			parts = append(parts, "("+alertAlias+".project_code IN ("+placeholders(unit.ProjectCodes)+") OR "+assetAlias+".project_code IN ("+placeholders(unit.ProjectCodes)+"))")
			for _, code := range unit.ProjectCodes {
				args = append(args, code)
			}
			for _, code := range unit.ProjectCodes {
				args = append(args, code)
			}
		}
		if len(parts) > 0 {
			branches = append(branches, "("+strings.Join(parts, " AND ")+")")
		}
	}
	if len(branches) == 0 {
		return "(1=0)", args
	}
	return "(" + strings.Join(branches, " OR ") + ")", args
}

type assignmentAssetRecord struct {
	ID             int64
	Category       string
	Status         string
	OwnerUID       string
	CustodianUID   string
	UserUID        string
	DepartmentCode string
	ProjectCode    string
}

func authorizeAssignmentCreate(query url.Values, body map[string]any, asset assignmentAssetRecord) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return err
	}
	permissionAction := strings.ToLower(strings.TrimSpace(query.Get(assetsPermissionActionQueryKey)))
	actionType := strings.ToLower(strings.TrimSpace(coalesceText(body, "action_type", "assign")))
	if !allowedAssignmentAction(actionType) {
		return httperror.New(http.StatusBadRequest, "invalid_assignment_action", "不支持的资产操作类型")
	}

	switch permissionAction {
	case "request":
		return authorizeSelfServiceAssignment(body, asset, actor, actionType)
	case "edit", "admin":
		if access == "all" {
			return nil
		}
		units, unitErr := assetsScopeUnits(query)
		if unitErr != nil {
			return unitErr
		}
		for _, unit := range units {
			if assignmentAssetMatchesUnit(asset, actor, unit) {
				return nil
			}
		}
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this asset operation")
	default:
		return httperror.New(http.StatusForbidden, "assets_assignment_action_forbidden", "Trusted Assets assignment permission action is required")
	}
}

func allowedAssignmentAction(actionType string) bool {
	switch actionType {
	case "assign", "claim", "transfer", "return", "renew", "release", "scrap", "repair", "revoke_access", "rotate_secret":
		return true
	default:
		return false
	}
}

func authorizeSelfServiceAssignment(body map[string]any, asset assignmentAssetRecord, actor, actionType string) error {
	for _, field := range []string{"workflow_instance_id", "workflowInstanceId", "effective_at", "effectiveAt", "ended_at", "endedAt", "approved_by", "approvedBy", "assignment_no", "assignmentNo", "source_ref", "sourceRef"} {
		if strings.TrimSpace(cleanAnyString(body[field])) != "" {
			return httperror.New(http.StatusForbidden, "assets_assignment_request_field_forbidden", "本人资产申请不能指定流程、编号或生效控制字段")
		}
	}
	status := strings.ToLower(strings.TrimSpace(bodyText(body, "status")))
	if status != "" && status != "pending" {
		return httperror.New(http.StatusForbidden, "assets_assignment_request_status_forbidden", "本人资产申请只能创建待处理记录")
	}

	category := strings.ToLower(strings.TrimSpace(asset.Category))
	assetStatus := strings.ToLower(strings.TrimSpace(asset.Status))
	currentUser := strings.TrimSpace(asset.UserUID)
	switch actionType {
	case "claim":
		available := currentUser == "" && ((category == "physical" && (assetStatus == "in_stock" || assetStatus == "idle")) || (category != "physical" && assetStatus == "active"))
		if !available {
			return httperror.New(http.StatusForbidden, "assets_assignment_claim_forbidden", "该资产当前不可由本人领用")
		}
		body["target_type"] = "user"
		body["target_ref"] = actor
	case "return":
		if category != "physical" || currentUser != actor {
			return httperror.New(http.StatusForbidden, "assets_assignment_return_forbidden", "只能归还当前由本人使用的实物资产")
		}
		body["target_type"] = "none"
		body["target_ref"] = nil
	case "release":
		if category == "physical" || currentUser != actor {
			return httperror.New(http.StatusForbidden, "assets_assignment_release_forbidden", "只能释放当前由本人使用的资源资产")
		}
		body["target_type"] = "none"
		body["target_ref"] = nil
	default:
		return httperror.New(http.StatusForbidden, "assets_assignment_request_action_forbidden", "本人资产申请只允许领用、归还或释放")
	}
	body["action_type"] = actionType
	body["status"] = "pending"
	return nil
}

func assignmentAssetMatchesUnit(asset assignmentAssetRecord, actor string, unit assetsScopeUnit) bool {
	if unit.DirectRelation && !assignmentAssetMatchesRelation(asset, actor, unit.RelationPredicates) {
		return false
	}
	if len(unit.DepartmentCodes) > 0 && !containsText(unit.DepartmentCodes, asset.DepartmentCode) {
		return false
	}
	if len(unit.ProjectCodes) > 0 && !containsText(unit.ProjectCodes, asset.ProjectCode) {
		return false
	}
	return unit.DirectRelation || len(unit.DepartmentCodes) > 0 || len(unit.ProjectCodes) > 0
}

func assignmentAssetMatchesRelation(asset assignmentAssetRecord, actor string, predicates []string) bool {
	for _, predicate := range normalizedAssetRelationPredicates(predicates) {
		switch predicate {
		case "owner":
			if asset.OwnerUID == actor {
				return true
			}
		case "custodian":
			if asset.CustodianUID == actor {
				return true
			}
		case "self", "user":
			if asset.UserUID == actor {
				return true
			}
		case "assigned":
			if asset.OwnerUID == actor || asset.CustodianUID == actor || asset.UserUID == actor {
				return true
			}
		}
	}
	return false
}

func containsText(values []string, target string) bool {
	for _, value := range values {
		if strings.TrimSpace(value) == strings.TrimSpace(target) && strings.TrimSpace(target) != "" {
			return true
		}
	}
	return false
}

func (a *Adapter) requireAssetItemObjectAccess(ctx context.Context, query url.Values, identifier string) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil || access == "all" {
		return err
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return err
	}
	where := "ai.public_id=?"
	args := []any{identifier}
	if id, parseErr := strconv.ParseInt(identifier, 10, 64); parseErr == nil && id > 0 {
		where = "(ai.public_id=? OR ai.id=?)"
		args = []any{identifier, id}
	}
	scopeWhere, scopeArgs := assetItemScopeWhere("ai", actor, units)
	args = append(args, scopeArgs...)
	var id int64
	err = a.DB().QueryRowContext(ctx, "SELECT ai.id FROM asset_items ai WHERE "+where+" AND ai.archived_at IS NULL AND "+scopeWhere+" LIMIT 1", args...).Scan(&id)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this record")
	}
	return err
}

func (a *Adapter) requireAssignmentObjectAccess(ctx context.Context, query url.Values, id int64) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil || access == "all" {
		return err
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return err
	}
	scopeWhere, scopeArgs := assignmentScopeWhere("assignment", "asset", actor, units)
	args := append([]any{id}, scopeArgs...)
	var matchedID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT assignment.id
		FROM asset_assignments assignment
		INNER JOIN asset_items asset ON asset.id=assignment.asset_id
		WHERE assignment.id=? AND asset.archived_at IS NULL AND `+scopeWhere+`
		LIMIT 1`, args...).Scan(&matchedID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this assignment")
	}
	return err
}

func (a *Adapter) requireAlertObjectAccess(ctx context.Context, query url.Values, id int64) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil || access == "all" {
		return err
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return err
	}
	scopeWhere, scopeArgs := alertScopeWhere("alert", "asset", actor, units)
	args := append([]any{id}, scopeArgs...)
	var matchedID int64
	err = a.DB().QueryRowContext(ctx, `
		SELECT alert.id
		FROM asset_alerts alert
		LEFT JOIN asset_items asset ON asset.id=alert.asset_id
		WHERE alert.id=? AND `+scopeWhere+`
		LIMIT 1`, args...).Scan(&matchedID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this alert")
	}
	return err
}

func (a *Adapter) requireIPAssetObjectAccess(ctx context.Context, query url.Values, identifier string) error {
	access, actor, err := assetsObjectAccess(query)
	if err != nil || access == "all" {
		return err
	}
	units, err := assetsScopeUnits(query)
	if err != nil {
		return err
	}
	scopeWhere, scopeArgs := ipAssetScopeWhere("ip", actor, units)
	var id int64
	err = a.DB().QueryRowContext(ctx, "SELECT ip.id FROM ip_assets ip WHERE ip.id=? AND "+scopeWhere+" LIMIT 1", append([]any{identifier}, scopeArgs...)...).Scan(&id)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusForbidden, "assets_object_scope_forbidden", "Assets object scope does not allow this record")
	}
	return err
}

func (a *Adapter) listScopedIPAssets(ctx context.Context, query url.Values) (map[string]any, error) {
	access, actor, err := assetsObjectAccess(query)
	if err != nil {
		return nil, err
	}
	page := positiveQueryInt(query.Get("page"), 1)
	pageSize := positiveQueryInt(query.Get("pageSize"), 20)
	if pageSize > 200 {
		pageSize = 200
	}
	where := []string{"1=1"}
	args := []any{}
	if access == "relation" {
		units, unitErr := assetsScopeUnits(query)
		if unitErr != nil {
			return nil, unitErr
		}
		scopeWhere, scopeArgs := ipAssetScopeWhere("ip", actor, units)
		where = append(where, scopeWhere)
		args = append(args, scopeArgs...)
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "ip.status=?")
		args = append(args, status)
	}
	keyword := strings.TrimSpace(firstText(query.Get("keyword"), query.Get("search")))
	if keyword != "" {
		like := "%" + keyword + "%"
		where = append(where, "(ip.ip_code LIKE ? OR ip.ip_name LIKE ? OR ip.registration_no LIKE ? OR ip.owner_uid LIKE ?)")
		args = append(args, like, like, like, like)
	}
	whereSQL := strings.Join(where, " AND ")
	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) FROM ip_assets ip WHERE "+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}
	rows, err := a.queryMaps(ctx, "SELECT ip.* FROM ip_assets ip WHERE "+whereSQL+" ORDER BY ip.id DESC LIMIT ? OFFSET ?", append(args, pageSize, (page-1)*pageSize)...)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": rows, "total": total, "page": page, "pageSize": pageSize}, nil
}

func positiveQueryInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}
