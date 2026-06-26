package assets

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func (a *Adapter) handleProcurementRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if handled, result, operation, err := a.handleSupplierRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handlePurchaseOrderRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleReceiptRoutes(ctx, method, path); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleAssignmentRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	if handled, result, operation, err := a.handleAlertRoutes(ctx, method, path, query, body); handled {
		return true, result, operation, err
	}
	return false, nil, "", nil
}

func (a *Adapter) handleSupplierRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/suppliers" {
		data, err := a.listSuppliers(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.suppliers.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/suppliers" {
		id, err := a.createSupplier(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "供应商已创建"), "assets.suppliers.create", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/suppliers/"); ok && method == http.MethodPatch {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.updateSupplier(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "供应商已更新"), "assets.suppliers.update", err
	}
	return false, nil, "", nil
}

func (a *Adapter) listSuppliers(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  id,
		  supplier_code,
		  supplier_name,
		  credit_code,
		  supplier_type,
		  contact_name,
		  contact_phone,
		  contact_email,
		  invoice_info,
		  status,
		  notes
		FROM suppliers
		WHERE (? IS NULL OR status = ?)
		  AND (
		    ? IS NULL
		    OR supplier_code LIKE ?
		    OR supplier_name LIKE ?
		    OR supplier_type LIKE ?
		    OR contact_name LIKE ?
		    OR contact_phone LIKE ?
		    OR contact_email LIKE ?
		  )
		ORDER BY id DESC`,
		status, status, search, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	cloud := int64(0)
	for _, item := range items {
		if cleanAnyString(item["supplier_type"]) == "cloud" {
			cloud++
		}
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("供应商总数", len(items), "基础台账", "primary"),
			metric("云服务商", cloud, "资源资产主力供应商", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) handlePurchaseOrderRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/purchase-orders" {
		data, err := a.listPurchaseOrders(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.purchase_orders.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/purchase-orders" {
		id, err := a.createPurchaseOrder(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "采购单已创建"), "assets.purchase_orders.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/purchase-orders/", "/items"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		itemID, err := a.createPurchaseOrderItem(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": itemID}, "采购明细已新增"), "assets.purchase_orders.items.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/purchase-orders/", "/submit"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.submitPurchaseOrder(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "采购单已提交审批"), "assets.purchase_orders.submit", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/purchase-orders/", "/workflow:sync"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		data, err := a.syncPurchaseOrderWorkflow(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(data, "采购单审批状态已同步"), "assets.purchase_orders.workflow.sync", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/purchase-orders/", "/receipts"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		receiptID, err := a.createReceipt(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id, "receipt_id": receiptID}, "入库/激活记录已创建"), "assets.purchase_orders.receipts.create", err
	}
	if method == http.MethodPatch && isPurchaseOrderItemPath(path) {
		orderID, itemID, err := purchaseOrderItemPathIDs(path)
		if err != nil {
			return true, nil, "", err
		}
		err = a.updatePurchaseOrderItem(ctx, orderID, itemID, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": itemID}, "采购明细已更新"), "assets.purchase_orders.items.update", err
	}
	if rawID, ok := singlePathParam(path, "/v1/assets/purchase-orders/"); ok {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		if method == http.MethodGet {
			data, err := a.getPurchaseOrder(ctx, id)
			return true, okWithMessage(data, "ok"), "assets.purchase_orders.get", err
		}
		if method == http.MethodPatch {
			err := a.updatePurchaseOrder(ctx, id, body, actorFromRequest(query, body))
			return true, okWithMessage(map[string]any{"id": id}, "采购单已更新"), "assets.purchase_orders.update", err
		}
	}
	return false, nil, "", nil
}

func isPurchaseOrderItemPath(path string) bool {
	_, _, err := purchaseOrderItemPathIDs(path)
	return err == nil
}

func purchaseOrderItemPathIDs(path string) (int64, int64, error) {
	prefix := "/v1/assets/purchase-orders/"
	if !strings.HasPrefix(path, prefix) {
		return 0, 0, notFound("Route not found")
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[1] != "items" {
		return 0, 0, notFound("Route not found")
	}
	orderID, err := parsePositiveID(parts[0])
	if err != nil {
		return 0, 0, err
	}
	itemID, err := parsePositiveID(parts[2])
	if err != nil {
		return 0, 0, err
	}
	return orderID, itemID, nil
}

func (a *Adapter) listPurchaseOrders(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  po.id,
		  po.order_no,
		  po.purchase_type,
		  po.purpose_type,
		  po.project_code,
		  po.customer_code,
		  po.contract_code,
		  po.environment_id,
		  po.supplier_id,
		  supplier.supplier_name,
		  po.status,
		  po.budget_amount,
		  po.actual_amount,
		  po.applicant_uid,
		  po.applicant_dept_code,
		  po.reason,
		  DATE_FORMAT(po.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM purchase_orders po
		LEFT JOIN suppliers supplier ON supplier.id = po.supplier_id
		WHERE (? IS NULL OR po.status = ?)
		  AND (
		    ? IS NULL
		    OR po.order_no LIKE ?
		    OR po.purchase_type LIKE ?
		    OR po.project_code LIKE ?
		    OR po.customer_code LIKE ?
		    OR po.contract_code LIKE ?
		    OR supplier.supplier_name LIKE ?
		    OR po.applicant_uid LIKE ?
		    OR po.applicant_dept_code LIKE ?
		  )
		ORDER BY po.id DESC`,
		status, status, search, search, search, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	pendingStock := int64(0)
	for _, item := range items {
		status := cleanAnyString(item["status"])
		if status == "approved" || status == "received" {
			pendingStock++
		}
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("采购单总数", len(items), "当前数据库记录", "primary"),
			metric("待入库/激活", pendingStock, "仍需处理", "warning"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) getPurchaseOrder(ctx context.Context, id int64) (map[string]any, error) {
	order, err := a.queryRowMap(ctx, `
		SELECT
		  po.id,
		  po.order_no,
		  po.purchase_type,
		  po.purpose_type,
		  po.project_code,
		  po.customer_code,
		  po.contract_code,
		  po.environment_id,
		  po.supplier_id,
		  supplier.supplier_name,
		  po.status,
		  po.budget_amount,
		  po.actual_amount,
		  po.applicant_uid,
		  po.applicant_dept_code,
		  po.reason,
		  DATE_FORMAT(po.created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM purchase_orders po
		LEFT JOIN suppliers supplier ON supplier.id = po.supplier_id
		WHERE po.id = ?`, id)
	if err != nil {
		return nil, err
	}
	if order == nil {
		return nil, notFound("采购单不存在")
	}
	items, err := a.queryMaps(ctx, `
		SELECT
		  id,
		  line_no,
		  item_name,
		  asset_category,
		  asset_subtype,
		  specification,
		  quantity,
		  unit,
		  unit_price,
		  total_price,
		  DATE_FORMAT(effective_at, '%Y-%m-%d') AS effective_at,
		  DATE_FORMAT(expires_at, '%Y-%m-%d') AS expires_at,
		  target_type,
		  target_ref,
		  remark
		FROM purchase_order_items
		WHERE purchase_order_id = ?
		ORDER BY line_no ASC`, id)
	if err != nil {
		return nil, err
	}
	order["items"] = items
	return order, nil
}

func (a *Adapter) handleReceiptRoutes(ctx context.Context, method string, path string) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/receipts" {
		data, err := a.listReceipts(ctx)
		return true, okWithMessage(data, "ok"), "assets.receipts.list", err
	}
	return false, nil, "", nil
}

