package codocs

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const companyWeeklySummaryContextPrincipal = "service:aims:company-weekly-summary"

func (a *Adapter) publishCompanyWeeklySummary(
	ctx context.Context,
	periodKey string,
	body map[string]any,
) (map[string]any, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"codocs",
		"aims.company-weekly-summary.codocs-publish.v1",
		"codocs:company-weekly-summary:publish",
	)
	if err != nil {
		return nil, codocsServiceCommandReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "aims" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be aims")
	}
	if stringValue(command["periodKey"]) != periodKey {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_period_mismatch", "summary period does not match the service command")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	command["markdownContent"] = rawCompanySummaryString(body["markdownContent"])
	command["ossPath"] = stringValue(body["ossPath"])
	command["ossVersionId"] = stringValue(body["ossVersionId"])
	command["documentUrl"] = stringValue(body["documentUrl"])
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(
		ctx context.Context,
		tx *sql.Tx,
		_ json.RawMessage,
	) (integrationoperation.ReceiptBusinessResult, error) {
		result, err := a.publishCompanyWeeklySummaryTx(ctx, tx, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "company_weekly_summary_document",
			TargetBizCode: periodKey,
			HTTPStatus:    http.StatusOK,
			Value:         result,
		}, nil
	})
	if err != nil {
		return nil, codocsServiceCommandReceiptError(err)
	}
	response := map[string]any{
		"receiptId":             executed.ReceiptID,
		"receiptStatus":         "succeeded",
		"operationId":           receiptInput.OperationID,
		"operationCode":         receiptInput.OperationCode,
		"idempotencyKey":        receiptInput.IdempotencyKey,
		"commandSchemaVersion":  receiptInput.CommandSchemaVersion,
		"commandSha256":         receiptInput.CommandSHA256,
		"idempotent":            executed.Existing,
		"targetBizType":         executed.TargetBizType,
		"targetBizCode":         executed.TargetBizCode,
		"responseSummarySha256": executed.ResponseSummarySHA256,
		"result":                executed.Value,
	}
	return response, nil
}

