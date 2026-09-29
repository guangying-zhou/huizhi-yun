package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type requirementExportContent struct {
	ID            int64   `json:"id"`
	ParentID      *int64  `json:"parentId"`
	HeadingDepth  int64   `json:"headingDepth"`
	Title         string  `json:"title"`
	ContentMd     *string `json:"contentMd"`
	SortOrder     int64   `json:"sortOrder"`
	Status        string  `json:"status"`
	RequirementID *int64  `json:"requirementId"`
}

type requirementExportItem struct {
	ID      int64  `json:"id"`
	ReqCode string `json:"reqCode"`
	Status  string `json:"status"`
}

type requirementVersionItem struct {
	ID           int64   `json:"id"`
	VersionNo    int64   `json:"versionNo"`
	Snapshot     any     `json:"snapshot"`
	ChangeType   string  `json:"changeType"`
	ChangeReason *string `json:"changeReason"`
	BatchID      *int64  `json:"batchId"`
	ApprovedBy   *string `json:"approvedBy"`
	ApprovedAt   *string `json:"approvedAt"`
	CreatedBy    string  `json:"createdBy"`
	CreatedAt    string  `json:"createdAt"`
}

type requirementDetailData struct {
	ID                  int64                      `json:"id"`
	ItemKind            string                     `json:"itemKind"`
	ParentRequirementID *int64                     `json:"parentRequirementId"`
	ChangeNo            *int64                     `json:"changeNo"`
	ChangeReason        *string                    `json:"changeReason"`
	ProjectID           int64                      `json:"projectId"`
	ReqNumber           int64                      `json:"reqNumber"`
	ReqCode             string                     `json:"reqCode"`
	Title               string                     `json:"title"`
	Type                string                     `json:"type"`
	Category            *string                    `json:"category"`
	Priority            string                     `json:"priority"`
	Source              string                     `json:"source"`
	ScopeNote           *string                    `json:"scopeNote"`
	MilestoneID         *int64                     `json:"milestoneId"`
	MilestoneName       *string                    `json:"milestoneName"`
	Status              string                     `json:"status"`
	CurrentVersion      int64                      `json:"currentVersion"`
	BaselinedAt         *string                    `json:"baselinedAt"`
	CreatedBy           string                     `json:"createdBy"`
	CreatedAt           string                     `json:"createdAt"`
	UpdatedBy           *string                    `json:"updatedBy"`
	UpdatedAt           *string                    `json:"updatedAt"`
	ParentRequirement   *requirementDetailParent   `json:"parentRequirement"`
	Contents            []requirementDetailContent `json:"contents"`
	ContextModules      []requirementDetailModule  `json:"contextModules"`
	Tasks               []requirementDetailTask    `json:"tasks"`
	Versions            []requirementDetailVersion `json:"versions"`
}

type requirementDetailParent struct {
	ID      int64  `json:"id"`
	ReqCode string `json:"reqCode"`
	Title   string `json:"title"`
}

type requirementDetailContent struct {
	ID             int64   `json:"id"`
	ParentID       *int64  `json:"parentId"`
	SourceParentID *int64  `json:"sourceParentId"`
	Title          string  `json:"title"`
	HeadingDepth   int64   `json:"headingDepth"`
	SortOrder      int64   `json:"sortOrder"`
	Status         string  `json:"status"`
	ContentMd      *string `json:"contentMd"`
}

type requirementDetailModule struct {
	ID           int64   `json:"id"`
	Title        string  `json:"title"`
	HeadingDepth int64   `json:"headingDepth"`
	SortOrder    int64   `json:"sortOrder"`
	ContentMd    *string `json:"contentMd"`
}

type requirementDetailTask struct {
	ID              int64   `json:"id"`
	ItemKey         string  `json:"itemKey"`
	Title           string  `json:"title"`
	Status          string  `json:"status"`
	AssigneeUID     *string `json:"assigneeUid"`
	Type            string  `json:"type"`
	ChangeRequestOf *int64  `json:"changeRequestOf"`
}

