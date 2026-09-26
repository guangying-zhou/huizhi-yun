package aims

import (
	"context"
	"database/sql"
	"errors"

	"fmt"
	"github.com/go-sql-driver/mysql"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectDocumentProject struct {
	ID          int64
	ProjectCode string
	DeptCode    sql.NullString
	LeaderUID   sql.NullString
	CreatedBy   string
}

type projectDocumentBinding struct {
	Source          string
	Title           string
	ContentSize     int64
	CodocsUUID      sql.NullString
	RepoProjectCode sql.NullString
	RepoFilePath    sql.NullString
	RepoCommitID    sql.NullString
}

type directDocumentListItem struct {
	ID              int64                     `json:"id"`
	UUID            string                    `json:"uuid"`
	PortfolioID     *int64                    `json:"portfolioId"`
	ProjectID       *int64                    `json:"projectId"`
	ProjectCode     *string                   `json:"projectCode"`
	MilestoneID     *int64                    `json:"milestoneId"`
	WorkItemID      *int64                    `json:"workItemId"`
	ParentID        *int64                    `json:"parentId"`
	Title           string                    `json:"title"`
	DocCategory     *string                   `json:"docCategory"`
	IsFolder        bool                      `json:"isFolder"`
	OssPath         *string                   `json:"ossPath"`
	CodocsUUID      *string                   `json:"codocsUuid"`
	DocumentSource  *string                   `json:"documentSource"`
	RepoProjectCode *string                   `json:"repoProjectCode"`
	RepoFilePath    *string                   `json:"repoFilePath"`
	RepoCommitID    *string                   `json:"repoCommitId"`
	ContentSize     int64                     `json:"contentSize"`
	SortOrder       int64                     `json:"sortOrder"`
	CreatedBy       string                    `json:"createdBy"`
	UpdatedBy       *string                   `json:"updatedBy"`
	CreatedAt       string                    `json:"createdAt"`
	UpdatedAt       string                    `json:"updatedAt"`
	Children        []*directDocumentListItem `json:"children,omitempty"`
}

type directDocumentOwnerContext struct {
	PortfolioID *int64
	ProjectID   *int64
	ProjectCode *string
	MilestoneID *int64
	WorkItemID  *int64
}

func (a *Adapter) handleProjectDocumentRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (map[string]any, string, bool, error) {
	if path == "/v1/aims/documents" {
		switch method {
		case http.MethodGet:
			data, err := a.listDirectDocuments(ctx, query)
			return map[string]any{"items": data}, "aims.documents.list", true, err
		case http.MethodPost:
			data, err := a.createDirectDocument(ctx, query, body)
			return data, "aims.documents.create", true, err
		}
	}

	projectIDText, ok := pathParam(path, "/v1/aims/projects/", "/documents")
	if ok {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectDocuments(ctx, projectIDText, query)
			return data, "aims.projects.documents.list", true, err
		case http.MethodPost:
			data, err := a.createProjectDocumentBinding(ctx, projectIDText, query, body)
			return data, "aims.projects.documents.create", true, err
		case http.MethodPut, http.MethodPatch:
			data, err := a.replaceProjectDocumentBinding(ctx, projectIDText, query, body)
			return data, "aims.projects.documents.replace", true, err
		}
	}
	if projectIDText, documentIDText, matched := nestedPathParam(path, "/v1/aims/projects/", "/documents/"); matched && method == http.MethodGet {
		data, err := a.projectDocumentDetail(ctx, projectIDText, documentIDText, query)
		return data, "aims.projects.documents.detail", true, err
	}

	projectIDText, ok = pathParam(path, "/v1/aims/projects/", "/codocs-project-documents-context")
	if ok && method == http.MethodGet {
		data, err := a.projectCodocsDocumentsContext(ctx, projectIDText, query)
		return data, "aims.projects.codocs_documents.context", true, err
	}

	if !ok {
		return nil, "", false, nil
	}
	return nil, "", true, httperror.New(http.StatusNotImplemented, "runtime_action_not_supported", "This tenant-runtime adapter does not support the requested action yet")
}

