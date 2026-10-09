package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type opsKnowledgeSource struct {
	SourceType string
	SourceID   string
}

const opsKnowledgeContextPrincipal = "service:altoc:ops-knowledge"

func (a *Adapter) linkOpsKnowledge(ctx context.Context, body map[string]any) (map[string]any, error) {
	receiptInput, command, err := integrationoperation.ReceiptCommandFromBody(
		body,
		"codocs",
		"altoc.ops-knowledge.codocs-link.v1",
		"codocs:documents:write",
	)
	if err != nil {
		return nil, codocsServiceCommandReceiptError(err)
	}
	if receiptInput.TrustedContext.SourceApp != "altoc" {
		return nil, httperror.New(http.StatusForbidden, "service_command_source_forbidden", "service command source must be altoc")
	}
	integrationoperation.CopyTrustedRuntimeCommandContext(command, body)
	command["sourceApp"] = "altoc"
	command["artifactType"] = "ops_knowledge"
	repository, err := integrationoperation.NewReceiptRepository(a.db)
	if err != nil {
		return nil, err
	}
	executed, err := repository.Execute(ctx, receiptInput, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		result, err := a.linkOpsKnowledgeTx(ctx, tx, command)
		if err != nil {
			return integrationoperation.ReceiptBusinessResult{}, err
		}
		documentUUID := firstNonEmpty(stringValue(command["documentUuid"]), stringValue(command["document_uuid"]))
		return integrationoperation.ReceiptBusinessResult{
			TargetBizType: "document",
			TargetBizCode: documentUUID,
			HTTPStatus:    http.StatusOK,
			Value:         result,
		}, nil
	})
	if err != nil {
		return nil, codocsServiceCommandReceiptError(err)
	}
	return map[string]any{
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
	}, nil
}

func (a *Adapter) linkOpsKnowledgeTx(ctx context.Context, tx *sql.Tx, body map[string]any) (map[string]any, error) {
	documentUUID := firstNonEmpty(
		stringValue(body["documentUuid"]),
		stringValue(body["document_uuid"]),
		stringValue(body["uuid"]),
	)
	if documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "document_uuid_required", "documentUuid is required")
	}
	if sourceApp := firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"])); sourceApp != "altoc" {
		return nil, httperror.New(http.StatusForbidden, "ops_knowledge_source_forbidden", "sourceApp must be altoc")
	}
	if artifactType := firstNonEmpty(stringValue(body["artifactType"]), stringValue(body["artifact_type"])); artifactType != "ops_knowledge" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_ops_knowledge_artifact_type", "artifactType must be ops_knowledge")
	}

	rows, err := tx.QueryContext(ctx, `
		SELECT id, uuid, title, doc_type
		FROM documents
		WHERE uuid = ? AND status <> 0
		LIMIT 1
		FOR UPDATE`, documentUUID)
	if err != nil {
		return nil, err
	}
	docs, err := rowsToMaps(rows)
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	if len(docs) == 0 {
		return nil, httperror.New(http.StatusNotFound, "document_not_found", "Document not found")
	}
	doc := docs[0]

	sourceApp := "altoc"
	metadata := map[string]any{
		"sourceApp":               sourceApp,
		"documentUuid":            documentUUID,
		"title":                   doc["title"],
		"customerCode":            firstNonEmpty(stringValue(body["customerCode"]), stringValue(body["customer_code"])),
		"contractCode":            firstNonEmpty(stringValue(body["contractCode"]), stringValue(body["contract_code"])),
		"maintenanceContractCode": firstNonEmpty(stringValue(body["maintenanceContractCode"]), stringValue(body["maintenance_contract_code"])),
		"projectCode":             firstNonEmpty(stringValue(body["projectCode"]), stringValue(body["project_code"])),
		"deliveryCode":            firstNonEmpty(stringValue(body["deliveryCode"]), stringValue(body["delivery_code"])),
		"deliveryAssetCode":       firstNonEmpty(stringValue(body["deliveryAssetCode"]), stringValue(body["delivery_asset_code"])),
		"environmentCode":         firstNonEmpty(stringValue(body["environmentCode"]), stringValue(body["environment_code"])),
		"ticketCode":              firstNonEmpty(stringValue(body["ticketCode"]), stringValue(body["ticket_code"])),
		"artifactType":            "ops_knowledge",
	}
	for key, label := range map[string]string{
		"customerCode":      "customerCode",
		"contractCode":      "contractCode",
		"projectCode":       "projectCode",
		"deliveryAssetCode": "deliveryAssetCode",
		"environmentCode":   "environmentCode",
		"ticketCode":        "ticketCode",
	} {
		if strings.TrimSpace(stringValue(metadata[key])) == "" {
			return nil, httperror.New(http.StatusBadRequest, "ops_knowledge_context_incomplete", label+" is required")
		}
	}

	sources := opsKnowledgeSources(metadata)
	linked := make([]map[string]any, 0, len(sources))
	for _, source := range sources {
		if err := upsertOpsKnowledgeRelationTx(ctx, tx, documentRelationInput{
			DocumentID:   int64Value(doc["id"]),
			DocumentUUID: documentUUID,
			// document_relations is also consulted by the document ACL path. Ops
			// context indexes must therefore use a stable non-user principal and
			// must never grant read/comment access to the initiating operator.
			RelatedUID:   opsKnowledgeContextPrincipal,
			RelationType: "ops_knowledge",
			SourceType:   source.SourceType,
			SourceID:     source.SourceID,
			CanRead:      false,
			CanEdit:      false,
			CanComment:   false,
			Metadata:     metadata,
		}); err != nil {
			return nil, err
		}
		linked = append(linked, map[string]any{
			"sourceType": source.SourceType,
			"sourceId":   source.SourceID,
		})
	}
	return map[string]any{
		"documentUuid": documentUUID,
		"title":        doc["title"],
		"docType":      doc["doc_type"],
		"relationType": "ops_knowledge",
		"linked":       linked,
		"linkedCount":  len(linked),
	}, nil
}