type requirementDetailVersion struct {
	ID           int64   `json:"id"`
	VersionNo    int64   `json:"versionNo"`
	ChangeType   string  `json:"changeType"`
	ChangeReason *string `json:"changeReason"`
	ApprovedBy   *string `json:"approvedBy"`
	ApprovedAt   *string `json:"approvedAt"`
	CreatedBy    string  `json:"createdBy"`
	CreatedAt    string  `json:"createdAt"`
}

func (a *Adapter) projectRequirementDetail(ctx context.Context, rawProjectID, rawRequirementID string, query url.Values) (*requirementDetailData, error) {
	projectID, err := strconv.ParseInt(strings.TrimSpace(rawProjectID), 10, 64)
	if err != nil || projectID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_project_id", "Invalid project ID")
	}
	detail, err := a.requirementDetail(ctx, rawRequirementID, query)
	if err != nil {
		return nil, err
	}
	if !requirementBelongsToProject(detail, projectID) {
		return nil, httperror.New(http.StatusNotFound, "requirement_not_found", "Requirement not found")
	}
	return detail, nil
}

func requirementBelongsToProject(detail *requirementDetailData, projectID int64) bool {
	return detail != nil && projectID > 0 && detail.ProjectID == projectID
}

type requirementImpactTask struct {
	ID             int64   `json:"id"`
	ItemKey        string  `json:"itemKey"`
	Title          string  `json:"title"`
	Status         string  `json:"status"`
	AssigneeUID    *string `json:"assigneeUid"`
	Type           string  `json:"type"`
	ImpactCategory string  `json:"impactCategory"`
}

type requirementChangeDiffRequirement struct {
	ID                  int64  `json:"id"`
	ReqCode             string `json:"reqCode"`
	Title               string `json:"title"`
	Status              string `json:"status"`
	ParentRequirementID int64  `json:"parentRequirementId"`
	ParentReqCode       string `json:"parentReqCode"`
	ParentTitle         string `json:"parentTitle"`
}

type requirementChangeDiffContent struct {
	ID        int64   `json:"id"`
	Title     string  `json:"title"`
	ContentMd *string `json:"contentMd"`
	VersionNo int64   `json:"versionNo"`
}

type requirementChangeDiffItem struct {
	ContentOriginalID *int64                        `json:"contentOriginalId"`
	DiffStatus        string                        `json:"diffStatus"`
	Base              *requirementChangeDiffContent `json:"base"`
	Change            requirementChangeDiffContent  `json:"change"`
}