func (a *Adapter) listReceipts(ctx context.Context) (map[string]any, error) {
	items, err := a.queryMaps(ctx, `
		SELECT
		  receipt.id,
		  receipt.receipt_no,
		  po.order_no,
		  receipt.receipt_type,
		  receipt.status,
		  receipt.operator_uid,
		  DATE_FORMAT(receipt.processed_at, '%Y-%m-%d %H:%i:%s') AS processed_at
		FROM asset_receipts receipt
		INNER JOIN purchase_orders po ON po.id = receipt.purchase_order_id
		ORDER BY receipt.id DESC`)
	if err != nil {
		return nil, err
	}
	draft := int64(0)
	for _, item := range items {
		if cleanAnyString(item["status"]) == "draft" {
			draft++
		}
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("入库/激活记录", len(items), "数据库记录", "primary"),
			metric("待处理", draft, "待激活或登记", "warning"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) handleAssignmentRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/assignments" {
		data, err := a.listAssignments(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.assignments.list", err
	}
	if method == http.MethodPost && path == "/v1/assets/assignments" {
		id, err := a.createAssignment(ctx, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "操作记录已创建"), "assets.assignments.create", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/assignments/", "/workflow:sync"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		data, err := a.syncAssignmentWorkflow(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(data, "资产操作审批状态已同步"), "assets.assignments.workflow.sync", err
	}
	return false, nil, "", nil
}

func (a *Adapter) listAssignments(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  assignment.id,
		  assignment.assignment_no,
		  asset.asset_code,
		  asset.asset_name,
		  assignment.action_type,
		  assignment.target_type,
		  assignment.target_ref,
		  assignment.status,
		  assignment.workflow_instance_id,
		  DATE_FORMAT(assignment.effective_at, '%Y-%m-%d %H:%i:%s') AS effective_at
		FROM asset_assignments assignment
		INNER JOIN asset_items asset ON asset.id = assignment.asset_id
		WHERE (? IS NULL OR assignment.status = ?)
		  AND (
		    ? IS NULL
		    OR assignment.assignment_no LIKE ?
		    OR asset.asset_code LIKE ?
		    OR asset.asset_name LIKE ?
		    OR assignment.action_type LIKE ?
		    OR assignment.target_ref LIKE ?
		  )
		ORDER BY assignment.id DESC`,
		status, status, search, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	active := int64(0)
	for _, item := range items {
		if cleanAnyString(item["status"]) == "active" {
			active++
		}
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("操作记录", len(items), "分配/归还/释放", "primary"),
			metric("进行中", active, "审批通过后生效", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) handleAlertRoutes(ctx context.Context, method string, path string, query url.Values, body map[string]any) (bool, any, string, error) {
	if method == http.MethodGet && path == "/v1/assets/alerts" {
		data, err := a.listAlerts(ctx, query)
		return true, okWithMessage(data, "ok"), "assets.alerts.list", err
	}
	if rawID, ok := pathParamWithSuffix(path, "/v1/assets/alerts/", "/actions"); ok && method == http.MethodPost {
		id, err := parsePositiveID(rawID)
		if err != nil {
			return true, nil, "", err
		}
		err = a.handleAlert(ctx, id, body, actorFromRequest(query, body))
		return true, okWithMessage(map[string]any{"id": id}, "预警已处理"), "assets.alerts.actions", err
	}
	return false, nil, "", nil
}

func (a *Adapter) listAlerts(ctx context.Context, query url.Values) (map[string]any, error) {
	status := statusFilter(query)
	search := likeSearch(query)
	items, err := a.queryMaps(ctx, `
		SELECT
		  id,
		  alert_no,
		  alert_type,
		  CASE severity
		    WHEN 'critical' THEN 'error'
		    WHEN 'high' THEN 'warning'
		    WHEN 'medium' THEN 'info'
		    ELSE 'neutral'
		  END AS severity,
		  title,
		  status,
		  project_code,
		  DATE_FORMAT(due_at, '%Y-%m-%d') AS due_at,
		  DATE_FORMAT(triggered_at, '%Y-%m-%d %H:%i:%s') AS triggered_at
		FROM asset_alerts
		WHERE (? IS NULL OR status = ?)
		  AND (
		    ? IS NULL
		    OR alert_no LIKE ?
		    OR title LIKE ?
		    OR alert_type LIKE ?
		    OR project_code LIKE ?
		  )
		ORDER BY triggered_at DESC`,
		status, status, search, search, search, search, search,
	)
	if err != nil {
		return nil, err
	}
	pending := int64(0)
	acknowledged := int64(0)
	for _, item := range items {
		switch cleanAnyString(item["status"]) {
		case "pending":
			pending++
		case "acknowledged":
			acknowledged++
		}
	}
	return map[string]any{
		"summary": []summaryMetric{
			metric("预警总数", len(items), "数据库记录", "primary"),
			metric("待处理", pending, "需要闭环", "warning"),
			metric("已确认", acknowledged, "已有人跟进", "info"),
		},
		"total": len(items),
		"items": items,
	}, nil
}

func (a *Adapter) reports(ctx context.Context) (map[string]any, error) {
	assetCategoryRows, err := a.queryMaps(ctx, `
		SELECT asset_category AS category, COUNT(*) AS total
		FROM asset_items
		WHERE archived_at IS NULL
		GROUP BY asset_category`)
	if err != nil {
		return nil, err
	}
	projectCostRows, err := a.queryMaps(ctx, `
		SELECT ai.project_code, COALESCE(SUM(ard.monthly_cost), 0) AS amount
		FROM asset_items ai
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ai.id
		WHERE ai.archived_at IS NULL
		GROUP BY ai.project_code
		ORDER BY amount DESC`)
	if err != nil {
		return nil, err
	}
	deliveryCostRows, err := a.queryMaps(ctx, `
		SELECT dv.delivery_name, COALESCE(SUM(ard.monthly_cost), 0) AS amount
		FROM asset_delivery_views dv
		LEFT JOIN asset_delivery_environments de ON de.delivery_view_id = dv.id
		LEFT JOIN asset_environment_assets ea ON ea.environment_id = de.environment_id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		GROUP BY dv.id
		ORDER BY amount DESC`)
	if err != nil {
		return nil, err
	}
	environmentRows, err := a.queryMaps(ctx, `
		SELECT env.environment_name, COUNT(ea.asset_id) AS asset_count, COALESCE(SUM(ard.monthly_cost), 0) AS monthly_cost
		FROM asset_environments env
		LEFT JOIN asset_environment_assets ea ON ea.environment_id = env.id
		LEFT JOIN asset_resource_details ard ON ard.asset_id = ea.asset_id
		GROUP BY env.id
		ORDER BY env.id DESC`)
	if err != nil {
		return nil, err
	}
	activeAssets, err := a.queryRowMap(ctx, `SELECT COUNT(*) AS total FROM asset_items WHERE status IN ('active', 'in_use') AND archived_at IS NULL`)
	if err != nil {
		return nil, err
	}
	expiring, err := a.listAssets(ctx, url.Values{"category": []string{"resource"}})
	if err != nil {
		return nil, err
	}

	totalAssets := int64(0)
	for _, row := range assetCategoryRows {
		totalAssets += asInt(row["total"])
	}
	activeRate := "0%"
	if totalAssets > 0 {
		activeRate = strconv.FormatInt((asInt(activeAssets["total"])*100)/totalAssets, 10) + "%"
	}

	assetRows := make([]map[string]any, 0, len(assetCategoryRows))
	for _, row := range assetCategoryRows {
		assetRows = append(assetRows, map[string]any{"label": row["category"], "value": cleanAnyString(row["total"]), "hint": "按资产分类汇总"})
	}
	projectRows := make([]map[string]any, 0, len(projectCostRows))
	projectCount := 0
	highestProject := "-"
	for _, row := range projectCostRows {
		projectCode := cleanAnyString(row["project_code"])
		if projectCode == "" {
			continue
		}
		if highestProject == "-" {
			highestProject = projectCode
		}
		projectCount++
		projectRows = append(projectRows, map[string]any{"label": projectCode, "value": formatMoney(row["amount"]) + " / 月", "hint": "资源资产月均成本"})
	}
	deliveryRows := make([]map[string]any, 0, len(deliveryCostRows))
	for _, row := range deliveryCostRows {
		deliveryRows = append(deliveryRows, map[string]any{"label": row["delivery_name"], "value": formatMoney(row["amount"]) + " / 月", "hint": "交付视图聚合成本"})
	}
	environmentReportRows := make([]map[string]any, 0, len(environmentRows))
	costEnvironmentCount := 0
	for _, row := range environmentRows {
		if asFloat(row["monthly_cost"]) > 0 {
			costEnvironmentCount++
		}
		environmentReportRows = append(environmentReportRows, map[string]any{"label": row["environment_name"], "value": formatMoney(row["monthly_cost"]) + " / 月", "hint": cleanAnyString(row["asset_count"]) + " 个资产"})
	}

	highestDeliveryCost := "¥0.00"
	if len(deliveryCostRows) > 0 {
		highestDeliveryCost = formatMoney(deliveryCostRows[0]["amount"])
	}

	return map[string]any{
		"assets_summary": map[string]any{
			"summary": []summaryMetric{
				metric("资产总数", strconv.FormatInt(totalAssets, 10), "含实物与资源", "primary"),
				metric("在用率", activeRate, "按状态估算", "success"),
			},
			"rows": assetRows,
		},
		"expiring": expiring,
		"project_costs": map[string]any{
			"summary": []summaryMetric{
				metric("项目数", strconv.Itoa(projectCount), "有成本记录的项目", "primary"),
				metric("最高成本项目", highestProject, "按资源月均成本", "warning"),
			},
			"rows": projectRows,
		},
		"delivery_costs": map[string]any{
			"summary": []summaryMetric{
				metric("交付项目", strconv.Itoa(len(deliveryCostRows)), "交付视图数量", "primary"),
				metric("最高交付成本", highestDeliveryCost, "按交付聚合", "info"),
			},
			"rows": deliveryRows,
		},
		"environment_resources": map[string]any{
			"summary": []summaryMetric{
				metric("环境总数", strconv.Itoa(len(environmentRows)), "数据库记录", "primary"),
				metric("月成本环境", strconv.Itoa(costEnvironmentCount), "含资源成本的环境", "info"),
			},
			"rows": environmentReportRows,
		},
	}, nil
}
