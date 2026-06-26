package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type PrepareInstanceRequest struct {
	AppCode          string         `json:"app_code"`
	ResourceCode     string         `json:"resource_code"`
	ActionCode       string         `json:"action_code"`
	BizID            any            `json:"biz_id"`
	BizTitle         string         `json:"biz_title"`
	BizContext       map[string]any `json:"biz_context"`
	FormData         map[string]any `json:"form_data"`
	CurrentUser      string         `json:"current_user"`
	InitiatorContext map[string]any `json:"initiator_context"`
}

type CreateInstanceRequest struct {
	ActionDefID      int64          `json:"action_def_id"`
	RouteID          int64          `json:"route_id"`
	BizID            any            `json:"biz_id"`
	BizTitle         string         `json:"biz_title"`
	BizURL           string         `json:"biz_url"`
	BizContext       map[string]any `json:"biz_context"`
	FormData         map[string]any `json:"form_data"`
	Attachments      any            `json:"attachments"`
	CallbackURL      string         `json:"callback_url"`
	CurrentUser      string         `json:"current_user"`
	InitiatorContext map[string]any `json:"initiator_context"`
}

type InstanceAPIResponse struct {
	Code    int              `json:"code"`
	Data    any              `json:"data"`
	Effects *WorkflowEffects `json:"effects,omitempty"`
}

type WorkflowEffects struct {
	Notifications []WorkflowNotification `json:"notifications,omitempty"`
	Callbacks     []WorkflowCallback     `json:"callbacks,omitempty"`
}