func (a *Adapter) projectDocumentDetail(ctx context.Context, projectIDText string, documentIDText string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectReadAccess(ctx, projectIDText, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}
	documentID, err := parseID(documentIDText, "document_id")
	if err != nil {
		return nil, err
	}
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, uuid, title, doc_category, codocs_uuid,
		       document_source, repo_project_code, repo_file_path, repo_commit_id,
		       created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM project_documents
		WHERE id = ? AND project_id = ? AND work_item_id IS NULL AND is_folder = 0
		LIMIT 1
	`, documentID, projectID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}
	if len(items) != 1 {
		return nil, httperror.New(http.StatusNotFound, "project_document_not_found", "project document not found")
	}
	return mapProjectDocumentResponse(items[0]), nil
}

func (a *Adapter) createDirectDocument(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		currentUser = strings.TrimSpace(query.Get("operator_uid"))
	}
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	title := strings.TrimSpace(firstBodyText(body, "title"))
	if title == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_title", "title is required")
	}

	docUUID := strings.TrimSpace(firstBodyText(body, "uuid"))
	if docUUID == "" {
		var err error
		docUUID, err = aimsRandomUUID()
		if err != nil {
			return nil, err
		}
	}

	owner, parentID, err := a.resolveDirectDocumentOwnerContext(ctx, body)
	if err != nil {
		return nil, err
	}
	if owner.ProjectID != nil {
		if err := a.requireProjectMemberOrScopedAdmin(ctx, *owner.ProjectID, currentUser, query); err != nil {
			return nil, err
		}
	}

	isFolder := bodyBool(body, "is_folder", "isFolder")
	documentSource := normalizeDocumentSource(body)
	args := []any{
		docUUID,
		nullableInt64Value(owner.PortfolioID),
		nullableInt64Value(owner.ProjectID),
		nullableStringValue(owner.ProjectCode),
		nullableInt64Value(owner.MilestoneID),
		nullableInt64Value(owner.WorkItemID),
		nullableInt64Value(parentID),
		title,
		nullableText(firstBodyText(body, "doc_category", "docCategory")),
		boolToInt(isFolder),
		nullableText(firstBodyText(body, "oss_path", "ossPath")),
		nullableText(firstBodyText(body, "codocs_uuid", "codocsUuid")),
		nullableText(documentSource),
		nullableText(firstBodyText(body, "repo_project_code", "repoProjectCode")),
		nullableText(firstBodyText(body, "repo_file_path", "repoFilePath")),
		nullableText(firstBodyText(body, "repo_commit_id", "repoCommitId")),
		int64BodyValue(body, "content_size", "contentSize"),
		currentUser,
		currentUser,
	}
	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, portfolio_id, project_id, project_code, milestone_id, work_item_id, parent_id,
		   title, doc_category, is_folder, oss_path, codocs_uuid, document_source,
		   repo_project_code, repo_file_path, repo_commit_id, content_size, created_by, updated_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, args...)
	var id int64
	if err != nil {
		var duplicate *mysql.MySQLError
		if !errors.As(err, &duplicate) || duplicate.Number != 1062 {
			return nil, err
		}
		// Re-authorized above, and every creation field must still match.
		// A UUID collision never permits updating another document.
		err = a.DB().QueryRowContext(ctx, `SELECT id FROM project_documents WHERE
		  uuid = ? AND portfolio_id <=> ? AND project_id <=> ? AND project_code <=> ?
		  AND milestone_id <=> ? AND work_item_id <=> ? AND parent_id <=> ?
		  AND title = ? AND doc_category <=> ? AND is_folder = ? AND oss_path <=> ?
		  AND codocs_uuid <=> ? AND document_source <=> ? AND repo_project_code <=> ?
		  AND repo_file_path <=> ? AND repo_commit_id <=> ? AND content_size = ?
		  AND created_by = ? AND updated_by = ? LIMIT 1`, args...).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, httperror.New(http.StatusConflict, "document_uuid_conflict", "Document UUID already belongs to a different creation")
		}
		if err != nil {
			return nil, err
		}
	} else {
		id, _ = result.LastInsertId()
	}

	folderPath, err := a.directDocumentFolderPath(ctx, parentID)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id":             id,
		"uuid":           docUUID,
		"title":          title,
		"isFolder":       isFolder,
		"projectId":      nullableInt64Value(owner.ProjectID),
		"projectCode":    nullableStringValue(owner.ProjectCode),
		"parentId":       nullableInt64Value(parentID),
		"folderPath":     folderPath,
		"documentSource": nullableText(documentSource),
	}, nil
}

func (a *Adapter) listDirectDocuments(ctx context.Context, query url.Values) ([]*directDocumentListItem, error) {
	currentUser := strings.TrimSpace(query.Get("current_user"))
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	where := make([]string, 0)
	args := make([]any, 0)

	appendIDFilter := func(queryKey string, column string) error {
		value := strings.TrimSpace(query.Get(queryKey))
		if value == "" {
			return nil
		}
		id, err := parseID(value, queryKey)
		if err != nil {
			return err
		}
		where = append(where, "d."+column+" = ?")
		args = append(args, id)
		return nil
	}
	for _, filter := range []struct {
		queryKey string
		column   string
	}{
		{"portfolio_id", "portfolio_id"},
		{"project_id", "project_id"},
		{"milestone_id", "milestone_id"},
		{"work_item_id", "work_item_id"},
		{"parent_id", "parent_id"},
	} {
		if err := appendIDFilter(filter.queryKey, filter.column); err != nil {
			return nil, err
		}
	}
	if value := strings.TrimSpace(query.Get("project_code")); value != "" {
		where = append(where, "d.project_code = ?")
		args = append(args, value)
	}

	visibilityWhere, visibilityArgs := projectVisibilityWhere(query, "p", currentUser)
	where = append(where, "(p.id IS NULL OR "+visibilityWhere+")")
	args = append(args, visibilityArgs...)

	whereClause := ""
	if len(where) > 0 {
		whereClause = "WHERE " + strings.Join(where, " AND ")
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT d.id, d.uuid, d.portfolio_id, d.project_id, d.project_code,
		       d.milestone_id, d.work_item_id, d.parent_id, d.title, d.doc_category,
		       d.is_folder, d.oss_path, d.codocs_uuid, d.document_source,
		       d.repo_project_code, d.repo_file_path, d.repo_commit_id,
		       d.content_size, d.sort_order,
		       d.created_by, d.updated_by,
		       DATE_FORMAT(d.created_at, '%Y-%m-%d %H:%i:%s') AS created_at,
		       DATE_FORMAT(d.updated_at, '%Y-%m-%d %H:%i:%s') AS updated_at
		FROM project_documents d
		LEFT JOIN aims_projects p ON p.id = COALESCE(
			d.project_id,
			(SELECT m.project_id FROM milestones m WHERE m.id = d.milestone_id),
			(SELECT wi.project_id FROM work_items wi WHERE wi.id = d.work_item_id),
			(SELECT p2.id FROM aims_projects p2 WHERE p2.project_code = d.project_code LIMIT 1)
		)
		`+whereClause+`
		ORDER BY d.is_folder DESC, d.sort_order ASC, d.created_at ASC
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("query direct documents: %w", err)
	}
	defer rows.Close()

	items := make([]*directDocumentListItem, 0)
	for rows.Next() {
		item, err := scanDirectDocumentListItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return buildDirectDocumentTree(items), nil
}

func scanDirectDocumentListItem(rows *sql.Rows) (*directDocumentListItem, error) {
	var item directDocumentListItem
	var portfolioID, projectID, milestoneID, workItemID, parentID sql.NullInt64
	var projectCode, docCategory, ossPath, codocsUUID, documentSource sql.NullString
	var repoProjectCode, repoFilePath, repoCommitID, updatedBy sql.NullString
	var isFolder int64
	if err := rows.Scan(
		&item.ID,
		&item.UUID,
		&portfolioID,
		&projectID,
		&projectCode,
		&milestoneID,
		&workItemID,
		&parentID,
		&item.Title,
		&docCategory,
		&isFolder,
		&ossPath,
		&codocsUUID,
		&documentSource,
		&repoProjectCode,
		&repoFilePath,
		&repoCommitID,
		&item.ContentSize,
		&item.SortOrder,
		&item.CreatedBy,
		&updatedBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("scan direct document: %w", err)
	}
	item.PortfolioID = nullableInt64Ptr(portfolioID)
	item.ProjectID = nullableInt64Ptr(projectID)
	item.ProjectCode = nullableStringPtr(projectCode)
	item.MilestoneID = nullableInt64Ptr(milestoneID)
	item.WorkItemID = nullableInt64Ptr(workItemID)
	item.ParentID = nullableInt64Ptr(parentID)
	item.DocCategory = nullableStringPtr(docCategory)
	item.IsFolder = isFolder != 0
	item.OssPath = nullableStringPtr(ossPath)
	item.CodocsUUID = nullableStringPtr(codocsUUID)
	item.DocumentSource = nullableStringPtr(documentSource)
	item.RepoProjectCode = nullableStringPtr(repoProjectCode)
	item.RepoFilePath = nullableStringPtr(repoFilePath)
	item.RepoCommitID = nullableStringPtr(repoCommitID)
	item.UpdatedBy = nullableStringPtr(updatedBy)
	return &item, nil
}

func buildDirectDocumentTree(items []*directDocumentListItem) []*directDocumentListItem {
	byID := make(map[int64]*directDocumentListItem, len(items))
	roots := make([]*directDocumentListItem, 0)
	for _, item := range items {
		item.Children = make([]*directDocumentListItem, 0)
		byID[item.ID] = item
	}
	for _, item := range items {
		if item.ParentID != nil {
			if parent, ok := byID[*item.ParentID]; ok {
				parent.Children = append(parent.Children, item)
				continue
			}
		}
		roots = append(roots, item)
	}
	return roots
}

func (a *Adapter) resolveDirectDocumentOwnerContext(ctx context.Context, body map[string]any) (directDocumentOwnerContext, *int64, error) {
	explicitOwner, explicitOwnerCount, err := explicitDirectDocumentOwnerContext(body)
	if err != nil {
		return directDocumentOwnerContext{}, nil, err
	}

	parentIDValue, hasParentID, err := optionalBodyID(body, "parent_id", "parentId")
	if err != nil {
		return directDocumentOwnerContext{}, nil, httperror.New(http.StatusBadRequest, "invalid_parent_id", "parent_id must be a positive integer")
	}
	var parentID *int64
	if hasParentID && parentIDValue > 0 {
		parentID = &parentIDValue
		parentOwner, err := a.directDocumentParentOwnerContext(ctx, parentIDValue)
		if err != nil {
			return directDocumentOwnerContext{}, nil, err
		}
		if explicitOwnerCount == 0 {
			return parentOwner, parentID, nil
		}
		resolvedExplicitOwner, err := a.resolveDirectDocumentProjectContext(ctx, explicitOwner)
		if err != nil {
			return directDocumentOwnerContext{}, nil, err
		}
		if !sameDirectDocumentOwnerContext(resolvedExplicitOwner, parentOwner) {
			return directDocumentOwnerContext{}, nil, httperror.New(http.StatusBadRequest, "document_parent_owner_mismatch", "document owner does not match parent folder")
		}
		return parentOwner, parentID, nil
	}

	if explicitOwnerCount != 1 {
		return directDocumentOwnerContext{}, nil, httperror.New(http.StatusBadRequest, "invalid_document_owner", "document must belong to exactly one owner")
	}
	owner, err := a.resolveDirectDocumentProjectContext(ctx, explicitOwner)
	if err != nil {
		return directDocumentOwnerContext{}, nil, err
	}
	return owner, parentID, nil
}

func explicitDirectDocumentOwnerContext(body map[string]any) (directDocumentOwnerContext, int, error) {
	var owner directDocumentOwnerContext
	count := 0
	for _, item := range []struct {
		keys   []string
		assign func(int64)
	}{
		{[]string{"portfolio_id", "portfolioId"}, func(id int64) { owner.PortfolioID = &id }},
		{[]string{"project_id", "projectId"}, func(id int64) { owner.ProjectID = &id }},
		{[]string{"milestone_id", "milestoneId"}, func(id int64) { owner.MilestoneID = &id }},
		{[]string{"work_item_id", "workItemId"}, func(id int64) { owner.WorkItemID = &id }},
	} {
		id, ok, err := optionalBodyID(body, item.keys...)
		if err != nil {
			return directDocumentOwnerContext{}, 0, httperror.New(http.StatusBadRequest, "invalid_document_owner", "document owner id must be a positive integer")
		}
		if ok && id > 0 {
			item.assign(id)
			count++
		}
	}
	if count > 1 {
		return directDocumentOwnerContext{}, 0, httperror.New(http.StatusBadRequest, "invalid_document_owner", "document must belong to exactly one owner")
	}
	if projectCode := strings.TrimSpace(firstBodyText(body, "project_code", "projectCode")); projectCode != "" {
		owner.ProjectCode = &projectCode
	}
	return owner, count, nil
}

func (a *Adapter) directDocumentParentOwnerContext(ctx context.Context, parentID int64) (directDocumentOwnerContext, error) {
	var isFolder int64
	var portfolioID, projectID, milestoneID, workItemID sql.NullInt64
	var projectCode sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT is_folder, portfolio_id, project_id, project_code, milestone_id, work_item_id
		FROM project_documents
		WHERE id = ?
	`, parentID).Scan(&isFolder, &portfolioID, &projectID, &projectCode, &milestoneID, &workItemID)
	if err == sql.ErrNoRows {
		return directDocumentOwnerContext{}, httperror.New(http.StatusBadRequest, "parent_document_not_found", "parent folder does not exist")
	}
	if err != nil {
		return directDocumentOwnerContext{}, err
	}
	if isFolder == 0 {
		return directDocumentOwnerContext{}, httperror.New(http.StatusBadRequest, "parent_document_not_folder", "parent document must be a folder")
	}
	return directDocumentOwnerContext{
		PortfolioID: nullableInt64Ptr(portfolioID),
		ProjectID:   nullableInt64Ptr(projectID),
		ProjectCode: nullableStringPtr(projectCode),
		MilestoneID: nullableInt64Ptr(milestoneID),
		WorkItemID:  nullableInt64Ptr(workItemID),
	}, nil
}

