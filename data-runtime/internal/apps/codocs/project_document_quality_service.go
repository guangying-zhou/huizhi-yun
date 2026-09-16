package codocs

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const (
	aimsDocumentVersionResolveOperation  = "aims.codocs.project-document.version-resolve.v1"
	aimsDocumentVersionResolveCapability = "codocs:project-document:version:resolve"
	aimsDocumentVersionResolveSchema     = "aims.codocs.project-document.version.resolve.v1"

	aimsDocumentReviewContentOperation  = "aims.codocs.project-document.review-content.v1"
	aimsDocumentReviewContentCapability = "codocs:project-document:review-content:read"
	aimsDocumentReviewContentSchema     = "aims.codocs.project-document.review-content.v1"

	aimsDocumentReviewGrantOperation  = "aims.codocs.deliverable-review-grant.v1"
	aimsDocumentReviewGrantCapability = "codocs:project-document:review-grant:create"
	aimsDocumentReviewGrantSchema     = "aims.codocs.project-document.review-grant.v1"
)

func (a *Adapter) handleProjectDocumentQualityService(
	ctx context.Context,
	suffix string,
	query url.Values,
	body map[string]any,
) (map[string]any, string, bool, error) {
	const prefix = "service/project-documents/"
	rest := strings.TrimPrefix(suffix, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) < 3 || parts[1] != "versions" {
		return nil, "", false, nil
	}
	uuid := strings.TrimSpace(parts[0])
	if len(parts) == 3 && strings.HasSuffix(parts[2], ":resolve") {
		versionID := strings.TrimSuffix(parts[2], ":resolve")
		result, err := a.resolveProjectDocumentVersion(ctx, uuid, versionID, query, body)
		return result, "codocs.service.project_document.version.resolve", true, err
	}
	if len(parts) == 4 && parts[3] == "review-content" {
		result, err := a.reviewProjectDocumentVersionContent(ctx, uuid, parts[2], query, body)
		return result, "codocs.service.project_document.review_content", true, err
	}
	return nil, "", false, nil
}

func projectDocumentQualityCommand(
	body map[string]any,
	query url.Values,
	expectedOperation string,
	expectedCapability string,
	expectedSchema string,
	expectedAction string,
	uuid string,
	versionID string,
) (map[string]any, error) {
	serviceCommand, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusForbidden, "project_document_quality_command_required", "signed project document quality command is required")
	}
	command, ok := serviceCommand["command"].(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusForbidden, "project_document_quality_command_invalid", "project document quality command is invalid")
	}
	actorUID := strings.TrimSpace(firstTextValue(command, "actorUid"))
	invalid :=
		strings.TrimSpace(firstTextValue(serviceCommand, "targetApp")) != "codocs" ||
			strings.TrimSpace(firstTextValue(serviceCommand, "operationCode")) != expectedOperation ||
			strings.TrimSpace(firstTextValue(serviceCommand, "requiredCapability")) != expectedCapability ||
			strings.TrimSpace(firstTextValue(serviceCommand, "commandSchemaVersion")) != expectedSchema ||
			strings.TrimSpace(firstTextValue(command, "documentUuid")) != strings.TrimSpace(uuid) ||
			strings.TrimSpace(firstTextValue(command, "versionId")) != strings.TrimSpace(versionID) ||
			strings.TrimSpace(firstTextValue(command, "action")) != expectedAction ||
			actorUID == "" ||
			strings.TrimSpace(query.Get("current_user")) != actorUID ||
			query.Get("hzy_runtime_actor_delegated") != "1" ||
			strings.TrimSpace(query.Get("hzy_runtime_actor_purpose")) != "service-command" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceAppKey)) != "aims" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandTargetAppKey)) != "codocs" ||
			strings.TrimSpace(firstTextValue(body, integrationoperation.TrustedServiceCommandSourceClientKey)) != "aims.runtime"
	if invalid {
		return nil, httperror.New(http.StatusForbidden, "project_document_quality_command_invalid", "project document quality command binding is invalid")
	}
	return command, nil
}