func (a *Adapter) publishCompanyWeeklySummaryTx(
	ctx context.Context,
	tx *sql.Tx,
	body map[string]any,
) (map[string]any, error) {
	periodKey := stringValue(body["periodKey"])
	title := strings.TrimSpace(stringValue(body["title"]))
	operatorUID := strings.TrimSpace(stringValue(body["operatorUid"]))
	markdown := rawCompanySummaryString(body["markdownContent"])
	markdownHash := strings.TrimSpace(stringValue(body["markdownSha256"]))
	ossPath := strings.TrimSpace(stringValue(body["ossPath"]))
	ossVersionID := strings.TrimSpace(stringValue(body["ossVersionId"]))
	documentURL := strings.TrimSpace(stringValue(body["documentUrl"]))
	revision, err := positiveCompanySummaryCommandInt(body["revisionNo"])
	if err != nil {
		return nil, err
	}
	if !isCompanySummaryPeriodKey(periodKey) || title == "" || operatorUID == "" ||
		markdown == "" || !isCompanySummarySHA256(markdownHash) || companySummarySHA256([]byte(markdown)) != markdownHash {
		return nil, httperror.New(http.StatusBadRequest, "company_weekly_summary_command_invalid", "company weekly summary command is invalid")
	}
	expectedPath := fmt.Sprintf("codocs/publish/company/%s/company-weekly-summary.md", periodKey)
	if ossPath != expectedPath || ossVersionID == "" {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_oss_binding_invalid", "summary object storage evidence is invalid")
	}
	recipients, err := companySummaryCommandStringSlice(body["recipientUids"])
	if err != nil {
		return nil, err
	}

	var documentID int64
	var documentUUID, currentType, currentPath string
	var readonlyFlag int
	err = tx.QueryRowContext(ctx, `
		SELECT document.id, document.uuid, document.doc_type, document.oss_path, document.readonly_flag
		FROM documents document
		INNER JOIN document_relations relation
		  ON relation.document_id = document.id
		 AND relation.related_uid = ?
		 AND relation.relation_type = 'source'
		 AND relation.source_type = 'aims_company_weekly_summary'
		 AND relation.source_id = ?
		 AND relation.status = 1
		WHERE document.status <> 0
		LIMIT 1
		FOR UPDATE
	`, companyWeeklySummaryContextPrincipal, periodKey).Scan(
		&documentID, &documentUUID, &currentType, &currentPath, &readonlyFlag,
	)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		documentUUID, err = randomUUID()
		if err != nil {
			return nil, err
		}
		result, err := tx.ExecContext(ctx, `
			INSERT INTO documents (
			  uuid, title, doc_type, oss_path, owner_uid, readonly_flag, status,
			  content_size, last_editor_uid, publish_info, created_at, updated_at
			) VALUES (?, ?, 'company', ?, ?, 1, 2, ?, ?, ?, NOW(), NOW())
		`, documentUUID, title, ossPath, operatorUID, len([]byte(markdown)), operatorUID,
			fmt.Sprintf("Aims 公司项目周报汇总 %s R%d", periodKey, revision))
		if err != nil {
			return nil, err
		}
		documentID, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
	} else if currentType != "company" || currentPath != ossPath || readonlyFlag != 1 {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_document_binding_conflict", "existing summary document binding is invalid")
	}

	var documentVersionID int64
	var existingHash string
	err = tx.QueryRowContext(ctx, `
		SELECT id, COALESCE(content_sha256, '')
		FROM document_versions
		WHERE document_id = ? AND version_num = ?
		FOR UPDATE
	`, documentID, revision).Scan(&documentVersionID, &existingHash)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		result, err := tx.ExecContext(ctx, `
			INSERT INTO document_versions (
			  document_id, version_num, oss_version_id, editor_uid,
			  change_summary, content_size, content_sha256
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`, documentID, revision, ossVersionID, operatorUID,
			fmt.Sprintf("Aims 公司项目周报汇总 %s R%d", periodKey, revision),
			len([]byte(markdown)), markdownHash)
		if err != nil {
			return nil, err
		}
		documentVersionID, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
	} else if existingHash != markdownHash {
		return nil, httperror.New(http.StatusConflict, "company_weekly_summary_version_hash_conflict", "document revision already exists with another content hash")
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE documents
		SET title = ?, status = 2, readonly_flag = 1, content_size = ?,
		    last_editor_uid = ?, oss_commit_id = ?, committed_at = NOW(),
		    publish_info = ?, updated_at = NOW()
		WHERE id = ? AND uuid = ?
	`, title, len([]byte(markdown)), operatorUID, ossVersionID,
		fmt.Sprintf("Aims 公司项目周报汇总 %s R%d", periodKey, revision),
		documentID, documentUUID); err != nil {
		return nil, err
	}

	if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
		DocumentID:   documentID,
		DocumentUUID: documentUUID,
		RelatedUID:   companyWeeklySummaryContextPrincipal,
		RelationType: "source",
		SourceType:   "aims_company_weekly_summary",
		SourceID:     periodKey,
		CanRead:      false,
		CanEdit:      false,
		CanComment:   false,
		Metadata: map[string]any{
			"periodKey": periodKey, "revisionNo": revision, "markdownSha256": markdownHash,
		},
	}); err != nil {
		return nil, err
	}
	for _, uid := range recipients {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO document_shares (
			  document_id, owner_uid, shared_to_uid, permission, message
			) VALUES (?, ?, ?, 'read', ?)
			ON DUPLICATE KEY UPDATE
			  owner_uid = VALUES(owner_uid),
			  permission = 'read',
			  message = VALUES(message),
			  updated_at = NOW()
		`, documentID, operatorUID, uid, fmt.Sprintf("%s 公司项目周报汇总 R%d", periodKey, revision)); err != nil {
			return nil, err
		}
		if err := upsertDocumentRelationTx(ctx, tx, documentRelationInput{
			DocumentID:   documentID,
			DocumentUUID: documentUUID,
			RelatedUID:   uid,
			RelationType: "shared_to_me",
			SourceType:   "aims_company_weekly_summary",
			SourceID:     periodKey,
			CanRead:      true,
			CanEdit:      false,
			CanComment:   false,
			Metadata: map[string]any{
				"periodKey": periodKey, "revisionNo": revision, "documentVersionId": documentVersionID,
			},
		}); err != nil {
			return nil, err
		}
	}
	if documentURL == "" {
		documentURL = "/documents/" + documentUUID
	}
	return map[string]any{
		"documentUuid": documentUUID, "documentVersionId": documentVersionID,
		"documentVersionNum": revision, "markdownSha256": markdownHash,
		"documentUrl": documentURL, "recipientCount": len(recipients),
	}, nil
}

func companySummaryCommandStringSlice(value any) ([]string, error) {
	raw, ok := value.([]any)
	if !ok {
		typed, typedOK := value.([]string)
		if !typedOK {
			return nil, httperror.New(http.StatusBadRequest, "company_weekly_summary_recipients_invalid", "recipientUids must be an array")
		}
		raw = make([]any, 0, len(typed))
		for _, item := range typed {
			raw = append(raw, item)
		}
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		uid := strings.TrimSpace(fmt.Sprint(item))
		if uid == "" || len(uid) > 64 {
			return nil, httperror.New(http.StatusBadRequest, "company_weekly_summary_recipient_invalid", "recipient uid is invalid")
		}
		if !seen[uid] {
			seen[uid] = true
			result = append(result, uid)
		}
	}
	sort.Strings(result)
	return result, nil
}

func positiveCompanySummaryCommandInt(value any) (int, error) {
	parsed, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
	if err != nil || parsed <= 0 {
		return 0, httperror.New(http.StatusBadRequest, "company_weekly_summary_revision_invalid", "revisionNo must be a positive integer")
	}
	return parsed, nil
}

func isCompanySummaryPeriodKey(value string) bool {
	if len(value) != 8 || value[4:6] != "-W" {
		return false
	}
	year, yearErr := strconv.Atoi(value[:4])
	week, weekErr := strconv.Atoi(value[6:])
	return yearErr == nil && weekErr == nil && year >= 2000 && week >= 1 && week <= 53
}

func isCompanySummarySHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, char := range value {
		if !strings.ContainsRune("0123456789abcdef", char) {
			return false
		}
	}
	return true
}

func companySummarySHA256(value []byte) string {
	sum := sha256.Sum256(value)
	return fmt.Sprintf("%x", sum)
}

func rawCompanySummaryString(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}