func (a *Adapter) resolveDirectDocumentProjectContext(ctx context.Context, owner directDocumentOwnerContext) (directDocumentOwnerContext, error) {
	switch {
	case owner.WorkItemID != nil:
		projectID, projectCode, err := a.directDocumentProjectFromWorkItem(ctx, *owner.WorkItemID)
		if err != nil {
			return directDocumentOwnerContext{}, err
		}
		owner.ProjectID = &projectID
		owner.ProjectCode = &projectCode
	case owner.MilestoneID != nil:
		projectID, projectCode, err := a.directDocumentProjectFromMilestone(ctx, *owner.MilestoneID)
		if err != nil {
			return directDocumentOwnerContext{}, err
		}
		owner.ProjectID = &projectID
		owner.ProjectCode = &projectCode
	case owner.ProjectID != nil:
		projectID, projectCode, err := a.directDocumentProjectFromProject(ctx, *owner.ProjectID)
		if err != nil {
			return directDocumentOwnerContext{}, err
		}
		owner.ProjectID = &projectID
		owner.ProjectCode = &projectCode
	case owner.PortfolioID != nil:
		projectCode, err := a.directDocumentProjectCodeFromPortfolio(ctx, *owner.PortfolioID)
		if err != nil {
			return directDocumentOwnerContext{}, err
		}
		owner.ProjectCode = &projectCode
	default:
		return directDocumentOwnerContext{}, httperror.New(http.StatusBadRequest, "invalid_document_owner", "document must belong to exactly one owner")
	}
	return owner, nil
}

