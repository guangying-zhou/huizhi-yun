package codocs

import (
	"context"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type opsKnowledgeSource struct {
	SourceType string
	SourceID   string
}

func (a *Adapter) linkOpsKnowledge(ctx context.Context, body map[string]any) (map[string]any, error) {
	documentUUID := firstNonEmpty(
		stringValue(body["documentUuid"]),
		stringValue(body["document_uuid"]),
		stringValue(body["uuid"]),
	)
	if documentUUID == "" {
		return nil, httperror.New(http.StatusBadRequest, "document_uuid_required", "documentUuid is required")
	}

	doc, err := a.documentByUUID(ctx, documentUUID, false)
	if err != nil {
		return nil, err
	}

	sourceApp := firstNonEmpty(stringValue(body["sourceApp"]), stringValue(body["source_app"]), "altoc")
	actorUID := firstNonEmpty(
		stringValue(body["actorUid"]),
		stringValue(body["actor_uid"]),
		stringValue(body["operatorUid"]),
		stringValue(body["operator_uid"]),
		stringValue(body["current_user"]),
		stringValue(doc["owner_uid"]),
		"system",
	)
	metadata := map[string]any{
		"sourceApp":               sourceApp,
		"documentUuid":            documentUUID,
		"title":                   doc["title"],
		"customerCode":            firstNonEmpty(stringValue(body["customerCode"]), stringValue(body["customer_code"])),
		"contractCode":            firstNonEmpty(stringValue(body["contractCode"]), stringValue(body["contract_code"])),
		"maintenanceContractCode": firstNonEmpty(stringValue(body["maintenanceContractCode"]), stringValue(body["maintenance_contract_code"])),
		"projectCode":             firstNonEmpty(stringValue(body["projectCode"]), stringValue(body["project_code"])),
		"deliveryCode":            firstNonEmpty(stringValue(body["deliveryCode"]), stringValue(body["delivery_code"])),
		"ticketCode":              firstNonEmpty(stringValue(body["ticketCode"]), stringValue(body["ticket_code"])),
		"artifactType":            firstNonEmpty(stringValue(body["artifactType"]), stringValue(body["artifact_type"]), "ops_knowledge"),
	}

	sources := opsKnowledgeSources(metadata)
	linked := make([]map[string]any, 0, len(sources))
	for _, source := range sources {
		if err := a.upsertDocumentRelation(ctx, documentRelationInput{
			DocumentID:   int64Value(doc["id"]),
			DocumentUUID: documentUUID,
			RelatedUID:   actorUID,
			RelationType: "ops_knowledge",
			SourceType:   source.SourceType,
			SourceID:     source.SourceID,
			CanRead:      true,
			CanEdit:      false,
			CanComment:   true,
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
		"relatedUid":   actorUID,
		"linked":       linked,
		"linkedCount":  len(linked),
	}, nil
}

func opsKnowledgeSources(metadata map[string]any) []opsKnowledgeSource {
	candidates := []opsKnowledgeSource{
		{SourceType: "altoc_service_ticket", SourceID: stringValue(metadata["ticketCode"])},
		{SourceType: "assets_delivery", SourceID: stringValue(metadata["deliveryCode"])},
		{SourceType: "altoc_maintenance_contract", SourceID: stringValue(metadata["maintenanceContractCode"])},
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
	if len(sources) == 0 {
		sources = append(sources, opsKnowledgeSource{SourceType: "ops_knowledge", SourceID: stringValue(metadata["documentUuid"])})
	}
	return sources
}