func (a *Adapter) requireRequirementProjectMemberOrScopedAdmin(ctx context.Context, requirementID int64, uid string, query url.Values) error {
	uid = strings.TrimSpace(uid)
	if uid == "" {
		return httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	var projectID int64
	err := a.DB().QueryRowContext(ctx, `
		SELECT project_id
		FROM requirement_items
		WHERE id = ?
	`, requirementID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return httperror.New(http.StatusNotFound, "requirement_not_found", "requirement not found")
	}
	if err != nil {
		return err
	}
	return a.requireProjectMemberOrScopedAdmin(ctx, projectID, uid, query)
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func (a *Adapter) requirementDetail(ctx context.Context, rawRequirementID string, query url.Values) (*requirementDetailData, error) {
	requirementID, err := parseID(rawRequirementID, "requirement_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	var detail requirementDetailData
	var itemKind, reqCode, title, reqType, category, priority, source, scopeNote, status sql.NullString
	var parentRequirementID, changeNo, milestoneID sql.NullInt64
	var changeReason, baselinedAt, createdBy, createdAt, updatedBy, updatedAt, milestoneName sql.NullString
	err = a.DB().QueryRowContext(ctx, `
		SELECT r.id, r.item_kind, r.parent_requirement_id, r.change_no, r.change_reason,
		       r.project_id, r.req_number, r.req_code, r.title, r.type, r.category,
		       r.priority, r.source, r.scope_note, r.milestone_id, r.status,
		       r.current_version,
		       DATE_FORMAT(r.baselined_at, '%Y-%m-%d %H:%i:%s') AS baselined_at,
		       r.created_by,
		       DATE_FORMAT(r.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       r.updated_by,
		       DATE_FORMAT(r.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at,
		       m.name AS milestone_name
		FROM requirement_items r
		LEFT JOIN milestones m ON m.id = r.milestone_id
		WHERE r.id = ?
	`, requirementID).Scan(
		&detail.ID,
		&itemKind,
		&parentRequirementID,
		&changeNo,
		&changeReason,
		&detail.ProjectID,
		&detail.ReqNumber,
		&reqCode,
		&title,
		&reqType,
		&category,
		&priority,
		&source,
		&scopeNote,
		&milestoneID,
		&status,
		&detail.CurrentVersion,
		&baselinedAt,
		&createdBy,
		&createdAt,
		&updatedBy,
		&updatedAt,
		&milestoneName,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "requirement_not_found", "需求不存在")
	}
	if err != nil {
		return nil, err
	}

	if err := a.requireProjectMemberOrScopedAdmin(ctx, detail.ProjectID, uid, query); err != nil {
		return nil, err
	}

	detail.ItemKind = nullStringValue(itemKind)
	detail.ParentRequirementID = nullableInt64(parentRequirementID)
	detail.ChangeNo = nullableInt64(changeNo)
	detail.ChangeReason = nullableString(changeReason)
	detail.ReqCode = nullStringValue(reqCode)
	detail.Title = nullStringValue(title)
	detail.Type = nullStringValue(reqType)
	detail.Category = nullableString(category)
	detail.Priority = nullStringValue(priority)
	detail.Source = nullStringValue(source)
	detail.ScopeNote = nullableString(scopeNote)
	detail.MilestoneID = nullableInt64(milestoneID)
	detail.MilestoneName = nullableString(milestoneName)
	detail.Status = nullStringValue(status)
	detail.BaselinedAt = nullableString(baselinedAt)
	detail.CreatedBy = nullStringValue(createdBy)
	detail.CreatedAt = nullStringValue(createdAt)
	detail.UpdatedBy = nullableString(updatedBy)
	detail.UpdatedAt = nullableString(updatedAt)

	if detail.ParentRequirementID != nil {
		parent, err := a.requirementDetailParent(ctx, *detail.ParentRequirementID)
		if err != nil {
			return nil, err
		}
		detail.ParentRequirement = parent
	}

	contents, err := a.requirementDetailContents(ctx, requirementID, detail.ProjectID, detail.ItemKind)
	if err != nil {
		return nil, err
	}
	detail.Contents = contents

	contextModules, err := a.requirementDetailContextModules(ctx, contents)
	if err != nil {
		return nil, err
	}
	detail.ContextModules = contextModules

	tasks, err := a.requirementDetailTasks(ctx, requirementID)
	if err != nil {
		return nil, err
	}
	detail.Tasks = tasks

	versions, err := a.requirementDetailVersions(ctx, requirementID)
	if err != nil {
		return nil, err
	}
	detail.Versions = versions

	return &detail, nil
}

func (a *Adapter) requirementDetailParent(ctx context.Context, parentRequirementID int64) (*requirementDetailParent, error) {
	var parent requirementDetailParent
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, req_code, title
		FROM requirement_items
		WHERE id = ?
	`, parentRequirementID).Scan(&parent.ID, &parent.ReqCode, &parent.Title)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &parent, nil
}

func (a *Adapter) requirementDetailContents(ctx context.Context, requirementID int64, projectID int64, itemKind string) ([]requirementDetailContent, error) {
	relationType := "baseline"
	visibleVersionStatuses := "'draft', 'baselined'"
	if itemKind == "change" {
		relationType = "change"
		visibleVersionStatuses = "'baselined', 'change_draft', 'in_review'"
	}

	rows, err := a.DB().QueryContext(ctx, `
		WITH RECURSIVE content_scope AS (
		   SELECT c.id, c.content_original_id, CAST(NULL AS UNSIGNED) AS display_parent_id, c.parent_id AS source_parent_id,
		          c.title, c.heading_depth, c.sort_order,
		          c.status, c.content_md, ric.sort_order AS relation_sort_order,
		          CAST(CONCAT(LPAD(COALESCE(ric.sort_order, c.sort_order), 10, '0'), '.', LPAD(c.id, 10, '0')) AS CHAR(2000)) AS sort_path,
		          CAST(CONCAT(',', c.id, ',') AS CHAR(2000)) AS path_ids
		   FROM requirement_contents c
		   LEFT JOIN requirement_item_contents ric
		     ON ric.content_id = c.id
		    AND ric.requirement_id = ?
		    AND ric.relation_type = ?
		   WHERE ric.id IS NOT NULL
		     AND c.version_status IN (`+visibleVersionStatuses+`)

		   UNION ALL

		   SELECT child.id, child.content_original_id, scope.id AS display_parent_id, child.parent_id AS source_parent_id,
		          child.title, child.heading_depth,
		          child.sort_order, child.status, child.content_md,
		          scope.relation_sort_order,
		          CONCAT(scope.sort_path, '.', LPAD(child.sort_order, 10, '0'), '.', LPAD(child.id, 10, '0')) AS sort_path,
		          CONCAT(scope.path_ids, child.id, ',') AS path_ids
		   FROM requirement_contents child
		   INNER JOIN requirement_contents parent_version ON parent_version.id = child.parent_id
		   INNER JOIN content_scope scope
		     ON COALESCE(parent_version.content_original_id, parent_version.id) = COALESCE(scope.content_original_id, scope.id)
		   WHERE child.project_id = ?
		     AND child.version_status IN (`+visibleVersionStatuses+`)
		     AND LOCATE(CONCAT(',', child.id, ','), scope.path_ids) = 0
		)
		SELECT id, content_original_id, display_parent_id, source_parent_id, title, heading_depth, sort_order, status, content_md, relation_sort_order
		FROM (
		  SELECT content_scope.*,
		         ROW_NUMBER() OVER (PARTITION BY id ORDER BY sort_path) AS rn
		  FROM content_scope
		) ranked
		WHERE rn = 1
		ORDER BY sort_path
	`, requirementID, relationType, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	contents := make([]requirementDetailContent, 0)
	for rows.Next() {
		var content requirementDetailContent
		var contentOriginalID, displayParentID, sourceParentID, relationSortOrder sql.NullInt64
		var title, status, contentMd sql.NullString
		if err := rows.Scan(
			&content.ID,
			&contentOriginalID,
			&displayParentID,
			&sourceParentID,
			&title,
			&content.HeadingDepth,
			&content.SortOrder,
			&status,
			&contentMd,
			&relationSortOrder,
		); err != nil {
			return nil, err
		}
		content.ParentID = nullableInt64(displayParentID)
		content.SourceParentID = nullableInt64(sourceParentID)
		content.Title = nullStringValue(title)
		content.Status = nullStringValue(status)
		content.ContentMd = nullableString(contentMd)
		contents = append(contents, content)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return contents, nil
}

func (a *Adapter) requirementDetailContextModules(ctx context.Context, contents []requirementDetailContent) ([]requirementDetailModule, error) {
	contentIDs := make(map[int64]bool, len(contents))
	for _, content := range contents {
		contentIDs[content.ID] = true
	}

	seen := make(map[int64]bool)
	contextModuleIDs := make([]int64, 0)
	for _, content := range contents {
		if content.SourceParentID == nil {
			continue
		}
		id := *content.SourceParentID
		if contentIDs[id] || seen[id] {
			continue
		}
		seen[id] = true
		contextModuleIDs = append(contextModuleIDs, id)
	}
	if len(contextModuleIDs) == 0 {
		return []requirementDetailModule{}, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(contextModuleIDs)), ",")
	args := make([]any, 0, len(contextModuleIDs))
	for _, id := range contextModuleIDs {
		args = append(args, id)
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, title, heading_depth, sort_order, content_md
		FROM requirement_contents
		WHERE id IN (`+placeholders+`)
		ORDER BY sort_order, id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	modules := make([]requirementDetailModule, 0)
	for rows.Next() {
		var module requirementDetailModule
		var title, contentMd sql.NullString
		if err := rows.Scan(
			&module.ID,
			&title,
			&module.HeadingDepth,
			&module.SortOrder,
			&contentMd,
		); err != nil {
			return nil, err
		}
		module.Title = nullStringValue(title)
		module.ContentMd = nullableString(contentMd)
		modules = append(modules, module)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return modules, nil
}

func (a *Adapter) requirementDetailTasks(ctx context.Context, requirementID int64) ([]requirementDetailTask, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, item_key, title, status, assignee_uid, type, change_request_of
		FROM work_items
		WHERE requirement_id = ?
		ORDER BY created_at
	`, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := make([]requirementDetailTask, 0)
	for rows.Next() {
		var task requirementDetailTask
		var itemKey, title, status, assigneeUID, itemType sql.NullString
		var changeRequestOf sql.NullInt64
		if err := rows.Scan(
			&task.ID,
			&itemKey,
			&title,
			&status,
			&assigneeUID,
			&itemType,
			&changeRequestOf,
		); err != nil {
			return nil, err
		}
		task.ItemKey = nullStringValue(itemKey)
		task.Title = nullStringValue(title)
		task.Status = nullStringValue(status)
		task.AssigneeUID = nullableString(assigneeUID)
		task.Type = nullStringValue(itemType)
		task.ChangeRequestOf = nullableInt64(changeRequestOf)
		tasks = append(tasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return tasks, nil
}

func (a *Adapter) requirementDetailVersions(ctx context.Context, requirementID int64) ([]requirementDetailVersion, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, version_no, change_type, change_reason, approved_by,
		       DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at,
		       created_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM requirement_versions
		WHERE requirement_id = ?
		ORDER BY version_no DESC
	`, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	versions := make([]requirementDetailVersion, 0)
	for rows.Next() {
		var version requirementDetailVersion
		var changeType, changeReason, approvedBy, approvedAt, createdBy, createdAt sql.NullString
		if err := rows.Scan(
			&version.ID,
			&version.VersionNo,
			&changeType,
			&changeReason,
			&approvedBy,
			&approvedAt,
			&createdBy,
			&createdAt,
		); err != nil {
			return nil, err
		}
		version.ChangeType = nullStringValue(changeType)
		version.ChangeReason = nullableString(changeReason)
		version.ApprovedBy = nullableString(approvedBy)
		version.ApprovedAt = nullableString(approvedAt)
		version.CreatedBy = nullStringValue(createdBy)
		version.CreatedAt = nullStringValue(createdAt)
		versions = append(versions, version)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return versions, nil
}

func (a *Adapter) requirementVersions(ctx context.Context, rawRequirementID string, query url.Values) ([]requirementVersionItem, error) {
	requirementID, err := parseID(rawRequirementID, "requirement_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireRequirementProjectMemberOrScopedAdmin(ctx, requirementID, uid, query); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, version_no, snapshot_json, change_type, change_reason,
		       batch_id, approved_by,
		       DATE_FORMAT(approved_at, '%Y-%m-%d %H:%i:%s') AS approved_at,
		       created_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM requirement_versions
		WHERE requirement_id = ?
		ORDER BY version_no DESC
	`, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]requirementVersionItem, 0)
	for rows.Next() {
		var item requirementVersionItem
		var snapshotJSON string
		var changeReason, approvedBy, approvedAt, createdBy, createdAt sql.NullString
		var batchID sql.NullInt64
		if err := rows.Scan(
			&item.ID,
			&item.VersionNo,
			&snapshotJSON,
			&item.ChangeType,
			&changeReason,
			&batchID,
			&approvedBy,
			&approvedAt,
			&createdBy,
			&createdAt,
		); err != nil {
			return nil, err
		}
		var snapshot any
		if err := json.Unmarshal([]byte(snapshotJSON), &snapshot); err != nil {
			return nil, fmt.Errorf("parse requirement version snapshot: %w", err)
		}
		item.Snapshot = snapshot
		item.ChangeReason = nullableString(changeReason)
		item.BatchID = nullableInt64(batchID)
		item.ApprovedBy = nullableString(approvedBy)
		item.ApprovedAt = nullableString(approvedAt)
		if createdBy.Valid {
			item.CreatedBy = createdBy.String
		}
		if createdAt.Valid {
			item.CreatedAt = createdAt.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) requirementChangeDiff(ctx context.Context, rawRequirementID string, query url.Values) (map[string]any, error) {
	requirementID, err := parseID(rawRequirementID, "requirement_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireRequirementProjectMemberOrScopedAdmin(ctx, requirementID, uid, query); err != nil {
		return nil, err
	}

	var requirement requirementChangeDiffRequirement
	err = a.DB().QueryRowContext(ctx, `
		SELECT r.id, r.req_code, r.title, r.status, r.parent_requirement_id,
		       p.req_code AS parent_req_code, p.title AS parent_title
		FROM requirement_items r
		INNER JOIN requirement_items p ON p.id = r.parent_requirement_id
		WHERE r.id = ? AND r.item_kind = 'change'
	`, requirementID).Scan(
		&requirement.ID,
		&requirement.ReqCode,
		&requirement.Title,
		&requirement.Status,
		&requirement.ParentRequirementID,
		&requirement.ParentReqCode,
		&requirement.ParentTitle,
	)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "change_requirement_not_found", "变更需求不存在")
	}
	if err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT cc.content_original_id,
		       CASE
		         WHEN pv.id IS NOT NULL THEN 'changed'
		         WHEN pb.id IS NOT NULL THEN 'unchanged'
		         ELSE 'added'
		       END AS diff_status,
		       COALESCE(pv.id, pb.id) AS base_content_id,
		       COALESCE(pv.title, pb.title) AS base_title,
		       COALESCE(pv.content_md, pb.content_md) AS base_content_md,
		       COALESCE(pv.version_no, pb.version_no) AS base_version_no,
		       cc.id AS change_content_id,
		       cc.title AS change_title,
		       cc.content_md AS change_content_md,
		       cc.version_no AS change_version_no
		FROM requirement_item_contents ric
		INNER JOIN requirement_contents cc ON cc.id = ric.content_id
		LEFT JOIN requirement_contents pv
		  ON pv.id = (
		    SELECT prev.id
		    FROM requirement_contents prev
		    WHERE COALESCE(prev.content_original_id, prev.id) = COALESCE(cc.content_original_id, cc.id)
		      AND prev.version_no < cc.version_no
		    ORDER BY prev.version_no DESC, prev.id DESC
		    LIMIT 1
		  )
		LEFT JOIN requirement_contents pb
		  ON pb.id = (
		    SELECT pc.id
		    FROM requirement_item_contents pric
		    INNER JOIN requirement_contents pc ON pc.id = pric.content_id
		    WHERE pric.requirement_id = ?
		      AND pric.relation_type IN ('baseline', 'archived')
		      AND COALESCE(pc.content_original_id, pc.id) = COALESCE(cc.content_original_id, cc.id)
		    ORDER BY
		      CASE pric.relation_type WHEN 'baseline' THEN 0 ELSE 1 END,
		      pc.version_no DESC,
		      pc.id DESC
		    LIMIT 1
		  )
		WHERE ric.requirement_id = ?
		  AND ric.relation_type = 'change'
		ORDER BY ric.sort_order, cc.id
	`, requirement.ParentRequirementID, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]requirementChangeDiffItem, 0)
	for rows.Next() {
		var item requirementChangeDiffItem
		var contentOriginalID, baseContentID, baseVersionNo sql.NullInt64
		var baseTitle, baseContentMd, changeContentMd sql.NullString
		if err := rows.Scan(
			&contentOriginalID,
			&item.DiffStatus,
			&baseContentID,
			&baseTitle,
			&baseContentMd,
			&baseVersionNo,
			&item.Change.ID,
			&item.Change.Title,
			&changeContentMd,
			&item.Change.VersionNo,
		); err != nil {
			return nil, err
		}
		item.ContentOriginalID = nullableInt64(contentOriginalID)
		if baseContentID.Valid {
			item.Base = &requirementChangeDiffContent{
				ID:        baseContentID.Int64,
				Title:     baseTitle.String,
				ContentMd: nullableString(baseContentMd),
				VersionNo: baseVersionNo.Int64,
			}
		}
		item.Change.ContentMd = nullableString(changeContentMd)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"requirement": requirement,
		"items":       items,
	}, nil
}

func (a *Adapter) requirementChangeImpact(ctx context.Context, rawRequirementID string, query url.Values) (map[string]any, error) {
	requirementID, err := parseID(rawRequirementID, "requirement_id")
	if err != nil {
		return nil, err
	}
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireRequirementProjectMemberOrScopedAdmin(ctx, requirementID, uid, query); err != nil {
		return nil, err
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, item_key, title, status, assignee_uid, type
		FROM work_items
		WHERE requirement_id = ? AND type IN ('task', 'change_request')
		ORDER BY created_at
	`, requirementID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	linkedTasks := make([]requirementImpactTask, 0)
	for rows.Next() {
		var task requirementImpactTask
		var assigneeUID sql.NullString
		if err := rows.Scan(
			&task.ID,
			&task.ItemKey,
			&task.Title,
			&task.Status,
			&assigneeUID,
			&task.Type,
		); err != nil {
			return nil, err
		}
		task.AssigneeUID = nullableString(assigneeUID)
		switch {
		case task.AssigneeUID == nil || task.Status == "planning" || task.Status == "todo":
			task.ImpactCategory = "safe_to_update"
		case task.Status == "in_progress" || task.Status == "in_review":
			task.ImpactCategory = "user_choice"
		default:
			task.ImpactCategory = "force_change_request"
		}
		linkedTasks = append(linkedTasks, task)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	recommendation := "direct_update"
	hasForceChangeRequest := false
	hasUserChoice := false
	for _, task := range linkedTasks {
		if task.ImpactCategory == "force_change_request" {
			hasForceChangeRequest = true
		}
		if task.ImpactCategory == "user_choice" {
			hasUserChoice = true
		}
	}
	if hasForceChangeRequest {
		allForceChangeRequest := len(linkedTasks) > 0
		for _, task := range linkedTasks {
			if task.ImpactCategory != "force_change_request" {
				allForceChangeRequest = false
				break
			}
		}
		if allForceChangeRequest {
			recommendation = "change_request_only"
		} else {
			recommendation = "mixed"
		}
	} else if hasUserChoice {
		recommendation = "mixed"
	}

	return map[string]any{
		"linkedTasks":    linkedTasks,
		"recommendation": recommendation,
	}, nil
}

func (a *Adapter) projectCodocsCandidateCodes(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	projectID, err := normalizeRequiredID(projectID, "project_id")
	if err != nil {
		return nil, err
	}

	var id int64
	var gitGroup sql.NullString
	row := a.DB().QueryRowContext(ctx, `
		SELECT p.id, pf.git_group
		FROM aims_projects p
		LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
		WHERE p.id = ?
	`, projectID)
	if err := row.Scan(&id, &gitGroup); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
		}
		return nil, fmt.Errorf("query project codocs candidates: %w", err)
	}

	codes, err := a.decomposeSourceProjectCodes(ctx, id, nullableString(gitGroup))
	if err != nil {
		return nil, err
	}
	return map[string]any{"sourceProjectCodes": codes}, nil
}

func (a *Adapter) projectRequirementsExportData(ctx context.Context, projectID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}
	projectID, err := normalizeRequiredID(projectID, "project_id")
	if err != nil {
		return nil, err
	}

	var projectName string
	row := a.DB().QueryRowContext(ctx, `
		SELECT name
		FROM aims_projects
		WHERE id = ?
	`, projectID)
	if err := row.Scan(&projectName); err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
		}
		return nil, fmt.Errorf("query requirement export project: %w", err)
	}

	contents, err := a.requirementExportContents(ctx, projectID)
	if err != nil {
		return nil, err
	}
	requirements, err := a.requirementExportItems(ctx, contents)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"projectName":  projectName,
		"contents":     contents,
		"requirements": requirements,
	}, nil
}