func (a *Adapter) directDocumentProjectFromWorkItem(ctx context.Context, workItemID int64) (int64, string, error) {
	var projectID int64
	var projectCode sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT wi.project_id, p.project_code
		FROM work_items wi
		JOIN aims_projects p ON p.id = wi.project_id
		WHERE wi.id = ?
	`, workItemID).Scan(&projectID, &projectCode)
	if err == sql.ErrNoRows {
		return 0, "", httperror.New(http.StatusBadRequest, "work_item_not_found", "work item does not exist")
	}
	if err != nil {
		return 0, "", err
	}
	return projectID, strings.TrimSpace(projectCode.String), nil
}

func (a *Adapter) directDocumentProjectFromMilestone(ctx context.Context, milestoneID int64) (int64, string, error) {
	var projectID int64
	var projectCode sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT m.project_id, p.project_code
		FROM milestones m
		JOIN aims_projects p ON p.id = m.project_id
		WHERE m.id = ?
	`, milestoneID).Scan(&projectID, &projectCode)
	if err == sql.ErrNoRows {
		return 0, "", httperror.New(http.StatusBadRequest, "milestone_not_found", "milestone does not exist")
	}
	if err != nil {
		return 0, "", err
	}
	return projectID, strings.TrimSpace(projectCode.String), nil
}