func (a *Adapter) resolveProjectDocumentVersion(
	ctx context.Context,
	uuid string,
	rawVersionID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	if _, err := projectDocumentQualityCommand(
		body, query,
		aimsDocumentVersionResolveOperation,
		aimsDocumentVersionResolveCapability,
		aimsDocumentVersionResolveSchema,
		"version:resolve",
		uuid,
		rawVersionID,
	); err != nil {
		return nil, err
	}
	if _, err := a.documentAccess(ctx, uuid, query); err != nil {
		return nil, err
	}
	versionID, err := strconv.ParseInt(rawVersionID, 10, 64)
	resolveLatest := rawVersionID == "latest"
	if !resolveLatest && (err != nil || versionID <= 0) {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_version_id", "document version id is invalid")
	}
	var documentID, resolvedVersionID int64
	var versionNum int
	var title, createdAt string
	var contentSHA256 sql.NullString
	versionCondition := "v.id = ?"
	versionArgs := []any{uuid, versionID}
	versionOrder := ""
	if resolveLatest {
		versionCondition = "1 = 1"
		versionArgs = []any{uuid}
		versionOrder = " ORDER BY v.version_num DESC, v.id DESC LIMIT 1"
	}
	err = a.db.QueryRowContext(ctx, `
		SELECT d.id, v.id, v.version_num, d.title, v.content_sha256,
		       DATE_FORMAT(v.created_at, '%Y-%m-%dT%H:%i:%s.%fZ')
		FROM documents d
		INNER JOIN document_versions v ON v.document_id = d.id
		WHERE d.uuid = ? AND `+versionCondition+` AND d.status = 1
		`+versionOrder, versionArgs...).Scan(&documentID, &resolvedVersionID, &versionNum, &title, &contentSHA256, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "document_version_not_found", "document version not found")
	}
	if err != nil {
		return nil, err
	}
	if !contentSHA256.Valid || !validProjectDocumentSHA256(contentSHA256.String) {
		return nil, httperror.New(http.StatusConflict, "document_version_hash_backfill_required", "document version hash must be backfilled before quality review")
	}
	return map[string]any{
		"documentId":    documentID,
		"documentUuid":  uuid,
		"versionId":     resolvedVersionID,
		"versionNum":    versionNum,
		"title":         title,
		"contentSha256": contentSHA256.String,
		"createdAt":     createdAt,
	}, nil
}

func validProjectDocumentSHA256(value string) bool {
	decoded, err := hex.DecodeString(strings.TrimSpace(value))
	return err == nil && len(decoded) == 32
}

func (a *Adapter) reviewProjectDocumentVersionContent(
	ctx context.Context,
	uuid string,
	rawVersionID string,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	command, err := projectDocumentQualityCommand(
		body, query,
		aimsDocumentReviewContentOperation,
		aimsDocumentReviewContentCapability,
		aimsDocumentReviewContentSchema,
		"review-content:read",
		uuid,
		rawVersionID,
	)
	if err != nil {
		return nil, err
	}
	versionID, err := strconv.ParseInt(rawVersionID, 10, 64)
	if err != nil || versionID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_version_id", "document version id is invalid")
	}
	submissionNo := strings.TrimSpace(firstTextValue(command, "submissionNo"))
	roleCode := strings.TrimSpace(firstTextValue(command, "roleCode"))
	if submissionNo == "" || (roleCode != "qa" && roleCode != "project_director") {
		return nil, httperror.New(http.StatusForbidden, "document_review_grant_binding_invalid", "document review grant binding is invalid")
	}
	var title, docType, contentSHA256 string
	var ossPath, ossVersionID sql.NullString
	var versionNum int
	var contentSize int64
	err = a.db.QueryRowContext(ctx, `
		SELECT d.title, d.doc_type, d.oss_path, v.oss_version_id,
		       v.version_num, v.content_size, v.content_sha256
		FROM document_review_grants grant
		INNER JOIN documents d ON d.id = grant.document_id
		INNER JOIN document_versions v ON v.id = grant.document_version_id
		WHERE grant.document_uuid = ?
		  AND grant.document_version_id = ?
		  AND grant.submission_no = ?
		  AND grant.grantee_role_code = ?
		  AND grant.revoked_at IS NULL
		  AND d.status = 1
	`, uuid, versionID, submissionNo, roleCode).Scan(
		&title, &docType, &ossPath, &ossVersionID, &versionNum, &contentSize, &contentSHA256,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusForbidden, "document_review_grant_required", "active document review grant is required")
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"documentUuid":  uuid,
		"versionId":     versionID,
		"versionNum":    versionNum,
		"title":         title,
		"docType":       docType,
		"ossPath":       ossPath.String,
		"ossVersionId":  ossVersionID.String,
		"contentSize":   contentSize,
		"contentSha256": contentSHA256,
	}, nil
}