func (a *Adapter) requirementContentRelations(ctx context.Context, contentID string, query url.Values) (map[string]any, error) {
	if err := requireCurrentUser(query); err != nil {
		return nil, err
	}
	contentID, err := normalizeRequiredID(contentID, "content_id")
	if err != nil {
		return nil, err
	}

	var projectID string
	err = a.DB().QueryRowContext(ctx, `
		SELECT project_id
		FROM requirement_contents
		WHERE id = ?
		LIMIT 1
	`, contentID).Scan(&projectID)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "requirement_content_not_found", "requirement content not found")
	}
	if err != nil {
		return nil, err
	}
	if err := a.requireProjectReadAccess(ctx, projectID, query); err != nil {
		return nil, err
	}

	where := []string{"content_id = ?"}
	args := []any{contentID}
	if relationType := strings.TrimSpace(query.Get("relation_type")); relationType != "" {
		where = append(where, "relation_type = ?")
		args = append(args, relationType)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, requirement_id, content_id, relation_type, sort_order, created_by,
		       DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM requirement_item_contents
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY sort_order ASC, id ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"items":    items,
		"total":    len(items),
		"page":     1,
		"pageSize": len(items),
	}, nil
}

func (a *Adapter) requirementExportContents(ctx context.Context, projectID string) ([]requirementExportContent, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT c.id, c.parent_id, c.heading_depth, c.title, c.content_md, c.sort_order, c.status,
		       ric.requirement_id
		FROM requirement_contents c
		LEFT JOIN requirement_item_contents ric
		  ON ric.content_id = c.id
		 AND ric.relation_type = 'baseline'
		WHERE c.project_id = ?
		ORDER BY c.parent_id IS NULL DESC, c.parent_id, c.sort_order
	`, projectID)
	if err != nil {
		return nil, fmt.Errorf("query requirement export contents: %w", err)
	}
	defer rows.Close()

	contents := make([]requirementExportContent, 0)
	for rows.Next() {
		var content requirementExportContent
		var parentID, requirementID sql.NullInt64
		var contentMd sql.NullString
		if err := rows.Scan(
			&content.ID,
			&parentID,
			&content.HeadingDepth,
			&content.Title,
			&contentMd,
			&content.SortOrder,
			&content.Status,
			&requirementID,
		); err != nil {
			return nil, fmt.Errorf("scan requirement export content: %w", err)
		}
		content.ParentID = nullableInt64(parentID)
		content.ContentMd = nullableString(contentMd)
		content.RequirementID = nullableInt64(requirementID)
		contents = append(contents, content)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return contents, nil
}

func (a *Adapter) requirementExportItems(ctx context.Context, contents []requirementExportContent) ([]requirementExportItem, error) {
	seen := make(map[int64]bool)
	ids := make([]int64, 0)
	for _, content := range contents {
		if content.RequirementID == nil || seen[*content.RequirementID] {
			continue
		}
		seen[*content.RequirementID] = true
		ids = append(ids, *content.RequirementID)
	}
	if len(ids) == 0 {
		return []requirementExportItem{}, nil
	}

	placeholders := strings.TrimRight(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, req_code, status
		FROM requirement_items
		WHERE id IN (`+placeholders+`)
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query requirement export items: %w", err)
	}
	defer rows.Close()

	items := make([]requirementExportItem, 0)
	for rows.Next() {
		var item requirementExportItem
		if err := rows.Scan(&item.ID, &item.ReqCode, &item.Status); err != nil {
			return nil, fmt.Errorf("scan requirement export item: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}