type WorkflowNotification struct {
	ToUser      []string `json:"touser"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	URL         string   `json:"url"`
}

type WorkflowCallback struct {
	URL     string         `json:"url"`
	Payload map[string]any `json:"payload"`
}

type actionDefRecord struct {
	ID           int64
	AppCode      string
	ResourceCode string
	ActionCode   string
	Name         string
	FormSchemaID sql.NullInt64
}

type routeRecord struct {
	ID           int64
	ActionDefID  int64
	FlowSchemaID int64
	Name         string
	Description  sql.NullString
	Level        sql.NullInt64
	Conditions   sql.NullString
	Priority     int
	IsDefault    int
}

type flowSchemaRecord struct {
	ID      int64
	Code    string
	Name    string
	Nodes   string
	Config  sql.NullString
	Version int
}

type existingInstanceRecord struct {
	ID           int64
	InstanceNo   string
	Status       string
	InitiatorUID string
}

type resolvedAssignee struct {
	UID  string `json:"uid"`
	Name string `json:"name"`
}

func (a *Adapter) PrepareInstance(ctx context.Context, rawBody map[string]any) (InstanceAPIResponse, error) {
	var request PrepareInstanceRequest
	if err := decodeMap(rawBody, &request); err != nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid workflow prepare body")
	}

	if request.CurrentUser == "" {
		return InstanceAPIResponse{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if request.AppCode == "" || request.ResourceCode == "" || request.ActionCode == "" {
		return InstanceAPIResponse{}, httperror.New(http.StatusBadRequest, "field_required", "app_code, resource_code and action_code are required")
	}

	actionDef, err := a.actionDefByKey(ctx, request.AppCode, request.ResourceCode, request.ActionCode)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	if actionDef == nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusNotFound, "action_def_not_found", "未找到对应的动作定义")
	}

	fullContext := prepareFlowContext(request.CurrentUser, request.InitiatorContext, request.BizContext, request.BizID, request.BizTitle, "", request.FormData)
	routes, err := a.matchRoutes(ctx, actionDef.ID, fullContext)
	if err != nil {
		return InstanceAPIResponse{}, err
	}

	matchedRoutes := make([]map[string]any, 0, len(routes))
	for _, route := range routes {
		flowSchema, err := a.flowSchemaByID(ctx, route.FlowSchemaID)
		if err != nil {
			return InstanceAPIResponse{}, err
		}
		if flowSchema == nil {
			continue
		}
		nodes, err := parseJSONArray(flowSchema.Nodes)
		if err != nil {
			return InstanceAPIResponse{}, err
		}
		matchedRoutes = append(matchedRoutes, map[string]any{
			"id":    route.ID,
			"name":  route.Name,
			"level": nullInt64Value(route.Level),
			"flow_schema": map[string]any{
				"id":            flowSchema.ID,
				"code":          flowSchema.Code,
				"name":          flowSchema.Name,
				"nodes_preview": nodeNames(nodes),
			},
		})
	}

	formSchema, prefilledData, err := a.prepareFormSchema(ctx, actionDef.FormSchemaID, request.BizContext, request.BizTitle)
	if err != nil {
		return InstanceAPIResponse{}, err
	}

	return InstanceAPIResponse{
		Code: 0,
		Data: map[string]any{
			"action_def": map[string]any{
				"id":            actionDef.ID,
				"name":          actionDef.Name,
				"resource_code": actionDef.ResourceCode,
				"action_code":   actionDef.ActionCode,
			},
			"context": map[string]any{
				"dept_code":       fullContext["dept_code"],
				"dept_name":       fullContext["dept_name"],
				"dept_org_type":   fullContext["dept_org_type"],
				"initiator_uid":   request.CurrentUser,
				"initiator_name":  fullContext["initiator_name"],
				"initiator_roles": fullContext["initiator_roles"],
			},
			"matched_routes": matchedRoutes,
			"form_schema":    formSchema,
			"prefilled_data": prefilledData,
		},
	}, nil
}

func (a *Adapter) CreateInstance(ctx context.Context, rawBody map[string]any) (InstanceAPIResponse, error) {
	var request CreateInstanceRequest
	if err := decodeMap(rawBody, &request); err != nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid workflow create body")
	}

	bizID := cleanAnyString(request.BizID)
	if request.CurrentUser == "" {
		return InstanceAPIResponse{}, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if request.ActionDefID == 0 || request.RouteID == 0 || bizID == "" || request.BizTitle == "" {
		return InstanceAPIResponse{}, httperror.New(http.StatusBadRequest, "field_required", "action_def_id, route_id, biz_id and biz_title are required")
	}

	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	actionDef, err := actionDefByID(ctx, tx, request.ActionDefID)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	if actionDef == nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusNotFound, "action_def_not_found", "动作定义不存在")
	}

	existingActive, err := activeInstanceByBiz(ctx, tx, actionDef, bizID)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	if existingActive != nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "active_instance_exists", fmt.Sprintf("该业务已有进行中的审批流程（%s）", existingActive.InstanceNo))
	}

	existingRejected, err := reusableInstanceByBiz(ctx, tx, actionDef, bizID)
	if err != nil {
		return InstanceAPIResponse{}, err
	}

	route, err := routeByID(ctx, tx, request.RouteID, request.ActionDefID)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	if route == nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusNotFound, "route_not_found", "路由规则不存在或不属于该动作定义")
	}

	flowSchema, err := flowSchemaByID(ctx, tx, route.FlowSchemaID)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	if flowSchema == nil {
		return InstanceAPIResponse{}, httperror.New(http.StatusNotFound, "flow_schema_not_found", "流程定义不存在")
	}

	nodes, err := parseJSONArray(flowSchema.Nodes)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	config, err := parseJSONObject(flowSchema.Config.String)
	if err != nil {
		return InstanceAPIResponse{}, err
	}

	instanceNo := ""
	submitMode := "created"
	if existingRejected != nil {
		instanceNo = existingRejected.InstanceNo
	}
	if instanceNo == "" {
		instanceNo, err = generateInstanceNo(ctx, tx)
		if err != nil {
			return InstanceAPIResponse{}, err
		}
	}

	fullContext := prepareFlowContext(request.CurrentUser, request.InitiatorContext, request.BizContext, request.BizID, request.BizTitle, instanceNo, request.FormData)
	snapshotNodes, err := resolveSnapshotNodes(nodes, fullContext)
	if err != nil {
		return InstanceAPIResponse{}, err
	}
	flowSnapshot := map[string]any{"nodes": snapshotNodes, "config": config}

	firstNodeIndex := firstRunnableNode(snapshotNodes, fullContext)
	instanceID := int64(0)

	if existingRejected != nil {
		if existingRejected.InitiatorUID != request.CurrentUser {
			return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "resubmit_forbidden", fmt.Sprintf("该业务已有历史实例（%s），仅原发起人可重新提交", existingRejected.InstanceNo))
		}
		if value, ok := config["allow_resubmit"].(bool); ok && !value {
			return InstanceAPIResponse{}, httperror.New(http.StatusConflict, "resubmit_disabled", fmt.Sprintf("该业务已有历史实例（%s），且当前流程不允许重新提交", existingRejected.InstanceNo))
		}

		if _, err := tx.ExecContext(ctx, `
			UPDATE flow_instances
			SET action_def_id = ?,
			    route_id = ?,
			    flow_schema_id = ?,
			    biz_title = ?,
			    biz_url = ?,
			    biz_context = ?,
			    form_data = ?,
			    attachments = ?,
			    status = 'running',
			    current_node = ?,
			    flow_snapshot = ?,
			    callback_url = ?,
			    completed_at = NULL,
			    updated_at = NOW()
			WHERE id = ?
		`,
			request.ActionDefID,
			request.RouteID,
			route.FlowSchemaID,
			request.BizTitle,
			nilIfEmpty(request.BizURL),
			mustJSON(fullContext),
			mustJSON(defaultMap(request.FormData)),
			mustJSON(defaultSlice(request.Attachments)),
			firstNodeIndex,
			mustJSON(flowSnapshot),
			nilIfEmpty(request.CallbackURL),
			existingRejected.ID,
		); err != nil {
			return InstanceAPIResponse{}, err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'cancelled', updated_at = NOW() WHERE instance_id = ? AND status = 'pending'", existingRejected.ID); err != nil {
			return InstanceAPIResponse{}, err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
			VALUES (?, NULL, ?, 'resubmit', NULL, NOW())
		`, existingRejected.ID, request.CurrentUser); err != nil {
			return InstanceAPIResponse{}, err
		}
		instanceID = existingRejected.ID
		submitMode = "resubmitted"
	} else {
		result, err := tx.ExecContext(ctx, `
			INSERT INTO flow_instances
			  (instance_no, action_def_id, route_id, flow_schema_id, app_code, resource_code, action_code,
			   biz_id, biz_title, biz_url, biz_context, form_data, attachments,
			   initiator_uid, status, current_node, flow_snapshot, callback_url, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, NOW(), NOW())
		`,
			instanceNo,
			request.ActionDefID,
			request.RouteID,
			route.FlowSchemaID,
			actionDef.AppCode,
			actionDef.ResourceCode,
			actionDef.ActionCode,
			bizID,
			request.BizTitle,
			nilIfEmpty(request.BizURL),
			mustJSON(fullContext),
			mustJSON(defaultMap(request.FormData)),
			mustJSON(defaultSlice(request.Attachments)),
			request.CurrentUser,
			firstNodeIndex,
			mustJSON(flowSnapshot),
			nilIfEmpty(request.CallbackURL),
		)
		if err != nil {
			return InstanceAPIResponse{}, err
		}
		instanceID, err = result.LastInsertId()
		if err != nil {
			return InstanceAPIResponse{}, err
		}
	}

	effects := &WorkflowEffects{}
	status := "running"
	currentNode := firstNodeIndex
	if firstNodeIndex < len(snapshotNodes) {
		notifications, finalStatus, finalNode, err := createInitialTasks(ctx, tx, instanceID, firstNodeIndex, snapshotNodes, fullContext, request.CurrentUser, request.BizTitle, request.BizURL)
		if err != nil {
			return InstanceAPIResponse{}, err
		}
		effects.Notifications = append(effects.Notifications, notifications...)
		status = finalStatus
		currentNode = finalNode
	}

	if err := tx.Commit(); err != nil {
		return InstanceAPIResponse{}, err
	}

	return InstanceAPIResponse{
		Code: 0,
		Data: map[string]any{
			"instance_id":   instanceID,
			"instance_no":   instanceNo,
			"status":        status,
			"current_node":  currentNode,
			"mode":          submitMode,
			"flow_snapshot": flowSnapshot,
		},
		Effects: effects,
	}, nil
}

