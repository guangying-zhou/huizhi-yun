package assets

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var deliveryArtifactStorageTypes = map[string]string{
	"solution":                    "delivery",
	"requirement":                 "requirement",
	"design":                      "design",
	"test_report":                 "delivery",
	"deployment_manual":           "ops",
	"acceptance_report":           "delivery",
	"training_material":           "delivery",
	"ops_knowledge":               "ops",
	"customer_environment_record": "ops",
}

func (a *Adapter) handleServiceDeliveryRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodPost && path == "/v1/assets/service/deliveries/upsert" {
		data, err := a.upsertServiceDelivery(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(data, "ok"), "assets.service.deliveries.upsert", err
	}
	if method == http.MethodGet && path == "/v1/assets/service/deliveries/package" {
		data, err := a.serviceDeliveryPackage(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.service.deliveries.package", err
	}
	if method == http.MethodGet {
		if projectCode, ok := pathParamWithSuffix(path, "/v1/assets/service/projects/", "/cost-summary"); ok {
			projectCode, _ = url.PathUnescape(projectCode)
			data, err := a.serviceProjectCostSummary(ctx, projectCode, query)
			return true, okWithMessage(data, "ok"), "assets.service.projects.cost_summary", err
		}
	}
	if method == http.MethodPost {
		if deliveryCode, ok := pathParamWithSuffix(path, "/v1/assets/service/deliveries/", "/documents"); ok {
			deliveryCode, _ = url.PathUnescape(deliveryCode)
			data, err := a.linkDeliveryDocument(ctx, deliveryCode, body, actorFromRequest(query, body))
			return true, okWithMessage(data, "交付文档已关联"), "assets.service.deliveries.documents.link", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) handleDeliveryDocumentRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodPost {
		if deliveryCode, ok := pathParamWithSuffix(path, "/v1/assets/deliveries/", "/documents"); ok {
			deliveryCode, _ = url.PathUnescape(deliveryCode)
			data, err := a.linkDeliveryDocument(ctx, deliveryCode, body, actorFromRequest(query, body))
			return true, okWithMessage(data, "交付文档已关联"), "assets.deliveries.documents.link", err
		}
	}
	return false, nil, "", nil
}

func (a *Adapter) upsertServiceDelivery(ctx context.Context, body map[string]any, operatorUID string) (map[string]any, error) {
	customerCode := firstText(bodyText(body, "customerCode"), bodyText(body, "customer_code"))
	projectCode := firstText(bodyText(body, "projectCode"), bodyText(body, "project_code"))
	contractCode := firstText(bodyText(body, "contractCode"), bodyText(body, "contract_code"))
	deliveryCode := firstText(bodyText(body, "deliveryCode"), bodyText(body, "delivery_code"))
	if deliveryCode == "" {
		deliveryCode = deliveryCodeFromContext(customerCode, contractCode, projectCode)
	}
	if deliveryCode == "" || customerCode == "" || projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_required_field", "deliveryCode or customerCode/projectCode is required")
	}

	result, err := a.withTx(ctx, func(tx *sql.Tx) (any, error) {
		var id int64
		if err := tx.QueryRowContext(ctx, `
			SELECT id
			FROM asset_delivery_views
			WHERE delivery_code = ?
			LIMIT 1
			FOR UPDATE`, deliveryCode).Scan(&id); err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		if id == 0 && contractCode != "" {
			if err := tx.QueryRowContext(ctx, `
				SELECT id
				FROM asset_delivery_views
				WHERE contract_code = ? AND project_code = ?
				ORDER BY id ASC
				LIMIT 1
				FOR UPDATE`, contractCode, projectCode).Scan(&id); err != nil && err != sql.ErrNoRows {
				return nil, err
			}
		}

		created := id == 0
		if created {
			insert, err := tx.ExecContext(ctx, `
				INSERT INTO asset_delivery_views (
				  delivery_code, delivery_name, customer_code, contract_code, project_code, status, owner_uid,
				  go_live_at, accepted_at, notes, created_by, updated_by
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				deliveryCode,
				firstText(bodyText(body, "deliveryName"), bodyText(body, "delivery_name"), bodyText(body, "contractName"), bodyText(body, "contract_name"), projectCode),
				customerCode,
				nullableString(contractCode),
				projectCode,
				firstText(bodyText(body, "status"), "preparing"),
				nullableString(firstText(bodyText(body, "ownerUid"), bodyText(body, "owner_uid"))),
				nullableString(firstText(bodyText(body, "goLiveAt"), bodyText(body, "go_live_at"))),
				nullableString(firstText(bodyText(body, "acceptedAt"), bodyText(body, "accepted_at"))),
				nullableString(firstText(bodyText(body, "notes"), bodyText(body, "remark"))),
				nullableString(operatorUID),
				nullableString(operatorUID),
			)
			if err != nil {
				return nil, err
			}
			var lastID int64
			lastID, err = insert.LastInsertId()
			if err != nil {
				return nil, err
			}
			id = lastID
		} else {
			if _, err := tx.ExecContext(ctx, `
				UPDATE asset_delivery_views
				SET delivery_name = COALESCE(?, delivery_name),
				    customer_code = COALESCE(?, customer_code),
				    contract_code = COALESCE(?, contract_code),
				    project_code = COALESCE(?, project_code),
				    status = COALESCE(?, status),
				    owner_uid = COALESCE(?, owner_uid),
				    go_live_at = COALESCE(?, go_live_at),
				    accepted_at = COALESCE(?, accepted_at),
				    notes = COALESCE(?, notes),
				    updated_by = ?
				WHERE id = ?`,
				nullableString(firstText(bodyText(body, "deliveryName"), bodyText(body, "delivery_name"), bodyText(body, "contractName"), bodyText(body, "contract_name"))),
				nullableString(customerCode),
				nullableString(contractCode),
				nullableString(projectCode),
				nullableString(bodyText(body, "status")),
				nullableString(firstText(bodyText(body, "ownerUid"), bodyText(body, "owner_uid"))),
				nullableString(firstText(bodyText(body, "goLiveAt"), bodyText(body, "go_live_at"))),
				nullableString(firstText(bodyText(body, "acceptedAt"), bodyText(body, "accepted_at"))),
				nullableString(firstText(bodyText(body, "notes"), bodyText(body, "remark"))),
				nullableString(operatorUID),
				id,
			); err != nil {
				return nil, err
			}
		}

		eventType := "upserted"
		if created {
			eventType = "created"
		}
		if err := insertEvent(ctx, tx, "delivery_view", id, eventType, operatorUID, map[string]any{
			"summary":       "客户交付视图已同步",
			"delivery_code": deliveryCode,
			"customer_code": customerCode,
			"contract_code": contractCode,
			"project_code":  projectCode,
			"source_app":    firstText(bodyText(body, "sourceApp"), bodyText(body, "source_app")),
		}); err != nil {
			return nil, err
		}
		return map[string]any{"id": id, "created": created}, nil
	})
	if err != nil {
		return nil, err
	}

	payload := result.(map[string]any)
	id := asInt(payload["id"])
	delivery, err := a.getDelivery(ctx, id)
	if err != nil {
		return nil, err
	}
	delivery["created"] = payload["created"]
	delivery["idempotent"] = !payload["created"].(bool)
	return delivery, nil
}

func (a *Adapter) linkDeliveryDocument(ctx context.Context, deliveryCode string, body map[string]any, operatorUID string) (map[string]any, error) {
	deliveryCode = strings.TrimSpace(deliveryCode)
	if deliveryCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_delivery_code", "deliveryCode is required")
	}
	delivery, err := a.queryRowMap(ctx, `
		SELECT id, customer_code, contract_code, project_code
		FROM asset_delivery_views
		WHERE delivery_code = ?
		LIMIT 1`, deliveryCode)
	if err != nil {
		return nil, err
	}
	if delivery == nil {
		return nil, notFound("交付视图不存在")
	}
	deliveryID := asInt(delivery["id"])
	documentID := firstText(bodyText(body, "documentUuid"), bodyText(body, "document_uuid"), bodyText(body, "codocsUuid"), bodyText(body, "codocs_uuid"), bodyText(body, "document_id"))
	if documentID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_document_uuid", "documentUuid is required")
	}
	artifactType := normalizeDeliveryArtifactType(firstText(bodyText(body, "artifactType"), bodyText(body, "artifact_type"), bodyText(body, "deliverableType"), bodyText(body, "deliverable_type")))
	documentType := firstText(bodyText(body, "documentType"), bodyText(body, "document_type"), deliveryArtifactStorageTypes[artifactType], "other")
	linkBody := map[string]any{
		"document_id":    documentID,
		"document_type":  normalizeAssetDocumentType(documentType),
		"artifact_type":  artifactType,
		"remark":         firstText(bodyText(body, "remark"), bodyText(body, "title"), bodyText(body, "documentTitle"), bodyText(body, "document_title")),
		"source_context": deliveryDocumentSourceContext(deliveryCode, delivery, body, documentID, artifactType),
	}
	if err := a.linkDocument(ctx, "delivery_view", deliveryID, linkBody, operatorUID); err != nil {
		return nil, err
	}
	if _, err := a.DB().ExecContext(ctx, `
		INSERT INTO asset_events (object_type, object_id, event_type, event_data, operator_uid)
		VALUES (?, ?, ?, ?, ?)`,
		"delivery_view",
		deliveryID,
		"document_linked",
		jsonOrNil(linkBody["source_context"]),
		nullableString(operatorUID),
	); err != nil {
		return nil, err
	}
	return map[string]any{
		"delivery_code": deliveryCode,
		"document_id":   documentID,
		"document_uuid": documentID,
		"artifact_type": artifactType,
		"document_type": linkBody["document_type"],
	}, nil
}

func (a *Adapter) serviceDeliveryPackage(ctx context.Context, query url.Values) (map[string]any, error) {
	rows, err := a.deliveryListRows(ctx, query, nil)
	if err != nil {
		return nil, err
	}
	items := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		id := asInt(row["id"])
		detail, err := a.getDelivery(ctx, id)
		if err != nil {
			return nil, err
		}
		items = append(items, detail)
	}
	return map[string]any{
		"total": len(items),
		"items": items,
		"filters": map[string]any{
			"customer_code": query.Get("customer_code"),
			"contract_code": query.Get("contract_code"),
			"project_code":  query.Get("project_code"),
		},
	}, nil
}

func (a *Adapter) serviceProjectCostSummary(ctx context.Context, projectCode string, query url.Values) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_project_code", "projectCode is required")
	}
	periodMonth := firstText(query.Get("period_month"), query.Get("periodMonth"))
	if len(periodMonth) > 7 {
		periodMonth = periodMonth[:7]
	}

	purchase, err := a.queryRowMap(ctx, `
		SELECT COALESCE(SUM(COALESCE(actual_amount, budget_amount, 0)), 0) AS amount
		FROM purchase_orders
		WHERE project_code = ?
		  AND status NOT IN ('rejected', 'closed')`, projectCode)
	if err != nil {
		return nil, err
	}
	subscription, err := a.queryRowMap(ctx, `
		SELECT COALESCE(SUM(ard.monthly_cost), 0) AS amount
		FROM asset_items ai
		INNER JOIN asset_resource_details ard ON ard.asset_id = ai.id
		WHERE ai.archived_at IS NULL
		  AND ai.project_code = ?`, projectCode)
	if err != nil {
		return nil, err
	}
	environment, err := a.queryRowMap(ctx, `
		SELECT COALESCE(SUM(ard.monthly_cost), 0) AS amount
		FROM asset_environments env
		LEFT JOIN asset_environment_assets ea ON ea.environment_id = env.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		WHERE env.project_code = ?`, projectCode)
	if err != nil {
		return nil, err
	}
	monthlyWhere := "project_code = ?"
	args := []any{projectCode}
	if periodMonth != "" {
		monthlyWhere += " AND DATE_FORMAT(cost_month, '%Y-%m') = ?"
		args = append(args, periodMonth)
	}
	monthly, err := a.queryRowMap(ctx, `
		SELECT COALESCE(SUM(amount), 0) AS amount
		FROM asset_monthly_costs
		WHERE `+monthlyWhere, args...)
	if err != nil {
		return nil, err
	}

	lines := []map[string]any{
		costLine(projectCode, "asset_purchase", "资产采购投入", purchase["amount"], "purchase_orders"),
		costLine(projectCode, "resource_subscription", "资源订阅月成本", subscription["amount"], "asset_resource_details"),
		costLine(projectCode, "environment_investment", "环境投入月成本", environment["amount"], "asset_environments"),
		costLine(projectCode, "monthly_allocation", "月度成本归集", monthly["amount"], "asset_monthly_costs"),
	}
	return map[string]any{
		"project_code": projectCode,
		"period_month": periodMonth,
		"currency":     "CNY",
		"line_items":   lines,
		"totals": map[string]any{
			"asset_purchase_amount":         purchase["amount"],
			"resource_subscription_amount":  subscription["amount"],
			"environment_investment_amount": environment["amount"],
			"monthly_allocation_amount":     monthly["amount"],
		},
	}, nil
}

func costLine(projectCode string, costType string, title string, amount any, sourceTable string) map[string]any {
	return map[string]any{
		"project_code":       projectCode,
		"cost_type":          costType,
		"title":              title,
		"amount":             amount,
		"currency":           "CNY",
		"allocation_type":    "asset",
		"allocation_basis":   "assets_runtime",
		"source_app":         "assets",
		"source_table":       sourceTable,
		"finance_subject":    "asset_cost",
		"finance_cost_scope": "project_accounting",
	}
}

func deliveryDocumentSourceContext(deliveryCode string, delivery map[string]any, body map[string]any, documentID string, artifactType string) map[string]any {
	context := map[string]any{}
	put := func(key string, value string) {
		if strings.TrimSpace(value) != "" {
			context[key] = strings.TrimSpace(value)
		}
	}

	put("source_app", firstText(bodyText(body, "sourceApp"), bodyText(body, "source_app"), "assets"))
	put("source_biz_type", firstText(bodyText(body, "sourceBizType"), bodyText(body, "source_biz_type"), "delivery_document"))
	put("source_biz_code", firstText(bodyText(body, "sourceBizCode"), bodyText(body, "source_biz_code"), documentID))
	put("delivery_code", deliveryCode)
	put("customer_code", firstText(bodyText(body, "customerCode"), bodyText(body, "customer_code"), cleanAnyString(delivery["customer_code"])))
	put("contract_code", firstText(bodyText(body, "contractCode"), bodyText(body, "contract_code"), cleanAnyString(delivery["contract_code"])))
	put("project_code", firstText(bodyText(body, "projectCode"), bodyText(body, "project_code"), cleanAnyString(delivery["project_code"])))
	put("milestone_id", firstText(bodyText(body, "milestoneId"), bodyText(body, "milestone_id"), bodyText(body, "aimsMilestoneId"), bodyText(body, "aims_milestone_id")))
	put("milestone_code", firstText(bodyText(body, "milestoneCode"), bodyText(body, "milestone_code"), bodyText(body, "aimsMilestoneCode"), bodyText(body, "aims_milestone_code")))
	put("milestone_name", firstText(bodyText(body, "milestoneName"), bodyText(body, "milestone_name"), bodyText(body, "aimsMilestoneName"), bodyText(body, "aims_milestone_name")))
	put("document_uuid", documentID)
	put("document_title", firstText(bodyText(body, "documentTitle"), bodyText(body, "document_title"), bodyText(body, "title")))
	put("artifact_type", artifactType)
	put("idempotency_key", firstText(bodyText(body, "idempotencyKey"), bodyText(body, "idempotency_key")))
	return context
}

func deliveryCodeFromContext(customerCode string, contractCode string, projectCode string) string {
	left := normalizeServiceCodeToken(firstText(contractCode, customerCode, "delivery"))
	right := normalizeServiceCodeToken(firstText(projectCode, "project"))
	code := fmt.Sprintf("DLV-%s-%s", left, right)
	if len(code) > 64 {
		return code[:64]
	}
	return code
}

func normalizeServiceCodeToken(value string) string {
	builder := strings.Builder{}
	for _, r := range strings.ToUpper(strings.TrimSpace(value)) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
		} else if r == '-' || r == '_' {
			builder.WriteRune('-')
		}
		if builder.Len() >= 24 {
			break
		}
	}
	if builder.Len() == 0 {
		return "NA"
	}
	normalized := strings.Trim(builder.String(), "-")
	if normalized == "" {
		return "NA"
	}
	return normalized
}

func normalizeDeliveryArtifactType(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "solution"
	}
	if _, ok := deliveryArtifactStorageTypes[value]; ok {
		return value
	}
	switch value {
	case "方案", "solution_doc":
		return "solution"
	case "需求", "requirements", "requirement_doc":
		return "requirement"
	case "设计", "design_doc":
		return "design"
	case "测试报告", "test", "test-report":
		return "test_report"
	case "部署手册", "deployment", "deployment-guide":
		return "deployment_manual"
	case "验收报告", "acceptance", "acceptance-report":
		return "acceptance_report"
	case "培训材料", "training", "training-material":
		return "training_material"
	case "运维知识", "ops", "ops-doc":
		return "ops_knowledge"
	case "客户环境记录", "environment", "environment-record":
		return "customer_environment_record"
	default:
		return "solution"
	}
}

func normalizeAssetDocumentType(value string) string {
	switch strings.TrimSpace(value) {
	case "requirement", "design", "api", "ops", "delivery", "attachment", "other":
		return strings.TrimSpace(value)
	default:
		if mapped, ok := deliveryArtifactStorageTypes[strings.TrimSpace(value)]; ok {
			return mapped
		}
		return "other"
	}
}