func (a *Adapter) directDocumentProjectFromProject(ctx context.Context, rawProjectID int64) (int64, string, error) {
	var projectID int64
	var projectCode sql.NullString
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, project_code
		FROM aims_projects
		WHERE id = ?
	`, rawProjectID).Scan(&projectID, &projectCode)
	if err == sql.ErrNoRows {
		return 0, "", httperror.New(http.StatusBadRequest, "project_not_found", "project does not exist")
	}
	if err != nil {
		return 0, "", err
	}
	return projectID, strings.TrimSpace(projectCode.String), nil
}

func (a *Adapter) directDocumentProjectCodeFromPortfolio(ctx context.Context, portfolioID int64) (string, error) {
	var code string
	err := a.DB().QueryRowContext(ctx, `
		SELECT code
		FROM project_portfolios
		WHERE id = ?
	`, portfolioID).Scan(&code)
	if err == sql.ErrNoRows {
		return "", httperror.New(http.StatusBadRequest, "portfolio_not_found", "portfolio does not exist")
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(code), nil
}

func sameDirectDocumentOwnerContext(left directDocumentOwnerContext, right directDocumentOwnerContext) bool {
	return sameNullableInt64(left.PortfolioID, right.PortfolioID) &&
		sameNullableInt64(left.ProjectID, right.ProjectID) &&
		sameNullableInt64(left.MilestoneID, right.MilestoneID) &&
		sameNullableInt64(left.WorkItemID, right.WorkItemID)
}

func sameNullableInt64(left *int64, right *int64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func normalizeDocumentSource(body map[string]any) string {
	source := strings.ToLower(firstBodyText(body, "document_source", "documentSource", "source"))
	if source == "" {
		if firstBodyText(body, "repo_project_code", "repoProjectCode", "repo_file_path", "repoFilePath", "oss_path", "ossPath") != "" {
			source = "repo"
		} else if firstBodyText(body, "codocs_uuid", "codocsUuid") != "" {
			source = "codocs"
		}
	}
	switch source {
	case "repo", "codocs":
		return source
	default:
		return ""
	}
}

func (a *Adapter) directDocumentFolderPath(ctx context.Context, parentID *int64) (string, error) {
	if parentID == nil || *parentID <= 0 {
		return "", nil
	}
	parts := make([]string, 0)
	currentID := *parentID
	for currentID > 0 {
		var title string
		var nextParent sql.NullInt64
		err := a.DB().QueryRowContext(ctx, `
			SELECT title, parent_id
			FROM project_documents
			WHERE id = ? AND is_folder = 1
		`, currentID).Scan(&title, &nextParent)
		if err == sql.ErrNoRows {
			break
		}
		if err != nil {
			return "", err
		}
		parts = append([]string{title}, parts...)
		if !nextParent.Valid || nextParent.Int64 <= 0 {
			break
		}
		currentID = nextParent.Int64
	}
	return strings.Join(parts, "/"), nil
}

func nullableInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func nullableStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func (a *Adapter) listProjectDocuments(ctx context.Context, projectIDText string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectReadAccess(ctx, projectIDText, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	where := []string{"project_id = ?", "work_item_id IS NULL", "is_folder = 0"}
	args := []any{projectID}
	if category := strings.TrimSpace(firstNonEmptyProjectDocumentParam(query, "doc_category", "docCategory")); category != "" {
		where = append(where, "doc_category = ?")
		args = append(args, category)
	}

	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, uuid, title, doc_category, codocs_uuid,
		       document_source, repo_project_code, repo_file_path, repo_commit_id,
		       created_by, DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at
		FROM project_documents
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY created_at ASC, id ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items, err := aimsRowsToMaps(rows)
	if err != nil {
		return nil, err
	}

	documents := make([]map[string]any, 0, len(items))
	var proposal map[string]any
	for _, item := range items {
		document := mapProjectDocumentResponse(item)
		documents = append(documents, document)
		if projectDocumentText(item["doc_category"]) == "project_proposal" && proposal == nil {
			proposal = document
		}
	}

	return map[string]any{
		"items":     items,
		"total":     len(items),
		"page":      1,
		"pageSize":  len(items),
		"documents": documents,
		"proposal":  proposal,
	}, nil
}

func (a *Adapter) createProjectDocumentBinding(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	currentUser := currentUserFrom(query, body)
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	project, err := a.projectDocumentProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if project.CreatedBy != currentUser && project.LeaderUID.String != currentUser {
		if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(projectIDText)+"/documents", query, body, projectIDText); err != nil {
			if isHTTPStatus(err, http.StatusForbidden) {
				return nil, httperror.New(http.StatusForbidden, "project_document_forbidden", "无权为该项目绑定文档")
			}
			return nil, err
		}
	}

	binding, err := resolveProjectDocumentBinding(body)
	if err != nil {
		return nil, err
	}

	if err := a.ensureProjectDocumentNotDuplicated(ctx, projectID, binding); err != nil {
		return nil, err
	}

	docUUID, err := aimsRandomUUID()
	if err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, project_id, project_code, parent_id, title, doc_category, is_folder,
		   codocs_uuid, document_source, repo_project_code, repo_file_path, repo_commit_id,
		   content_size, created_by, updated_by)
		VALUES (?, ?, ?, NULL, ?, 'project_proposal', 0, ?, ?, ?, ?, ?, ?, ?, ?)
	`, docUUID, projectID, project.ProjectCode, binding.Title, nullableSQLString(binding.CodocsUUID), binding.Source, nullableSQLString(binding.RepoProjectCode), nullableSQLString(binding.RepoFilePath), nullableSQLString(binding.RepoCommitID), binding.ContentSize, currentUser, currentUser)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()

	return map[string]any{
		"id":              id,
		"projectId":       projectID,
		"source":          binding.Source,
		"title":           binding.Title,
		"codocsUuid":      nullableSQLString(binding.CodocsUUID),
		"repoProjectCode": nullableSQLString(binding.RepoProjectCode),
		"repoFilePath":    nullableSQLString(binding.RepoFilePath),
		"repoCommitId":    nullableSQLString(binding.RepoCommitID),
	}, nil
}

