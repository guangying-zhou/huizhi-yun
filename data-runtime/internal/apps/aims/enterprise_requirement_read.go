package aims

import (
	"context"
	"database/sql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"net/url"
	"strconv"
	"strings"
)

// Read projections share a snapshot for COUNT, pagination and chapter relations.
// The signed project visibility guard is applied before reading any child object.
func (a *Adapter) ReadEnterpriseRequirementProjection(ctx context.Context, projectID, action string, q url.Values) (map[string]any, error) {
	if err := a.requireProjectReadAccess(ctx, projectID, q); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	data := map[string]any{}
	switch action {
	case "spec":
		docs, e := aimsQueryMaps(ctx, tx, `SELECT id,uuid,title,codocs_uuid AS codocsUuid,import_mode AS importMode,heading_levels AS headingLevels,import_status AS importStatus FROM project_documents WHERE project_id=? AND doc_category='requirement_spec' ORDER BY id LIMIT 1`, projectID)
		if e != nil {
			return nil, e
		}
		data["spec"] = nil
		if len(docs) > 0 {
			data["spec"] = docs[0]
		}
		where := ""
		if q.Get("include_deleted") != "1" {
			where = " AND c.status<>'deprecated'"
		}
		contents, e := aimsQueryMaps(ctx, tx, `SELECT c.id,c.content_original_id AS contentOriginalId,c.version_no AS versionNo,c.version_status AS versionStatus,c.parent_id AS parentId,c.heading_depth AS headingDepth,c.title,c.sort_order AS sortOrder,c.status,c.content_md AS contentMd,c.created_at AS createdAt,(SELECT MIN(r.requirement_id) FROM requirement_item_contents r JOIN requirement_items i ON i.id=r.requirement_id AND i.project_id=c.project_id WHERE r.content_id=c.id AND r.relation_type='baseline') AS requirementId FROM requirement_contents c WHERE c.project_id=? AND c.version_status IN ('draft','baselined')`+where+` ORDER BY c.parent_id IS NOT NULL,c.parent_id,c.sort_order,c.id LIMIT 10001`, projectID)
		if e != nil {
			return nil, e
		}
		if len(contents) > 10000 {
			return nil, httperror.New(503, "requirement_spec_limit", "Specification exceeds the supported limit")
		}
		requirements, e := aimsQueryMaps(ctx, tx, `SELECT DISTINCT i.id,i.req_code AS reqCode,i.title,i.status,i.created_at AS createdAt FROM requirement_items i JOIN requirement_item_contents r ON r.requirement_id=i.id JOIN requirement_contents c ON c.id=r.content_id AND c.project_id=i.project_id WHERE i.project_id=? AND r.relation_type='baseline' ORDER BY i.id`, projectID)
		if e != nil {
			return nil, e
		}
		data["contents"], data["requirements"] = contents, requirements
	case "targets":
		filter, filterArgs := requirementListWhere(projectID, q)
		filter += " AND r.status<>'deprecated'"
		targetArgs := append(append(append([]any{}, filterArgs...), filterArgs...), projectID)
		items, e := aimsQueryMaps(ctx, tx, `SELECT w.id,w.item_key AS itemKey,w.title,w.status,w.milestone_id AS milestoneId,m.name AS milestoneName,m.pivr_stage AS milestonePivrStage,w.template_key AS templateKey,w.created_at AS createdAt,(SELECT COUNT(*) FROM requirement_items r WHERE r.project_id=w.project_id AND r.work_item_id=w.id AND `+filter+`) AS requirementCount,(SELECT COUNT(*) FROM work_items t JOIN requirement_items r ON r.id=t.requirement_id AND r.project_id=t.project_id WHERE t.project_id=w.project_id AND t.parent_id=w.id AND t.type='task' AND `+filter+`) AS taskCount FROM work_items w LEFT JOIN milestones m ON m.id=w.milestone_id AND m.project_id=w.project_id WHERE w.project_id=? AND w.tier='target' AND w.type='requirement' ORDER BY (w.template_key='requirement_baseline') DESC,w.created_at,w.id LIMIT 1001`, targetArgs...)
		if e != nil {
			return nil, e
		}
		if len(items) > 1000 {
			return nil, httperror.New(503, "requirement_target_limit", "Requirement targets exceed the supported limit")
		}
		for i := range items {
			items[i]["isBaseline"] = i == 0
		}
		data["items"] = items
	case "list":
		where, args := requirementListWhere(projectID, q)
		page, size := 1, 50
		for key, dest := range map[string]*int{"page": &page, "pageSize": &size} {
			if q.Get(key) != "" {
				n, e := strconv.Atoi(q.Get(key))
				if e != nil || n < 1 || key == "pageSize" && n > 100 {
					return nil, httperror.New(400, "requirement_query_invalid", "Invalid pagination")
				}
				*dest = n
			}
		}
		if page > 1000000 {
			return nil, httperror.New(400, "requirement_query_invalid", "Invalid pagination")
		}
		var total int64
		if e := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM requirement_items r WHERE "+where, args...).Scan(&total); e != nil {
			return nil, e
		}
		sort := q.Get("sort")
		if sort == "" {
			sort = "req_number"
		}
		if !containsString([]string{"req_number", "priority", "status", "created_at", "updated_at"}, sort) {
			return nil, httperror.New(400, "requirement_query_invalid", "Invalid sort")
		}
		order := strings.ToUpper(q.Get("order"))
		if order == "" {
			order = "ASC"
		}
		if order != "ASC" && order != "DESC" {
			return nil, httperror.New(400, "requirement_query_invalid", "Invalid order")
		}
		listArgs := append(append([]any{}, args...), size, (page-1)*size)
		items, e := aimsQueryMaps(ctx, tx, `SELECT r.id,r.item_kind AS itemKind,r.parent_requirement_id AS parentRequirementId,r.change_no AS changeNo,r.change_reason AS changeReason,r.scope_note AS scopeNote,r.req_number AS reqNumber,r.req_code AS reqCode,r.title,r.type,r.category,r.priority,r.source,r.milestone_id AS milestoneId,m.name AS milestoneName,r.status,r.current_version AS currentVersion,r.baselined_at AS baselinedAt,r.created_by AS createdBy,r.created_at AS createdAt,r.updated_at AS updatedAt,(SELECT COUNT(*) FROM requirement_item_contents c WHERE c.requirement_id=r.id) AS contentCount,(SELECT w.item_key FROM work_items w WHERE w.project_id=r.project_id AND w.requirement_id=r.id AND w.type IN ('task','change_request') ORDER BY w.id LIMIT 1) AS taskItemKey,(SELECT w.status FROM work_items w WHERE w.project_id=r.project_id AND w.requirement_id=r.id AND w.type IN ('task','change_request') ORDER BY w.id LIMIT 1) AS taskStatus FROM requirement_items r LEFT JOIN milestones m ON m.id=r.milestone_id AND m.project_id=r.project_id WHERE `+where+` ORDER BY r.`+sort+` `+order+`,r.id LIMIT ? OFFSET ?`, listArgs...)
		if e != nil {
			return nil, e
		}
		counts, e := aimsQueryMaps(ctx, tx, `SELECT status,COUNT(*) AS count FROM requirement_items WHERE project_id=? GROUP BY status`, projectID)
		if e != nil {
			return nil, e
		}
		statusCounts := map[string]any{}
		for _, c := range counts {
			statusCounts[fmtRequirementText(c["status"])] = c["count"]
		}
		var draft, baseline, pending int64
		if e = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(status='draft' AND item_kind='baseline'),0),COALESCE(SUM(status='baselined' AND item_kind='baseline'),0) FROM requirement_items WHERE project_id=?`, projectID).Scan(&draft, &baseline); e != nil {
			return nil, e
		}
		if e = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM requirement_review_batches WHERE project_id=? AND status='pending'`, projectID).Scan(&pending); e != nil {
			return nil, e
		}
		data = map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "statusCounts": statusCounts, "baselineSummary": map[string]any{"draftCount": draft, "baselinedCount": baseline, "pendingBatchCount": pending}}
	default:
		return nil, httperror.New(400, "requirement_action_invalid", "Invalid read action")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"code": 0, "data": data}, nil
}
func fmtRequirementText(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}
func requirementListWhere(projectID string, q url.Values) (string, []any) {
	where := "r.project_id=?"
	args := []any{projectID}
	status := q.Get("status")
	if status == "" || status == "active" {
		where += " AND r.status<>'deprecated'"
	} else if status != "all" {
		where += " AND r.status=?"
		args = append(args, status)
	}
	for _, key := range []string{"type", "priority", "milestone_id", "source", "work_item_id"} {
		if value := q.Get(key); value != "" && value != "all" {
			where += " AND r." + key + "=?"
			args = append(args, value)
		}
	}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		where += " AND (LOCATE(?,r.title)>0 OR LOCATE(?,r.req_code)>0)"
		args = append(args, search, search)
	}
	return where, args
}
