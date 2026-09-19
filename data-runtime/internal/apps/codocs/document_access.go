package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type documentAccessPolicy struct {
	ID                int64
	DocumentRefType   string
	DocumentUUID      string
	SourceApp         string
	SourceProjectCode string
	LifecycleStage    string
	Confidentiality   string
	DefaultPermission string
	AllowInternal     bool
	AllowCrossProject bool
	Readonly          bool
	CreatedBy         string
	UpdatedBy         string
	CreatedAt         string
	UpdatedAt         string
}

type documentAccessGrant struct {
	ID          int64  `json:"id"`
	PolicyID    int64  `json:"policyId"`
	SubjectType string `json:"subjectType"`
	SubjectCode string `json:"subjectCode"`
	Permission  string `json:"permission"`
	ExpiresAt   any    `json:"expiresAt"`
	CreatedBy   string `json:"createdBy"`
	CreatedAt   string `json:"createdAt"`
}

type documentAccessCheckResult struct {
	Allowed              bool   `json:"allowed"`
	Permission           string `json:"permission"`
	Readonly             bool   `json:"readonly"`
	Reason               string `json:"reason"`
	LifecycleStage       string `json:"lifecycleStage"`
	ConfidentialityLevel string `json:"confidentialityLevel"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F-]{8,64}$`)

const (
	aimsTrustedDocumentAccessProjectCodesQuery = "aims_trusted_document_access_project_codes"
	aimsTrustedDocumentAccessRolesQuery        = "aims_trusted_document_access_roles"
)

func isValidDocumentUUID(value string) bool {
	text := strings.TrimSpace(value)
	if text == "" {
		return false
	}
	return uuidPattern.MatchString(text)
}

func (a *Adapter) ensureDocumentAccessTables(ctx context.Context) error {
	policyExists, err := a.tableExists(ctx, "document_access_policies")
	if err != nil {
		return err
	}
	grantExists, err := a.tableExists(ctx, "document_access_grants")
	if err != nil {
		return err
	}
	auditExists, err := a.tableExists(ctx, "document_access_audit_logs")
	if err != nil {
		return err
	}
	if !policyExists || !grantExists || !auditExists {
		return httperror.New(http.StatusServiceUnavailable, "document_access_tables_missing", "Document access tables are not ready")
	}
	return nil
}

