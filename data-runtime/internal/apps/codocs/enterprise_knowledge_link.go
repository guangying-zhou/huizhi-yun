package codocs

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"github.com/huizhi-yun/data-runtime/internal/knowledgecommand"
	"net/url"
)

func (a *Adapter) enterpriseKnowledgeLink(ctx context.Context, q url.Values, body map[string]any) (map[string]any, error) {
	in, cmd, e := knowledgecommand.Validate("codocs", q, body)
	if e != nil {
		return nil, e
	}
	tx, e := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	// Lock/recheck ordinary Codocs owner/share/relation ACL before receipt replay.
	doc, e := a.documentAccessWithReader(ctx, tx, stringValue(cmd["documentUuid"]), url.Values{"current_user": {stringValue(cmd["actorUid"])}}, true)
	if e != nil {
		return nil, e
	}
	if int64Value(doc["status"]) != 1 {
		return nil, httperror.New(403, "knowledge_document_inactive", "文档不可关联")
	}
	in.OriginalActorUID = fmt.Sprint(cmd["actorUid"])
	repo, e := integrationoperation.NewReceiptRepository(a.db)
	if e != nil {
		return nil, e
	}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		metadata := map[string]any{}
		for k, v := range cmd {
			metadata[k] = v
		}
		metadata["sourceApp"] = "enterprise"
		metadata["artifactType"] = "ops_knowledge"
		for _, src := range opsKnowledgeSources(metadata) {
			if e = upsertOpsKnowledgeRelationTx(ctx, tx, documentRelationInput{DocumentID: int64Value(doc["id"]), DocumentUUID: stringValue(doc["uuid"]), RelatedUID: "service:enterprise:ops-knowledge", RelationType: "ops_knowledge", SourceType: src.SourceType, SourceID: src.SourceID, CanRead: false, CanEdit: false, CanComment: false, Metadata: metadata}); e != nil {
				return integrationoperation.ReceiptBusinessResult{}, e
			}
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "document", TargetBizCode: stringValue(doc["uuid"]), HTTPStatus: 200, Value: map[string]any{"uuid": doc["uuid"]}}, nil
	})
	if e != nil {
		return nil, codocsServiceCommandReceiptError(e)
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return knowledgecommand.Receipt(in, result), nil
}