func (a *Adapter) createProjectDocumentReviewGrant(
	ctx context.Context,
	query url.Values,
	body map[string]any,
) (map[string]any, error) {
	serviceCommand, ok := body[integrationoperation.ServiceCommandEnvelopeKey].(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusForbidden, "project_document_review_grant_command_required", "signed review grant command is required")
	}
	command, ok := serviceCommand["command"].(map[string]any)
	if !ok {
		return nil, httperror.New(http.StatusForbidden, "project_document_review_grant_command_invalid", "review grant command is invalid")
	}
	uuid := strings.TrimSpace(firstTextValue(command, "documentUuid"))
	versionID := strings.TrimSpace(firstTextValue(command, "versionId"))
	if _, err := projectDocumentQualityCommand(
		body, query,
		aimsDocumentReviewGrantOperation,
		aimsDocumentReviewGrantCapability,
		aimsDocumentReviewGrantSchema,
		"review-grant:create",
		uuid,
		versionID,
	); err != nil {
		return nil, err
	}
	parsedVersionID, err := strconv.ParseInt(versionID, 10, 64)
	if err != nil || parsedVersionID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_version_id", "document version id is invalid")
	}
	submissionNo := strings.TrimSpace(firstTextValue(command, "submissionNo"))
	roleCode := strings.TrimSpace(firstTextValue(command, "granteeRoleCode"))
	grantedBy := strings.TrimSpace(firstTextValue(command, "actorUid"))
	if submissionNo == "" || (roleCode != "qa" && roleCode != "project_director") {
		return nil, httperror.New(http.StatusBadRequest, "invalid_document_review_grant", "submissionNo and supported granteeRoleCode are required")
	}
	var documentID int64
	err = a.db.QueryRowContext(ctx, `
		SELECT d.id
		FROM documents d
		INNER JOIN document_versions v ON v.document_id = d.id
		WHERE d.uuid = ? AND v.id = ?
		  AND v.content_sha256 REGEXP '^[0-9a-fA-F]{64}$'
	`, uuid, parsedVersionID).Scan(&documentID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "document_version_not_found", "hashed document version not found")
	}
	if err != nil {
		return nil, err
	}
	result, err := a.db.ExecContext(ctx, `
		INSERT INTO document_review_grants (
		  document_id, document_version_id, document_uuid, submission_no,
		  grantee_role_code, source_app, granted_by
		) VALUES (?, ?, ?, ?, ?, 'aims', ?)
		ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)
	`, documentID, parsedVersionID, uuid, submissionNo, roleCode, grantedBy)
	if err != nil {
		return nil, err
	}
	grantID, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"grantId":         grantID,
		"documentUuid":    uuid,
		"versionId":       parsedVersionID,
		"submissionNo":    submissionNo,
		"granteeRoleCode": roleCode,
	}, nil
}