func firstTextValue(source map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := source[key]; ok {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func parseStringSlice(value any) []string {
	if value == nil {
		return nil
	}
	if values, ok := value.([]string); ok {
		return values
	}
	if values, ok := value.([]any); ok {
		result := make([]string, 0, len(values))
		for _, item := range values {
			text := strings.TrimSpace(fmt.Sprint(item))
			if text != "" && text != "<nil>" {
				result = append(result, text)
			}
		}
		return result
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	parts := strings.Split(text, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func parseBoolValue(source map[string]any, key string, fallback bool) bool {
	value, ok := source[key]
	if !ok || value == nil {
		return fallback
	}
	text := strings.TrimSpace(strings.ToLower(fmt.Sprint(value)))
	if text == "" || text == "<nil>" {
		return fallback
	}
	return text == "1" || text == "true" || text == "yes"
}

func permissionRank(permission string) int {
	switch permission {
	case "edit":
		return 3
	case "download":
		return 2
	case "view":
		return 1
	default:
		return 0
	}
}

func policyReadonly(policy documentAccessPolicy) bool {
	return policy.Readonly || policy.LifecycleStage == "archived"
}

func (a *Adapter) ensurePolicyDefault(ctx context.Context, documentRefType string, documentUUID string, sourceApp string, sourceProjectCode string, actorUID string, persist ...bool) (documentAccessPolicy, error) {
	var policy documentAccessPolicy
	err := a.db.QueryRowContext(ctx, `
		SELECT id, document_ref_type, document_uuid, source_app, source_project_code,
		       lifecycle_stage, confidentiality_level, default_permission,
		       allow_internal_access, allow_cross_project, readonly,
		       created_by, updated_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM document_access_policies
		WHERE document_ref_type = ? AND document_uuid = ?
		LIMIT 1
	`, documentRefType, documentUUID).Scan(
		&policy.ID,
		&policy.DocumentRefType,
		&policy.DocumentUUID,
		&policy.SourceApp,
		&policy.SourceProjectCode,
		&policy.LifecycleStage,
		&policy.Confidentiality,
		&policy.DefaultPermission,
		&policy.AllowInternal,
		&policy.AllowCrossProject,
		&policy.Readonly,
		&policy.CreatedBy,
		&policy.UpdatedBy,
		&policy.CreatedAt,
		&policy.UpdatedAt,
	)
	if err == nil {
		return policy, nil
	}
	if err != sql.ErrNoRows {
		return policy, err
	}
	// Reading an absent policy exposes the restrictive default without creating
	// business state. Only an explicit policy write may materialize it.
	if len(persist) > 0 && !persist[0] {
		return documentAccessPolicy{DocumentRefType: documentRefType, DocumentUUID: documentUUID,
			SourceApp: sourceApp, SourceProjectCode: sourceProjectCode, LifecycleStage: "draft",
			Confidentiality: "L2", DefaultPermission: "none"}, nil
	}

	creator := strings.TrimSpace(actorUID)
	if creator == "" {
		creator = "system"
	}

	result, err := a.db.ExecContext(ctx, `
		INSERT INTO document_access_policies
		(document_ref_type, document_uuid, source_app, source_project_code,
		 lifecycle_stage, confidentiality_level, default_permission,
		 allow_internal_access, allow_cross_project, readonly,
		 created_by, updated_by)
		VALUES (?, ?, ?, ?, 'draft', 'L2', 'none', 0, 0, 0, ?, ?)
	`, documentRefType, documentUUID, sourceApp, sourceProjectCode, creator, creator)
	if err != nil {
		return policy, err
	}
	insertID, _ := result.LastInsertId()
	policy = documentAccessPolicy{
		ID:                insertID,
		DocumentRefType:   documentRefType,
		DocumentUUID:      documentUUID,
		SourceApp:         sourceApp,
		SourceProjectCode: sourceProjectCode,
		LifecycleStage:    "draft",
		Confidentiality:   "L2",
		DefaultPermission: "none",
		AllowInternal:     false,
		AllowCrossProject: false,
		Readonly:          false,
		CreatedBy:         creator,
		UpdatedBy:         creator,
	}
	return policy, nil
}

func (a *Adapter) loadPolicyGrants(ctx context.Context, policyID int64) ([]documentAccessGrant, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, policy_id, subject_type, subject_code, permission,
		       expires_at, created_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM document_access_grants
		WHERE policy_id = ? AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY id ASC
	`, policyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	grants := make([]documentAccessGrant, 0)
	for rows.Next() {
		var grant documentAccessGrant
		if err := rows.Scan(&grant.ID, &grant.PolicyID, &grant.SubjectType, &grant.SubjectCode, &grant.Permission, &grant.ExpiresAt, &grant.CreatedBy, &grant.CreatedAt); err != nil {
			return nil, err
		}
		grants = append(grants, grant)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return grants, nil
}

func trustedDocumentAccessActorFacts(query url.Values) (string, []string, error) {
	actorUID := actorFromQuery(query)
	if actorUID == "" {
		return "", nil, httperror.New(http.StatusUnauthorized, "current_user_required", "Current user is required")
	}
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return "", nil, httperror.New(http.StatusForbidden, "trusted_actor_required", "Trusted runtime actor delegation is required")
	}
	return actorUID, parseStringSlice(query.Get("current_user_dept_codes")), nil
}

func trustedAimsDocumentAccessScopeFacts(query url.Values) ([]string, []string) {
	if query.Get("hzy_runtime_actor_delegated") != "1" {
		return nil, nil
	}
	sourceApp := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(query.Get("hzy_runtime_source_app"))), ".runtime")
	trustedCodocsProxy := sourceApp == "codocs" && query.Get("hzy_runtime_actor_purpose") == "service-command" && query.Get("codocs_trusted_aims_document_access") == "1"
	if sourceApp != "aims" && !trustedCodocsProxy {
		return nil, nil
	}
	return parseStringSlice(query.Get(aimsTrustedDocumentAccessProjectCodesQuery)),
		parseStringSlice(query.Get(aimsTrustedDocumentAccessRolesQuery))
}

func (a *Adapter) recordDocumentAccessAudit(ctx context.Context, policy documentAccessPolicy, actorUID string, action string, result documentAccessCheckResult, actorProjectCodes []string, actorDeptCodes []string, actorRoles []string) {
	actorSnapshot := map[string]any{
		"projects": actorProjectCodes,
		"depts":    actorDeptCodes,
		"roles":    actorRoles,
	}
	jsonBytes, err := json.Marshal(actorSnapshot)
	if err != nil {
		jsonBytes = []byte("[]")
	}
	decision := "deny"
	if result.Allowed {
		decision = "allow"
	}
	_, _ = a.db.ExecContext(ctx, `
		INSERT INTO document_access_audit_logs
		(document_ref_type, document_uuid, actor_uid, action, decision, reason, source_project_code, actor_project_codes)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, policy.DocumentRefType, policy.DocumentUUID, nullableString(actorUID), action, decision, result.Reason, nullableString(policy.SourceProjectCode), string(jsonBytes))
}

func (a *Adapter) documentAccessCheck(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	actorUID, actorDeptCodes, err := trustedDocumentAccessActorFacts(query)
	if err != nil {
		return nil, err
	}
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}

	documentUUID := firstTextValue(body, "documentUuid", "document_uuid")
	if documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid is required")
	}
	if !isValidDocumentUUID(documentUUID) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid format is invalid")
	}
	documentRefType := firstTextValue(body, "documentRefType", "document_ref_type")
	if documentRefType == "" {
		documentRefType = "codocs_document"
	}
	sourceApp := firstTextValue(body, "sourceApp", "source_app")
	if sourceApp == "" {
		sourceApp = "aims"
	}
	sourceProjectCode := firstTextValue(body, "sourceProjectCode", "source_project_code")
	action := firstTextValue(body, "action")
	if action == "" {
		action = "view"
	}

	// Checks also serve read-only document listings; retain audit logging, but
	// never create or repair authorization policy as a side effect of a read.
	policy, err := a.ensurePolicyDefault(ctx, documentRefType, documentUUID, sourceApp, sourceProjectCode, actorUID, false)
	if err != nil {
		return nil, err
	}
	grants, err := a.loadPolicyGrants(ctx, policy.ID)
	if err != nil {
		return nil, err
	}

	// Aims derives project membership and application roles from its own
	// authoritative runtime before calling Codocs. Foundation signs the full
	// request target, so only these Aims-owned query markers can carry those
	// facts; identically named request-body claims remain untrusted and ignored.
	actorProjectCodes, actorRoles := trustedAimsDocumentAccessScopeFacts(query)

	result := documentAccessCheckResult{
		Allowed:              false,
		Permission:           "none",
		Readonly:             policyReadonly(policy),
		Reason:               "not_allowed",
		LifecycleStage:       policy.LifecycleStage,
		ConfidentialityLevel: policy.Confidentiality,
	}

	isSourceProjectMember := false
	if policy.SourceProjectCode != "" {
		for _, code := range actorProjectCodes {
			if strings.EqualFold(strings.TrimSpace(code), policy.SourceProjectCode) {
				isSourceProjectMember = true
				break
			}
		}
	}

	if action == "edit" && policyReadonly(policy) {
		result.Reason = "readonly"
		a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
		return map[string]any(resultToMap(result)), nil
	}

	if isSourceProjectMember {
		result.Allowed = true
		result.Permission = action
		result.Reason = "source_project_member"
		a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
		return map[string]any(resultToMap(result)), nil
	}

	if policy.LifecycleStage == "draft" {
		result.Reason = "draft_requires_project_member"
		a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
		return map[string]any(resultToMap(result)), nil
	}

	if (policy.Confidentiality == "L0" || policy.Confidentiality == "L1") && policy.AllowInternal {
		if action == "view" || (action == "download" && permissionRank(policy.DefaultPermission) >= permissionRank("download")) {
			result.Allowed = true
			result.Permission = action
			result.Reason = "internal_access"
			a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
			return map[string]any(resultToMap(result)), nil
		}
	}

	matchGrant := func(grant documentAccessGrant) bool {
		if permissionRank(grant.Permission) < permissionRank(action) {
			return false
		}
		subjectCode := strings.TrimSpace(grant.SubjectCode)
		switch grant.SubjectType {
		case "user":
			return actorUID != "" && subjectCode == actorUID
		case "project":
			if !policy.AllowCrossProject || policy.Confidentiality == "L3" {
				return false
			}
			for _, code := range actorProjectCodes {
				if strings.TrimSpace(code) == subjectCode {
					return true
				}
			}
		case "dept":
			if policy.Confidentiality == "L3" {
				return false
			}
			for _, code := range actorDeptCodes {
				if strings.TrimSpace(code) == subjectCode {
					return true
				}
			}
		case "role":
			for _, role := range actorRoles {
				if strings.TrimSpace(role) == subjectCode {
					return true
				}
			}
		}
		return false
	}

	for _, grant := range grants {
		if matchGrant(grant) {
			result.Allowed = true
			result.Permission = grant.Permission
			result.Reason = "granted_by_" + grant.SubjectType
			break
		}
	}

	if !result.Allowed {
		result.Reason = "no_matching_grant"
	}

	a.recordDocumentAccessAudit(ctx, policy, actorUID, action, result, actorProjectCodes, actorDeptCodes, actorRoles)
	return map[string]any(resultToMap(result)), nil
}

func resultToMap(result documentAccessCheckResult) map[string]any {
	return map[string]any{
		"allowed":              result.Allowed,
		"permission":           result.Permission,
		"readonly":             result.Readonly,
		"reason":               result.Reason,
		"lifecycleStage":       result.LifecycleStage,
		"confidentialityLevel": result.ConfidentialityLevel,
	}
}

func (a *Adapter) getDocumentAccessPolicy(ctx context.Context, documentUUID string, query url.Values) (map[string]any, error) {
	actorUID, _, err := trustedDocumentAccessActorFacts(query)
	if err != nil {
		return nil, err
	}
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}
	if !isValidDocumentUUID(documentUUID) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid format is invalid")
	}
	documentRefType := strings.TrimSpace(query.Get("documentRefType"))
	if documentRefType == "" {
		documentRefType = "codocs_document"
	}
	policy, err := a.ensurePolicyDefault(ctx, documentRefType, strings.TrimSpace(documentUUID), "aims", strings.TrimSpace(query.Get("sourceProjectCode")), actorUID, false)
	if err != nil {
		return nil, err
	}
	grants, err := a.loadPolicyGrants(ctx, policy.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":                   policy.ID,
		"documentRefType":      policy.DocumentRefType,
		"documentUuid":         policy.DocumentUUID,
		"sourceApp":            policy.SourceApp,
		"sourceProjectCode":    policy.SourceProjectCode,
		"lifecycleStage":       policy.LifecycleStage,
		"confidentialityLevel": policy.Confidentiality,
		"defaultPermission":    policy.DefaultPermission,
		"allowInternalAccess":  policy.AllowInternal,
		"allowCrossProject":    policy.AllowCrossProject,
		"readonly":             policyReadonly(policy),
		"grants":               grants,
	}, nil
}