func (a *Adapter) replaceProjectDocumentBinding(ctx context.Context, projectIDText string, query url.Values, body map[string]any) (map[string]any, error) {
	currentUser := currentUserFrom(query, body)
	if currentUser == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	project, err := a.projectDocumentProject(ctx, projectID)
	if err != nil {
		return nil, err
	}
	if project.CreatedBy != currentUser && project.LeaderUID.String != currentUser {
		if err := a.requireProjectUpdateAccess(ctx, "/v1/aims/projects/"+strings.TrimSpace(projectIDText)+"/documents", query, body, projectIDText); err != nil {
			if isHTTPStatus(err, http.StatusForbidden) {
				return nil, httperror.New(http.StatusForbidden, "project_document_forbidden", "无权变更立项书")
			}
			return nil, err
		}
	}

	binding, err := resolveProjectDocumentBinding(body)
	if err != nil {
		return nil, err
	}
	docUUID, err := aimsRandomUUID()
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM project_documents
		WHERE project_id = ? AND work_item_id IS NULL AND doc_category = 'project_proposal'
	`, projectID); err != nil {
		return nil, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO project_documents
		  (uuid, project_id, project_code, parent_id, title, doc_category, is_folder,
		   codocs_uuid, document_source, repo_project_code, repo_file_path, repo_commit_id,
		   content_size, created_by, updated_by)
		VALUES (?, ?, ?, NULL, ?, 'project_proposal', 0, ?, ?, ?, ?, ?, ?, ?, ?)
	`, docUUID, projectID, project.ProjectCode, binding.Title, nullableSQLString(binding.CodocsUUID), binding.Source, nullableSQLString(binding.RepoProjectCode), nullableSQLString(binding.RepoFilePath), nullableSQLString(binding.RepoCommitID), binding.ContentSize, currentUser, currentUser)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()

	return map[string]any{
		"id":              id,
		"projectId":       projectID,
		"source":          binding.Source,
		"title":           binding.Title,
		"codocsUuid":      nullableSQLString(binding.CodocsUUID),
		"repoProjectCode": nullableSQLString(binding.RepoProjectCode),
		"repoFilePath":    nullableSQLString(binding.RepoFilePath),
		"repoCommitId":    nullableSQLString(binding.RepoCommitID),
	}, nil
}