func decodeMap(raw map[string]any, target any) error {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return err
	}
	return json.Unmarshal(encoded, target)
}

func (a *Adapter) actionDefByKey(ctx context.Context, appCode string, resourceCode string, actionCode string) (*actionDefRecord, error) {
	return scanActionDef(a.db.QueryRowContext(ctx, `
		SELECT id, app_code, resource_code, action_code, name, form_schema_id
		FROM flow_action_defs
		WHERE app_code = ? AND resource_code = ? AND action_code = ? AND status = 1
	`, appCode, resourceCode, actionCode))
}

func actionDefByID(ctx context.Context, q queryRowContext, id int64) (*actionDefRecord, error) {
	return scanActionDef(q.QueryRowContext(ctx, `
		SELECT id, app_code, resource_code, action_code, name, form_schema_id
		FROM flow_action_defs
		WHERE id = ? AND status = 1
	`, id))
}

func scanActionDef(row *sql.Row) (*actionDefRecord, error) {
	var record actionDefRecord
	err := row.Scan(&record.ID, &record.AppCode, &record.ResourceCode, &record.ActionCode, &record.Name, &record.FormSchemaID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (a *Adapter) flowSchemaByID(ctx context.Context, id int64) (*flowSchemaRecord, error) {
	return flowSchemaByID(ctx, a.db, id)
}

func flowSchemaByID(ctx context.Context, q queryRowContext, id int64) (*flowSchemaRecord, error) {
	var record flowSchemaRecord
	err := q.QueryRowContext(ctx, "SELECT id, code, name, nodes, config, version FROM flow_schemas WHERE id = ? AND status = 1", id).
		Scan(&record.ID, &record.Code, &record.Name, &record.Nodes, &record.Config, &record.Version)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func routeByID(ctx context.Context, q queryRowContext, routeID int64, actionDefID int64) (*routeRecord, error) {
	var route routeRecord
	err := q.QueryRowContext(ctx, `
		SELECT id, action_def_id, flow_schema_id, name, description, level, conditions, priority, is_default
		FROM flow_routes
		WHERE id = ? AND action_def_id = ? AND status = 1
	`, routeID, actionDefID).Scan(
		&route.ID,
		&route.ActionDefID,
		&route.FlowSchemaID,
		&route.Name,
		&route.Description,
		&route.Level,
		&route.Conditions,
		&route.Priority,
		&route.IsDefault,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &route, nil
}

func activeInstanceByBiz(ctx context.Context, q queryRowContext, actionDef *actionDefRecord, bizID string) (*existingInstanceRecord, error) {
	var record existingInstanceRecord
	err := q.QueryRowContext(ctx, `
		SELECT id, instance_no, status, initiator_uid
		FROM flow_instances
		WHERE app_code = ? AND resource_code = ? AND biz_id = ? AND action_code = ?
		  AND status IN ('running', 'suspended')
		LIMIT 1
	`, actionDef.AppCode, actionDef.ResourceCode, bizID, actionDef.ActionCode).Scan(&record.ID, &record.InstanceNo, &record.Status, &record.InitiatorUID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func reusableInstanceByBiz(ctx context.Context, q queryRowContext, actionDef *actionDefRecord, bizID string) (*existingInstanceRecord, error) {
	var record existingInstanceRecord
	err := q.QueryRowContext(ctx, `
		SELECT id, instance_no, status, initiator_uid
		FROM flow_instances
		WHERE app_code = ? AND resource_code = ? AND biz_id = ? AND action_code = ?
		  AND status IN ('rejected', 'cancelled')
		ORDER BY id DESC
		LIMIT 1
	`, actionDef.AppCode, actionDef.ResourceCode, bizID, actionDef.ActionCode).Scan(&record.ID, &record.InstanceNo, &record.Status, &record.InitiatorUID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &record, nil
}

func (a *Adapter) matchRoutes(ctx context.Context, actionDefID int64, flowContext map[string]any) ([]routeRecord, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, action_def_id, flow_schema_id, name, description, level, conditions, priority, is_default
		FROM flow_routes
		WHERE action_def_id = ? AND status = 1
		ORDER BY priority DESC
	`, actionDefID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	routes := make([]routeRecord, 0)
	for rows.Next() {
		var route routeRecord
		if err := rows.Scan(&route.ID, &route.ActionDefID, &route.FlowSchemaID, &route.Name, &route.Description, &route.Level, &route.Conditions, &route.Priority, &route.IsDefault); err != nil {
			return nil, err
		}
		routes = append(routes, route)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if reviewLevel, ok := numberValue(flowContext["review_level"]); ok {
		level := int64(reviewLevel)
		matches := make([]routeRecord, 0)
		for _, route := range routes {
			if route.Level.Valid && route.Level.Int64 == level {
				matches = append(matches, route)
			}
		}
		if len(matches) > 0 {
			return matches, nil
		}
	}

	var defaultRoute *routeRecord
	matches := make([]routeRecord, 0)
	for _, route := range routes {
		route := route
		if route.IsDefault != 0 {
			defaultRoute = &route
			continue
		}
		if route.Level.Valid {
			continue
		}
		conditions, err := parseJSONObject(route.Conditions.String)
		if err != nil {
			return nil, err
		}
		if len(conditions) == 0 {
			continue
		}
		if evaluateConditions(conditions, flowContext) {
			matches = append(matches, route)
		}
	}

	if len(matches) > 0 {
		maxPriority := matches[0].Priority
		result := make([]routeRecord, 0)
		for _, route := range matches {
			if route.Priority == maxPriority {
				result = append(result, route)
			}
		}
		return result, nil
	}
	if defaultRoute != nil {
		return []routeRecord{*defaultRoute}, nil
	}
	return nil, httperror.New(http.StatusBadRequest, "route_not_matched", "无匹配的审批流程，请联系管理员配置路由规则")
}

func (a *Adapter) prepareFormSchema(ctx context.Context, formSchemaID sql.NullInt64, bizContext map[string]any, bizTitle string) (any, map[string]any, error) {
	prefilledData := map[string]any{}
	if !formSchemaID.Valid {
		return nil, prefilledData, nil
	}

	var id int64
	var code, name, fieldsRaw string
	err := a.db.QueryRowContext(ctx, "SELECT id, code, name, fields FROM form_schemas WHERE id = ? AND status = 1", formSchemaID.Int64).
		Scan(&id, &code, &name, &fieldsRaw)
	if err == sql.ErrNoRows {
		return nil, prefilledData, nil
	}
	if err != nil {
		return nil, nil, err
	}

	fields, err := parseJSONArray(fieldsRaw)
	if err != nil {
		return nil, nil, err
	}
	for _, field := range fields {
		if stringFromMap(field, "source") == "biz" {
			key := stringFromMap(field, "key")
			if key != "" {
				if value, ok := bizContext[key]; ok {
					prefilledData[key] = value
				}
			}
		}
	}
	if bizTitle != "" {
		prefilledData["title"] = bizTitle
	}

	return map[string]any{
		"id":     id,
		"code":   code,
		"name":   name,
		"fields": fields,
	}, prefilledData, nil
}

func prepareFlowContext(currentUser string, initiatorContext map[string]any, bizContext map[string]any, bizID any, bizTitle string, instanceNo string, formData map[string]any) map[string]any {
	fullContext := map[string]any{}
	for key, value := range initiatorContext {
		fullContext[key] = value
	}
	for key, value := range bizContext {
		fullContext[key] = value
	}
	fullContext["biz_id"] = bizID
	if bizTitle != "" {
		fullContext["biz_title"] = bizTitle
	}
	if instanceNo != "" {
		fullContext["instance_no"] = instanceNo
	}
	fullContext["initiator_uid"] = currentUser
	if deptCode := cleanAnyString(initiatorContext["dept_code"]); deptCode != "" {
		fullContext["initiator_dept_code"] = deptCode
	}
	if resourceDeptCode := cleanAnyString(bizContext["resource_dept_code"]); resourceDeptCode != "" {
		fullContext["resource_dept_code"] = resourceDeptCode
	}
	fullContext["form_data"] = defaultMap(formData)
	return fullContext
}

func resolveSnapshotNodes(nodes []map[string]any, flowContext map[string]any) ([]map[string]any, error) {
	snapshotNodes := make([]map[string]any, 0, len(nodes))
	for _, node := range nodes {
		snapshot := copyMap(node)
		if evaluateSkipWhen(asStringMap(node["skip_when"]), flowContext) {
			snapshot["resolved_assignees"] = []resolvedAssignee{}
			snapshotNodes = append(snapshotNodes, snapshot)
			continue
		}

		assignees, err := resolveAssigneesFromContext(asMapSlice(node["assignees"]), flowContext)
		if err != nil {
			return nil, err
		}
		nodeType := cleanAnyString(node["type"])
		if (nodeType == "approve" || nodeType == "countersign") && len(assignees) == 0 {
			return nil, httperror.New(http.StatusBadRequest, "assignee_not_resolved", fmt.Sprintf("节点\"%s\"未解析到审批人", cleanAnyString(node["name"])))
		}
		snapshot["resolved_assignees"] = assignees
		snapshotNodes = append(snapshotNodes, snapshot)
	}
	return snapshotNodes, nil
}

func resolveAssigneesFromContext(assignees []map[string]any, flowContext map[string]any) ([]resolvedAssignee, error) {
	result := make([]resolvedAssignee, 0)
	seen := map[string]bool{}

	addUID := func(uid string) {
		uid = strings.TrimSpace(uid)
		if uid == "" || seen[uid] {
			return
		}
		seen[uid] = true
		result = append(result, resolvedAssignee{UID: uid, Name: userDisplayName(uid, flowContext)})
	}

	for _, assignee := range assignees {
		switch cleanAnyString(assignee["type"]) {
		case "user":
			addUID(firstNonEmptyString(cleanAnyString(assignee["uid"]), cleanAnyString(contextValue(flowContext, cleanAnyString(assignee["uid_from_context"])))))
		case "initiator":
			addUID(cleanAnyString(flowContext["initiator_uid"]))
		case "initiator_leader":
			addUID(firstNonEmptyString(cleanAnyString(flowContext["initiator_dept_manager_uid"]), cleanAnyString(flowContext["dept_manager_uid"])))
		case "dept_manager":
			addUID(deptActorUID(assignee, flowContext, "manager"))
		case "dept_leader":
			addUID(deptActorUID(assignee, flowContext, "leader"))
		case "form_field":
			for _, uid := range stringList(contextValue(flowContext, cleanAnyString(assignee["field_key"]))) {
				addUID(uid)
			}
		case "role":
			for _, uid := range lookupMappedUsers(flowContext, "role_users", cleanAnyString(assignee["code"])) {
				addUID(uid)
			}
		case "dept_members":
			deptCode := resolveDeptCode(assignee, flowContext)
			if deptCode == "" {
				return nil, httperror.New(http.StatusBadRequest, "dept_not_resolved", "节点审批人配置错误：dept_members 未解析到部门编码")
			}
			for _, uid := range lookupMappedUsers(flowContext, "dept_members", deptCode) {
				if truthy(assignee["exclude_initiator"]) && uid == cleanAnyString(flowContext["initiator_uid"]) {
					continue
				}
				addUID(uid)
			}
		}
	}
	return result, nil
}

func deptActorUID(assignee map[string]any, flowContext map[string]any, actor string) string {
	scope := cleanAnyString(assignee["scope"])
	if scope == "" {
		scope = "initiator_dept"
	}
	if scope == "initiator_dept" {
		if actor == "manager" {
			return firstNonEmptyString(cleanAnyString(flowContext["initiator_dept_manager_uid"]), cleanAnyString(flowContext["dept_manager_uid"]))
		}
		return firstNonEmptyString(cleanAnyString(flowContext["initiator_dept_leader_uid"]), cleanAnyString(flowContext["dept_leader_uid"]), cleanAnyString(flowContext["initiator_dept_parent_manager_uid"]))
	}
	if scope == "resource_dept" {
		if actor == "manager" {
			return cleanAnyString(flowContext["resource_dept_manager_uid"])
		}
		return firstNonEmptyString(cleanAnyString(flowContext["resource_dept_leader_uid"]), cleanAnyString(flowContext["resource_dept_parent_manager_uid"]))
	}

	deptCode := resolveDeptCode(assignee, flowContext)
	if deptCode == "" {
		return ""
	}
	keys := []string{"dept_" + actor + "s", "department_" + actor + "s"}
	for _, key := range keys {
		if value := lookupMappedString(flowContext, key, deptCode); value != "" {
			return value
		}
	}
	return ""
}

func resolveDeptCode(assignee map[string]any, flowContext map[string]any) string {
	switch cleanAnyString(assignee["scope"]) {
	case "initiator_dept", "":
		return cleanAnyString(flowContext["initiator_dept_code"])
	case "resource_dept":
		return cleanAnyString(flowContext["resource_dept_code"])
	case "specified":
		return cleanAnyString(assignee["dept_code"])
	case "form_field":
		return cleanAnyString(contextValue(flowContext, cleanAnyString(assignee["field_key"])))
	default:
		return cleanAnyString(flowContext["initiator_dept_code"])
	}
}

func firstRunnableNode(nodes []map[string]any, flowContext map[string]any) int {
	index := 0
	for index < len(nodes) {
		if !evaluateSkipWhen(asStringMap(nodes[index]["skip_when"]), flowContext) {
			break
		}
		index++
	}
	return index
}

func createInitialTasks(ctx context.Context, tx *sql.Tx, instanceID int64, firstNodeIndex int, nodes []map[string]any, flowContext map[string]any, initiatorUID string, bizTitle string, bizURL string) ([]WorkflowNotification, string, int, error) {
	notifications := make([]WorkflowNotification, 0)
	currentIndex := firstNodeIndex
	status := "running"

	for currentIndex < len(nodes) {
		node := nodes[currentIndex]
		if err := createTasksForNode(ctx, tx, instanceID, currentIndex, node); err != nil {
			return nil, "", 0, err
		}

		if !isExplicitInitiatorApprovalNode(node, initiatorUID) {
			uids := resolvedUIDs(node)
			if len(uids) > 0 {
				notifications = append(notifications, WorkflowNotification{
					ToUser:      uids,
					Title:       "您有新的审批待办",
					Description: fmt.Sprintf("%s提交了「%s」，请审批", firstNonEmptyString(cleanAnyString(flowContext["initiator_name"]), initiatorUID), bizTitle),
					URL:         bizURL,
				})
			}
			return notifications, status, currentIndex, nil
		}

		taskIDs, err := pendingTaskIDs(ctx, tx, instanceID, currentIndex)
		if err != nil {
			return nil, "", 0, err
		}
		for _, taskID := range taskIDs {
			if _, err := tx.ExecContext(ctx, "UPDATE flow_tasks SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = ?", taskID); err != nil {
				return nil, "", 0, err
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO flow_actions (instance_id, task_id, actor_uid, action, comment, created_at)
				VALUES (?, ?, ?, 'approve', ?, NOW())
			`, instanceID, taskID, initiatorUID, "系统自动通过（发起人自审批）"); err != nil {
				return nil, "", 0, err
			}
		}

		nextIndex := currentIndex + 1
		for nextIndex < len(nodes) && evaluateSkipWhen(asStringMap(nodes[nextIndex]["skip_when"]), flowContext) {
			nextIndex++
		}
		if nextIndex >= len(nodes) {
			if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET status = 'approved', current_node = ?, completed_at = NOW(), updated_at = NOW() WHERE id = ?", currentIndex, instanceID); err != nil {
				return nil, "", 0, err
			}
			return notifications, "approved", currentIndex, nil
		}
		if _, err := tx.ExecContext(ctx, "UPDATE flow_instances SET current_node = ?, updated_at = NOW() WHERE id = ?", nextIndex, instanceID); err != nil {
			return nil, "", 0, err
		}
		currentIndex = nextIndex
	}

	return notifications, status, currentIndex, nil
}

func createTasksForNode(ctx context.Context, tx *sql.Tx, instanceID int64, nodeIndex int, node map[string]any) error {
	for _, assignee := range resolvedAssignees(node) {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO flow_tasks (instance_id, node_index, node_name, assignee_uid, task_type, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())
		`, instanceID, nodeIndex, cleanAnyString(node["name"]), assignee.UID, cleanAnyString(node["type"])); err != nil {
			return err
		}
	}
	return nil
}

func pendingTaskIDs(ctx context.Context, tx *sql.Tx, instanceID int64, nodeIndex int) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, "SELECT id FROM flow_tasks WHERE instance_id = ? AND node_index = ? AND status = 'pending'", instanceID, nodeIndex)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func generateInstanceNo(ctx context.Context, q queryRowContext) (string, error) {
	now := time.Now()
	prefix := fmt.Sprintf("WF%04d%02d%02d", now.Year(), now.Month(), now.Day())

	var last sql.NullString
	err := q.QueryRowContext(ctx, "SELECT instance_no FROM flow_instances WHERE instance_no LIKE ? ORDER BY id DESC LIMIT 1", prefix+"%").Scan(&last)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}

	seq := 1
	if last.Valid && strings.HasPrefix(last.String, prefix) {
		if value, err := strconv.Atoi(last.String[len(prefix):]); err == nil {
			seq = value + 1
		}
	}
	return fmt.Sprintf("%s%04d", prefix, seq), nil
}

func evaluateConditions(conditions map[string]any, flowContext map[string]any) bool {
	for key, condition := range conditions {
		if !evaluateCondition(contextValue(flowContext, key), condition) {
			return false
		}
	}
	return true
}

func evaluateCondition(contextValue any, conditionValue any) bool {
	switch condition := conditionValue.(type) {
	case string:
		return valueContains(contextValue, condition)
	case float64:
		return valueContains(contextValue, condition)
	case int:
		return valueContains(contextValue, condition)
	case map[string]any:
		if values, ok := condition["in"].([]any); ok {
			return anyIntersect(contextValue, values)
		}
		if values, ok := condition["not_in"].([]any); ok {
			return !anyIntersect(contextValue, values)
		}
		if gte, ok := numberValue(condition["gte"]); ok {
			value, valueOK := numberValue(contextValue)
			return valueOK && value >= gte
		}
		if lte, ok := numberValue(condition["lte"]); ok {
			value, valueOK := numberValue(contextValue)
			return valueOK && value <= lte
		}
		if existsRaw, ok := condition["exists"]; ok {
			exists := contextValue != nil && cleanAnyString(contextValue) != ""
			return truthy(existsRaw) == exists
		}
	}
	return false
}

func evaluateSkipWhen(skipWhen map[string]any, flowContext map[string]any) bool {
	if len(skipWhen) == 0 {
		return false
	}
	for key, condition := range skipWhen {
		value := contextValue(flowContext, key)
		switch condition := condition.(type) {
		case string, float64, int:
			if !valueContains(value, condition) {
				return false
			}
		case map[string]any:
			if values, ok := condition["in"].([]any); ok {
				if !anyIntersect(value, values) {
					return false
				}
			}
		}
	}
	return true
}

func contextValue(flowContext map[string]any, path string) any {
	if path == "" {
		return nil
	}
	parts := strings.Split(path, ".")
	var current any = flowContext
	for _, part := range parts {
		record, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = record[part]
	}
	return current
}

func parseJSONObject(raw string) (map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}, nil
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return nil, err
	}
	if result == nil {
		result = map[string]any{}
	}
	return result, nil
}

func parseJSONArray(raw string) ([]map[string]any, error) {
	if strings.TrimSpace(raw) == "" {
		return []map[string]any{}, nil
	}
	var items []map[string]any
	if err := json.Unmarshal([]byte(raw), &items); err != nil {
		return nil, err
	}
	if items == nil {
		items = []map[string]any{}
	}
	return items, nil
}

func nodeNames(nodes []map[string]any) []string {
	names := make([]string, 0, len(nodes))
	for _, node := range nodes {
		names = append(names, cleanAnyString(node["name"]))
	}
	return names
}

func isExplicitInitiatorApprovalNode(node map[string]any, initiatorUID string) bool {
	if cleanAnyString(node["type"]) != "approve" {
		return false
	}
	assignees := asMapSlice(node["assignees"])
	if len(assignees) != 1 || cleanAnyString(assignees[0]["type"]) != "initiator" {
		return false
	}
	resolved := resolvedAssignees(node)
	return len(resolved) == 1 && resolved[0].UID == initiatorUID
}

func resolvedAssignees(node map[string]any) []resolvedAssignee {
	rawItems, ok := node["resolved_assignees"].([]resolvedAssignee)
	if ok {
		return rawItems
	}
	items := asMapSlice(node["resolved_assignees"])
	result := make([]resolvedAssignee, 0, len(items))
	for _, item := range items {
		uid := cleanAnyString(item["uid"])
		if uid == "" {
			continue
		}
		result = append(result, resolvedAssignee{UID: uid, Name: firstNonEmptyString(cleanAnyString(item["name"]), uid)})
	}
	return result
}

func resolvedUIDs(node map[string]any) []string {
	assignees := resolvedAssignees(node)
	result := make([]string, 0, len(assignees))
	for _, assignee := range assignees {
		result = append(result, assignee.UID)
	}
	return result
}

func userDisplayName(uid string, flowContext map[string]any) string {
	if uid == cleanAnyString(flowContext["initiator_uid"]) {
		return firstNonEmptyString(cleanAnyString(flowContext["initiator_name"]), uid)
	}
	if names, ok := flowContext["user_names"].(map[string]any); ok {
		if name := cleanAnyString(names[uid]); name != "" {
			return name
		}
	}
	return uid
}

func lookupMappedUsers(flowContext map[string]any, key string, code string) []string {
	if code == "" {
		return nil
	}
	value, ok := flowContext[key].(map[string]any)
	if !ok {
		return nil
	}
	return stringList(value[code])
}

func lookupMappedString(flowContext map[string]any, key string, code string) string {
	values := lookupMappedUsers(flowContext, key, code)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func stringFromMap(record map[string]any, key string) string {
	return cleanAnyString(record[key])
}

func asStringMap(value any) map[string]any {
	if value == nil {
		return nil
	}
	if record, ok := value.(map[string]any); ok {
		return record
	}
	return nil
}

func asMapSlice(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]map[string]any, 0, len(rawItems))
	for _, item := range rawItems {
		if record, ok := item.(map[string]any); ok {
			result = append(result, record)
		}
	}
	return result
}

func copyMap(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func defaultMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func defaultSlice(value any) any {
	if value == nil {
		return []any{}
	}
	return value
}

func mustJSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(encoded)
}

func cleanAnyString(value any) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func numberValue(value any) (float64, bool) {
	switch value := value.(type) {
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0, false
		}
		return value, true
	case json.Number:
		number, err := value.Float64()
		return number, err == nil
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return number, err == nil
	default:
		return 0, false
	}
}

func valueContains(value any, expected any) bool {
	if items, ok := value.([]any); ok {
		for _, item := range items {
			if scalarEqual(item, expected) {
				return true
			}
		}
		return false
	}
	return scalarEqual(value, expected)
}

func anyIntersect(value any, expected []any) bool {
	if items, ok := value.([]any); ok {
		for _, item := range items {
			for _, expectedItem := range expected {
				if scalarEqual(item, expectedItem) {
					return true
				}
			}
		}
		return false
	}
	for _, expectedItem := range expected {
		if scalarEqual(value, expectedItem) {
			return true
		}
	}
	return false
}

func scalarEqual(left any, right any) bool {
	if leftNumber, ok := numberValue(left); ok {
		if rightNumber, rightOK := numberValue(right); rightOK {
			return leftNumber == rightNumber
		}
	}
	return cleanAnyString(left) == cleanAnyString(right)
}

func truthy(value any) bool {
	switch value := value.(type) {
	case bool:
		return value
	case string:
		normalized := strings.ToLower(strings.TrimSpace(value))
		return normalized != "" && normalized != "0" && normalized != "false" && normalized != "no" && normalized != "off"
	case float64:
		return value != 0
	case int:
		return value != 0
	default:
		return value != nil
	}
}

func stringList(value any) []string {
	switch value := value.(type) {
	case string:
		if strings.TrimSpace(value) == "" {
			return nil
		}
		return []string{strings.TrimSpace(value)}
	case []string:
		return value
	case []any:
		result := make([]string, 0, len(value))
		for _, item := range value {
			if text := cleanAnyString(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

type queryRowContext interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}