func (a *Adapter) updateDocumentAccessPolicy(ctx context.Context, documentUUID string, query url.Values, body map[string]any) (map[string]any, error) {
	operatorUID, _, err := trustedDocumentAccessActorFacts(query)
	if err != nil {
		return nil, err
	}
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}
	if !isValidDocumentUUID(documentUUID) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_uuid", "documentUuid format is invalid")
	}
	documentRefType := firstTextValue(body, "documentRefType", "document_ref_type")
	if documentRefType == "" {
		documentRefType = "codocs_document"
	}
	policy, err := a.ensurePolicyDefault(ctx, documentRefType, strings.TrimSpace(documentUUID), firstTextValue(body, "sourceApp", "source_app"), firstTextValue(body, "sourceProjectCode", "source_project_code"), operatorUID)
	if err != nil {
		return nil, err
	}

	lifecycle := firstTextValue(body, "lifecycleStage", "lifecycle_stage")
	if lifecycle == "" {
		lifecycle = policy.LifecycleStage
	}
	confidentiality := firstTextValue(body, "confidentialityLevel", "confidentiality_level")
	if confidentiality == "" {
		confidentiality = policy.Confidentiality
	}
	defaultPermission := firstTextValue(body, "defaultPermission", "default_permission")
	if defaultPermission == "" {
		defaultPermission = policy.DefaultPermission
	}
	allowInternal := parseBoolValue(body, "allowInternalAccess", policy.AllowInternal)
	allowCrossProject := parseBoolValue(body, "allowCrossProject", policy.AllowCrossProject)
	readonly := parseBoolValue(body, "readonly", policy.Readonly) || lifecycle == "archived"

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	_, err = tx.ExecContext(ctx, `
		UPDATE document_access_policies
		SET source_app = ?,
		    source_project_code = ?,
		    lifecycle_stage = ?,
		    confidentiality_level = ?,
		    default_permission = ?,
		    allow_internal_access = ?,
		    allow_cross_project = ?,
		    readonly = ?,
		    updated_by = ?,
		    updated_at = NOW()
		WHERE id = ?
	`, nullableString(firstTextValue(body, "sourceApp", "source_app")), nullableString(firstTextValue(body, "sourceProjectCode", "source_project_code")), lifecycle, confidentiality, defaultPermission, boolInt(allowInternal), boolInt(allowCrossProject), boolInt(readonly), operatorUID, policy.ID)
	if err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, "DELETE FROM document_access_grants WHERE policy_id = ?", policy.ID); err != nil {
		return nil, err
	}

	if rawGrants, ok := body["grants"].([]any); ok {
		for _, rawGrant := range rawGrants {
			grantMap, ok := rawGrant.(map[string]any)
			if !ok {
				continue
			}
			subjectType := firstTextValue(grantMap, "subjectType", "subject_type")
			subjectCode := firstTextValue(grantMap, "subjectCode", "subject_code")
			permission := firstTextValue(grantMap, "permission")
			if subjectType == "" || subjectCode == "" || permission == "" {
				continue
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO document_access_grants
				(policy_id, subject_type, subject_code, permission, expires_at, created_by)
				VALUES (?, ?, ?, ?, ?, ?)
			`, policy.ID, subjectType, subjectCode, permission, normalizeBodyNullable(grantMap["expiresAt"]), operatorUID); err != nil {
				return nil, err
			}
		}
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO document_access_audit_logs
		(document_ref_type, document_uuid, actor_uid, action, decision, reason, source_project_code, actor_project_codes)
		VALUES (?, ?, ?, 'policy_update', 'allow', 'policy_updated', ?, '[]')
	`, documentRefType, strings.TrimSpace(documentUUID), operatorUID, nullableString(firstTextValue(body, "sourceProjectCode", "source_project_code"))); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	readQuery := make(url.Values, len(query)+1)
	for key, values := range query {
		readQuery[key] = append([]string(nil), values...)
	}
	readQuery.Set("documentRefType", documentRefType)
	return a.getDocumentAccessPolicy(ctx, strings.TrimSpace(documentUUID), readQuery)
}

func (a *Adapter) listDocumentAccessAuditLogs(ctx context.Context, query url.Values) (map[string]any, error) {
	if _, _, err := trustedDocumentAccessActorFacts(query); err != nil {
		return nil, err
	}
	if err := a.ensureDocumentAccessTables(ctx); err != nil {
		return nil, err
	}
	documentUUID := strings.TrimSpace(query.Get("documentUuid"))
	pageSize := parseIntDefault(query.Get("pageSize"), 50)
	if pageSize <= 0 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	page := parseIntDefault(query.Get("page"), 1)
	if page <= 0 {
		page = 1
	}
	offset := (page - 1) * pageSize

	whereSQL := ""
	args := make([]any, 0)
	if documentUUID != "" {
		whereSQL = "WHERE document_uuid = ?"
		args = append(args, documentUUID)
	}

	countSQL := "SELECT COUNT(*) FROM document_access_audit_logs " + whereSQL
	var total int64
	if err := a.db.QueryRowContext(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	listSQL := `
		SELECT id, document_ref_type, document_uuid, actor_uid, action, decision, reason,
		       source_project_code, actor_project_codes,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM document_access_audit_logs ` + whereSQL + `
		ORDER BY id DESC
		LIMIT ? OFFSET ?`
	args = append(args, pageSize, offset)

	rows, err := a.db.QueryContext(ctx, listSQL, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int64
		var documentRefType string
		var docUUID string
		var actorUID sql.NullString
		var action string
		var decision string
		var reason string
		var sourceProjectCode sql.NullString
		var actorProjectCodes sql.NullString
		var createdAt string
		if err := rows.Scan(&id, &documentRefType, &docUUID, &actorUID, &action, &decision, &reason, &sourceProjectCode, &actorProjectCodes, &createdAt); err != nil {
			return nil, err
		}
		items = append(items, map[string]any{
			"id":                id,
			"documentRefType":   documentRefType,
			"documentUuid":      docUUID,
			"actorUid":          nullableStringValue(actorUID),
			"action":            action,
			"decision":          decision,
			"reason":            reason,
			"sourceProjectCode": nullableStringValue(sourceProjectCode),
			"actorProjectCodes": nullableStringValue(actorProjectCodes),
			"createdAt":         createdAt,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page,
		"pageSize": pageSize,
	}, nil
}

func parseIntDefault(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}

func nullableStringValue(value sql.NullString) any {
	if !value.Valid {
		return nil
	}
	return value.String
}
