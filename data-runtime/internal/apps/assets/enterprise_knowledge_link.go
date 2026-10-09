package assets

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
	in, cmd, e := knowledgecommand.Validate("assets", q, body)
	if e != nil {
		return nil, e
	}
	raw, ok := body["knowledgeAuthorization"].(string)
	if !ok {
		return nil, httperror.New(403, "knowledge_authorization_required", "缺少目标许可")
	}
	scopes, e := knowledgeScopes(raw, fmt.Sprint(cmd["actorUid"]), "edit")
	if e != nil {
		return nil, e
	}
	tx, e := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	// Current target scopes and authoritative customer/contract/project pair are
	// checked before receipt lookup, including replay. No source role is trusted.
	delivery, e := assetsTxQueryOneMap(ctx, tx, `SELECT id,customer_code,contract_code,project_code FROM asset_delivery_views WHERE BINARY delivery_code=BINARY ? LIMIT 1 FOR UPDATE`, cmd["deliveryCode"])
	if e != nil {
		return nil, e
	}
	if delivery == nil || delivery["customer_code"] != cmd["customerCode"] || delivery["contract_code"] != cmd["contractCode"] || delivery["project_code"] != cmd["projectCode"] {
		return nil, httperror.New(403, "knowledge_delivery_mismatch", "交付上下文不匹配")
	}
	v, e := readCustomerKnowledge(ctx, tx, fmt.Sprint(cmd["customerCode"]), fmt.Sprint(cmd["deliveryAssetCode"]), fmt.Sprint(cmd["environmentCode"]), scopes[0], scopes[1], true)
	if e != nil {
		return nil, e
	}
	target := v["items"].([]map[string]any)[0]
	if target["contractCode"] != cmd["contractCode"] || target["projectCode"] != cmd["projectCode"] {
		return nil, httperror.New(403, "knowledge_context_mismatch", "交付上下文不匹配")
	}
	in.OriginalActorUID = fmt.Sprint(cmd["actorUid"])
	repo, e := integrationoperation.NewReceiptRepository(a.DB())
	if e != nil {
		return nil, e
	}
	result, e := repo.ExecuteInTransaction(ctx, tx, in, func(ctx context.Context, tx *sql.Tx, _ json.RawMessage) (integrationoperation.ReceiptBusinessResult, error) {
		payload := map[string]any{}
		for k, v := range cmd {
			payload[k] = v
		}
		payload["sourceApp"] = "enterprise"
		payload["artifactType"] = "ops_knowledge"
		payload["sourceBizType"] = "service_ticket"
		payload["sourceBizCode"] = cmd["ticketCode"]
		v, e := a.linkDeliveryDocumentTx(ctx, tx, fmt.Sprint(cmd["deliveryCode"]), payload, fmt.Sprint(cmd["actorUid"]))
		if e != nil {
			return integrationoperation.ReceiptBusinessResult{}, e
		}
		return integrationoperation.ReceiptBusinessResult{TargetBizType: "delivery_document", TargetBizCode: fmt.Sprint(cmd["documentUuid"]), HTTPStatus: 200, Value: v}, nil
	})
	if e != nil {
		return nil, assetsServiceCommandReceiptError(e)
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return knowledgecommand.Receipt(in, result), nil
}
