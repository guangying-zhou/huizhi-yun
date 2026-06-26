package aims

import (
	"github.com/huizhi-yun/data-runtime/internal/apps/compat"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

type Adapter struct {
	*compat.Adapter
}

var requiredTables = []string{
	"project_portfolios",
	"aims_projects",
	"aims_project_members",
	"project_environments",
	"project_weekly_reports",
	"project_weekly_report_entries",
	"project_weekly_report_work_items",
	"project_template_versions",
	"milestones",
	"work_items",
	"work_item_changelog",
	"project_documents",
	"deliverables",
	"approval_records",
	"requirement_items",
	"requirement_contents",
	"requirement_item_contents",
	"requirement_review_batches",
	"aims_project_products",
	"product_versions",
	"product_version_features",
	"product_version_logs",
}

func New(cfg config.AimsConfig) (*Adapter, error) {
	adapter, err := compat.New(compat.Config{
		AppCode:        "aims",
		DB:             cfg.DB,
		ResponseMode:   compat.ResponseCodeData,
		RequiredTables: requiredTables,
		DashboardCounts: []compat.DashboardCount{
			{Key: "projects", Label: "项目", Table: "aims_projects"},
			{Key: "active_projects", Label: "进行中项目", Table: "aims_projects", Where: "lifecycle_status = 'active'"},
			{Key: "work_items", Label: "工作项", Table: "work_items"},
			{Key: "pending_approvals", Label: "待审核", Table: "approval_records", Where: "status = 'pending'"},
		},
		Resources: []compat.ResourceSpec{
			{
				Path:           "portfolios",
				Table:          "project_portfolios",
				CodeColumn:     "code",
				CodePrefix:     "PF",
				SearchColumns:  []string{"code", "name", "domain_code", "owner_uid", "dept_code"},
				DefaultOrderBy: "`updated_at` DESC, `id` DESC",
			},
			{
				Path:           "projects",
				Table:          "aims_projects",
				CodeColumn:     "project_code",
				CodePrefix:     "PRJ",
				SearchColumns:  []string{"project_code", "name", "short_name", "internal_code", "leader_uid", "customer_code", "customer_name", "contract_code"},
				DefaultOrderBy: "`updated_at` DESC, `id` DESC",
			},
			{
				Path:           "admin/projects",
				Table:          "aims_projects",
				CodeColumn:     "project_code",
				CodePrefix:     "PRJ",
				SearchColumns:  []string{"project_code", "name", "short_name", "internal_code", "leader_uid", "customer_code", "customer_name", "contract_code"},
				DefaultOrderBy: "`name` ASC, `id` ASC",
			},
			{Path: "projects/{project_id}/members", Table: "aims_project_members", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"uid", "role", "status"}, DefaultOrderBy: "`id` DESC"},
			{Path: "projects/{project_id}/environments", Table: "project_environments", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"environment_code", "delivery_asset_code", "relation_type", "delivery_status", "assets_sync_status"}, DefaultOrderBy: "`is_primary` DESC, `id` DESC", SoftDeleteColumn: "deleted_at"},
			{Path: "projects/{project_id}/repos", Table: "aims_project_repos", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"repo_project_code", "last_commit_sha"}, DefaultOrderBy: "`id` DESC"},
			{Path: "projects/{project_id}/milestones", Table: "milestones", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"name", "status", "pivr_stage", "template_key"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC"},
			{Path: "projects/{project_id}/work-items", Table: "work_items", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"item_key", "title", "type", "status", "assignee_uid", "reporter_uid"}, DefaultOrderBy: "`sort_order` ASC, `id` DESC", WriteDenyColumns: []string{"version_id", "feature_id"}},
			{Path: "projects/{project_id}/documents", Table: "project_documents", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"title", "doc_category", "codocs_uuid", "created_by"}, DefaultOrderBy: "`sort_order` ASC, `id` DESC"},
			{Path: "projects/{project_id}/requirements", Table: "requirement_items", PathParamColumns: map[string]string{"project_id": "project_id"}, CodeColumn: "req_code", CodePrefix: "REQ", SearchColumns: []string{"req_code", "title", "type", "status", "created_by"}, DefaultOrderBy: "`id` DESC"},
			{Path: "projects/{project_id}/requirement-contents", Table: "requirement_contents", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"title", "status", "created_by"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC"},
			{Path: "requirement-contents/{content_id}/relations", Table: "requirement_item_contents", PathParamColumns: map[string]string{"content_id": "content_id"}, SearchColumns: []string{"relation_type", "created_by"}, DefaultOrderBy: "`sort_order` ASC, `id` ASC", ReadOnly: true},
			{Path: "projects/{project_id}/requirement-reviews", Table: "requirement_review_batches", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"title", "status", "submitted_by"}, DefaultOrderBy: "`id` DESC"},
			{Path: "projects/{project_id}/gitlab-commits", Table: "gitlab_commits", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"item_key", "repo_project_code", "commit_sha", "author_name"}, DefaultOrderBy: "`committed_at` DESC, `id` DESC", ReadOnly: true},
			{Path: "projects/{project_id}/time-entries", Table: "time_entries", PathParamColumns: map[string]string{"project_id": "project_id"}, SearchColumns: []string{"uid", "description"}, DefaultOrderBy: "`entry_date` DESC, `id` DESC"},
			{
				Path:           "project-template-versions",
				Table:          "project_template_versions",
				SearchColumns:  []string{"version_label", "status", "notes", "published_by", "created_by"},
				DefaultOrderBy: "`id` DESC",
			},
			{Path: "milestones", Table: "milestones", SearchColumns: []string{"name", "status", "pivr_stage", "template_key"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{
				Path:             "work-items",
				Table:            "work_items",
				CodeColumn:       "item_key",
				CodePrefix:       "WI",
				SearchColumns:    []string{"item_key", "title", "type", "status", "assignee_uid", "reporter_uid"},
				DefaultOrderBy:   "`updated_at` DESC, `id` DESC",
				WriteDenyColumns: []string{"version_id", "feature_id"},
			},
			{Path: "work-items/{work_item_id}/comments", Table: "work_item_comments", PathParamColumns: map[string]string{"work_item_id": "work_item_id"}, SearchColumns: []string{"author_uid", "content"}, DefaultOrderBy: "`id` ASC"},
			{Path: "work-items/{work_item_id}/time-entries", Table: "time_entries", PathParamColumns: map[string]string{"work_item_id": "work_item_id"}, SearchColumns: []string{"uid", "description"}, DefaultOrderBy: "`entry_date` DESC, `id` DESC"},
			{Path: "work-items/{work_item_id}/documents", Table: "project_documents", PathParamColumns: map[string]string{"work_item_id": "work_item_id"}, SearchColumns: []string{"title", "doc_category", "codocs_uuid"}, DefaultOrderBy: "`sort_order` ASC, `id` DESC"},
			{Path: "deliverables", Table: "deliverables", SearchColumns: []string{"name", "status", "project_code", "created_by", "submitted_by"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "approvals", Table: "approval_records", SearchColumns: []string{"entity_code", "title", "requested_by", "reviewer_uid", "status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "documents", Table: "project_documents", SearchColumns: []string{"title", "doc_category", "codocs_uuid", "created_by"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "requirements", Table: "requirement_items", CodeColumn: "req_code", CodePrefix: "REQ", SearchColumns: []string{"req_code", "title", "type", "status", "created_by"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "requirement-contents", Table: "requirement_contents", SearchColumns: []string{"title", "status", "created_by"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC"},
			{Path: "requirement-reviews", Table: "requirement_review_batches", SearchColumns: []string{"title", "status", "submitted_by"}, DefaultOrderBy: "`submitted_at` DESC, `id` DESC"},
			{Path: "favorites", Table: "user_favorite_projects", ActorColumn: "uid", SearchColumns: []string{"uid"}, DefaultOrderBy: "`created_at` DESC, `id` DESC"},
			{Path: "my-work-items", Table: "work_items", ActorColumn: "assignee_uid", SearchColumns: []string{"item_key", "title", "type", "status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC", ReadOnly: true},
			{Path: "my-board", Table: "work_items", ActorColumn: "assignee_uid", SearchColumns: []string{"item_key", "title", "type", "status"}, DefaultOrderBy: "`updated_at` DESC, `id` DESC", ReadOnly: true},
			{Path: "users/{uid}/time-entries", Table: "time_entries", PathParamColumns: map[string]string{"uid": "uid"}, SearchColumns: []string{"description"}, DefaultOrderBy: "`entry_date` DESC, `id` DESC"},
		},
	})
	if err != nil {
		return nil, err
	}
	return &Adapter{Adapter: adapter}, nil
}