func (a *Adapter) projectCodocsDocumentsContext(ctx context.Context, projectIDText string, query url.Values) (map[string]any, error) {
	if strings.TrimSpace(query.Get("current_user")) == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := a.requireProjectReadAccess(ctx, projectIDText, query); err != nil {
		return nil, err
	}
	projectID, err := parseID(projectIDText, "project_id")
	if err != nil {
		return nil, err
	}

	var gitGroup sql.NullString
	err = a.DB().QueryRowContext(ctx, `
		SELECT pf.git_group
		FROM aims_projects p
		LEFT JOIN project_portfolios pf ON pf.id = p.portfolio_id
		WHERE p.id = ?
	`, projectID).Scan(&gitGroup)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return nil, err
	}

	return map[string]any{"gitGroup": nullableSQLString(gitGroup)}, nil
}

func (a *Adapter) projectDocumentProject(ctx context.Context, projectID int64) (projectDocumentProject, error) {
	var project projectDocumentProject
	err := a.DB().QueryRowContext(ctx, `
		SELECT id, project_code, dept_code, leader_uid, created_by
		FROM aims_projects
		WHERE id = ?
	`, projectID).Scan(&project.ID, &project.ProjectCode, &project.DeptCode, &project.LeaderUID, &project.CreatedBy)
	if err == sql.ErrNoRows {
		return projectDocumentProject{}, httperror.New(http.StatusNotFound, "project_not_found", "项目不存在")
	}
	if err != nil {
		return projectDocumentProject{}, err
	}
	return project, nil
}

