package aims

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type directRequirementListConfig struct {
	table         string
	alias         string
	searchColumns []string
	exactFilters  map[string]string
	orderBy       string
}

var directRequirementListConfigs = map[string]directRequirementListConfig{
	"/v1/aims/requirements": {
		table:         "requirement_items",
		alias:         "r",
		searchColumns: []string{"r.req_code", "r.title", "r.type", "r.status", "r.created_by"},
		exactFilters: map[string]string{
			"project_id":            "r.project_id",
			"projectId":             "r.project_id",
			"project_code":          "p.project_code",
			"projectCode":           "p.project_code",
			"status":                "r.status",
			"type":                  "r.type",
			"category":              "r.category",
			"priority":              "r.priority",
			"source":                "r.source",
			"item_kind":             "r.item_kind",
			"itemKind":              "r.item_kind",
			"parent_requirement_id": "r.parent_requirement_id",
			"parentRequirementId":   "r.parent_requirement_id",
			"milestone_id":          "r.milestone_id",
			"milestoneId":           "r.milestone_id",
			"work_item_id":          "r.work_item_id",
			"workItemId":            "r.work_item_id",
			"created_by":            "r.created_by",
			"createdBy":             "r.created_by",
		},
		orderBy: "r.updated_at DESC, r.id DESC",
	},
	"/v1/aims/requirement-contents": {
		table:         "requirement_contents",
		alias:         "c",
		searchColumns: []string{"c.title", "c.status", "c.created_by"},
		exactFilters: map[string]string{
			"project_id":          "c.project_id",
			"projectId":           "c.project_id",
			"project_code":        "p.project_code",
			"projectCode":         "p.project_code",
			"parent_id":           "c.parent_id",
			"parentId":            "c.parent_id",
			"heading_depth":       "c.heading_depth",
			"headingDepth":        "c.heading_depth",
			"status":              "c.status",
			"version_status":      "c.version_status",
			"versionStatus":       "c.version_status",
			"content_original_id": "c.content_original_id",
			"contentOriginalId":   "c.content_original_id",
			"created_by":          "c.created_by",
			"createdBy":           "c.created_by",
		},
		orderBy: "c.updated_at DESC, c.id DESC",
	},
	"/v1/aims/requirement-reviews": {
		table:         "requirement_review_batches",
		alias:         "b",
		searchColumns: []string{"b.title", "b.status", "b.submitted_by"},
		exactFilters: map[string]string{
			"project_id":           "b.project_id",
			"projectId":            "b.project_id",
			"project_code":         "p.project_code",
			"projectCode":          "p.project_code",
			"batch_type":           "b.batch_type",
			"batchType":            "b.batch_type",
			"status":               "b.status",
			"workflow_instance_id": "b.workflow_instance_id",
			"workflowInstanceId":   "b.workflow_instance_id",
			"submitted_by":         "b.submitted_by",
			"submittedBy":          "b.submitted_by",
		},
		orderBy: "b.submitted_at DESC, b.id DESC",
	},
}

func (a *Adapter) directRequirementCollectionList(ctx context.Context, path string, query url.Values) (map[string]any, error) {
	cfg, ok := directRequirementListConfigs[path]
	if !ok {
		return nil, httperror.New(http.StatusNotFound, "resource_not_found", "resource not found")
	}
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	page := directRequirementListPage(query)
	where, args := directRequirementListWhere(query, cfg, currentUser)
	whereSQL := "WHERE " + strings.Join(where, " AND ")
	fromSQL := fmt.Sprintf(" FROM %s %s JOIN aims_projects p ON p.id = %s.project_id ", cfg.table, cfg.alias, cfg.alias)

	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*)"+fromSQL+whereSQL, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count direct requirement collection: %w", err)
	}

	rows, err := a.DB().QueryContext(ctx, "SELECT "+cfg.alias+".*"+fromSQL+whereSQL+" ORDER BY "+cfg.orderBy+" LIMIT ? OFFSET ?", append(args, page.pageSize, page.offset)...)
	if err != nil {
		return nil, fmt.Errorf("query direct requirement collection: %w", err)
	}
	defer rows.Close()

	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    total,
		"page":     page.page,
		"pageSize": page.pageSize,
	}, nil
}

func directRequirementListWhere(query url.Values, cfg directRequirementListConfig, currentUser string) ([]string, []any) {
	where := make([]string, 0, 8)
	args := make([]any, 0, 8)

	for key, column := range cfg.exactFilters {
		value := strings.TrimSpace(query.Get(key))
		if value == "" {
			continue
		}
		where = append(where, column+" = ?")
		args = append(args, value)
	}

	keyword := strings.TrimSpace(firstQueryText(query, "keyword", "search", "q"))
	if keyword != "" && len(cfg.searchColumns) > 0 {
		searchParts := make([]string, 0, len(cfg.searchColumns))
		for _, column := range cfg.searchColumns {
			searchParts = append(searchParts, column+" LIKE ?")
			args = append(args, "%"+keyword+"%")
		}
		where = append(where, "("+strings.Join(searchParts, " OR ")+")")
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	where = append(where, visibilityWhere)
	args = append(args, visibilityArgs...)
	return where, args
}

func directRequirementListPage(query url.Values) projectListPage {
	page := parseProjectPositiveInt(query.Get("page"), 1)
	pageSize := parseProjectPositiveInt(firstQueryText(query, "pageSize", "page_size", "limit"), 20)
	page = clampProjectInt(page, 1, 100000)
	pageSize = clampProjectInt(pageSize, 1, 100)
	return projectListPage{
		page:     page,
		pageSize: pageSize,
		offset:   (page - 1) * pageSize,
	}
}