func codocsServiceCommandReceiptError(err error) error {
	switch {
	case errors.Is(err, integrationoperation.ErrIdempotencyPayloadMismatch):
		return httperror.New(http.StatusConflict, "idempotency_payload_mismatch", "service command identity or payload does not match the existing receipt")
	case errors.Is(err, integrationoperation.ErrReceiptInProgress):
		return httperror.New(http.StatusConflict, "service_command_in_progress", "service command receipt is still processing")
	case errors.Is(err, integrationoperation.ErrReceiptRejected):
		return httperror.New(http.StatusConflict, "service_command_rejected", "service command receipt was rejected")
	default:
		return err
	}
}

func opsKnowledgeSources(metadata map[string]any) []opsKnowledgeSource {
	candidates := []opsKnowledgeSource{
		{SourceType: "altoc_service_ticket", SourceID: stringValue(metadata["ticketCode"])},
		{SourceType: "assets_delivery_asset", SourceID: stringValue(metadata["deliveryAssetCode"])},
		{SourceType: "assets_environment", SourceID: stringValue(metadata["environmentCode"])},
		{SourceType: "altoc_contract", SourceID: stringValue(metadata["contractCode"])},
		{SourceType: "aims_project", SourceID: stringValue(metadata["projectCode"])},
		{SourceType: "altoc_customer", SourceID: stringValue(metadata["customerCode"])},
	}
	sources := make([]opsKnowledgeSource, 0, len(candidates))
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate.SourceID == "" {
			continue
		}
		key := candidate.SourceType + ":" + candidate.SourceID
		if seen[key] {
			continue
		}
		seen[key] = true
		sources = append(sources, candidate)
	}
	return sources
}

func upsertOpsKnowledgeRelationTx(ctx context.Context, tx *sql.Tx, input documentRelationInput) error {
	metadata, err := json.Marshal(input.Metadata)
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO document_relations
		  (document_id, document_uuid, related_uid, relation_type, source_type, source_id,
		   can_read, can_edit, can_comment, status, metadata)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
		ON DUPLICATE KEY UPDATE
		  document_uuid = VALUES(document_uuid),
		  can_read = VALUES(can_read),
		  can_edit = VALUES(can_edit),
		  can_comment = VALUES(can_comment),
		  status = 1,
		  metadata = VALUES(metadata),
		  updated_at = NOW()
	`, input.DocumentID, input.DocumentUUID, input.RelatedUID, input.RelationType, input.SourceType,
		nullableString(input.SourceID), boolInt(input.CanRead), boolInt(input.CanEdit), boolInt(input.CanComment), string(metadata))
	return err
}