func resolveProjectDocumentBinding(body map[string]any) (projectDocumentBinding, error) {
	source := strings.ToLower(firstBodyText(body, "source", "document_source"))
	if source != "repo" {
		source = "codocs"
	}

	title := firstBodyText(body, "title")
	contentSize := int64BodyValue(body, "contentSize", "content_size")

	if source == "codocs" {
		codocsUUID := firstBodyText(body, "codocsUuid", "codocs_uuid", "documentId", "document_id")
		if codocsUUID == "" {
			return projectDocumentBinding{}, httperror.New(http.StatusBadRequest, "missing_codocs_uuid", "codocs 源需要 codocsUuid")
		}
		if title == "" {
			title = codocsUUID
		}
		return projectDocumentBinding{
			Source:      "codocs",
			Title:       title,
			ContentSize: contentSize,
			CodocsUUID:  validSQLString(codocsUUID),
		}, nil
	}

	repoProjectCode := firstBodyText(body, "repoProjectCode", "repo_project_code")
	repoFilePath := firstBodyText(body, "repoFilePath", "repo_file_path")
	if repoProjectCode == "" || repoFilePath == "" {
		return projectDocumentBinding{}, httperror.New(http.StatusBadRequest, "missing_repo_document", "repo 源需要 repoProjectCode 和 repoFilePath")
	}
	if title == "" {
		title = repoFilePath
		if index := strings.LastIndex(title, "/"); index >= 0 && index+1 < len(title) {
			title = title[index+1:]
		}
	}
	return projectDocumentBinding{
		Source:          "repo",
		Title:           title,
		ContentSize:     contentSize,
		RepoProjectCode: validSQLString(repoProjectCode),
		RepoFilePath:    validSQLString(repoFilePath),
		RepoCommitID:    validSQLString(firstBodyText(body, "repoCommitId", "repo_commit_id")),
	}, nil
}

func (a *Adapter) ensureProjectDocumentNotDuplicated(ctx context.Context, projectID int64, binding projectDocumentBinding) error {
	var id int64
	var err error
	if binding.Source == "codocs" {
		err = a.DB().QueryRowContext(ctx, `
			SELECT id FROM project_documents
			WHERE project_id = ?
			  AND work_item_id IS NULL
			  AND is_folder = 0
			  AND document_source = 'codocs'
			  AND (codocs_uuid = ? OR uuid = ?)
			LIMIT 1
		`, projectID, binding.CodocsUUID.String, binding.CodocsUUID.String).Scan(&id)
	} else {
		err = a.DB().QueryRowContext(ctx, `
			SELECT id FROM project_documents
			WHERE project_id = ?
			  AND work_item_id IS NULL
			  AND is_folder = 0
			  AND document_source = 'repo'
			  AND repo_project_code = ?
			  AND repo_file_path = ?
			LIMIT 1
		`, projectID, binding.RepoProjectCode.String, binding.RepoFilePath.String).Scan(&id)
	}
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return httperror.New(http.StatusConflict, "project_document_duplicated", "该文档已关联到项目")
}

func int64BodyValue(body map[string]any, keys ...string) int64 {
	for _, key := range keys {
		value, ok := body[key]
		if !ok || value == nil {
			continue
		}
		var result int64
		if _, err := fmt.Sscan(fmt.Sprint(value), &result); err == nil && result > 0 {
			return result
		}
	}
	return 0
}

func mapProjectDocumentResponse(item map[string]any) map[string]any {
	source := projectDocumentText(item["document_source"])
	if source == "" {
		source = "codocs"
	}
	return map[string]any{
		"id":              item["id"],
		"uuid":            item["uuid"],
		"title":           item["title"],
		"docCategory":     item["doc_category"],
		"codocsUuid":      item["codocs_uuid"],
		"documentSource":  source,
		"repoProjectCode": item["repo_project_code"],
		"repoFilePath":    item["repo_file_path"],
		"repoCommitId":    item["repo_commit_id"],
		"createdBy":       item["created_by"],
		"createdAt":       item["created_at"],
	}
}

func projectDocumentText(value any) string {
	if value == nil {
		return ""
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "<nil>" {
		return ""
	}
	return text
}

func firstNonEmptyProjectDocumentParam(query url.Values, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(query.Get(key)); value != "" {
			return value
		}
	}
	return ""
}

func validSQLString(value string) sql.NullString {
	value = strings.TrimSpace(value)
	return sql.NullString{String: value, Valid: value != ""}
}

func nullableSQLString(value sql.NullString) any {
	if value.Valid {
		return value.String
	}
	return nil
}
