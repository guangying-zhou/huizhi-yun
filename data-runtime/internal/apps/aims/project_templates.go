package aims

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type projectTemplateDefinition struct {
	Milestones []projectTemplateMilestone `json:"milestones"`
}

type projectTemplateMilestone struct {
	Key         string  `json:"key"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	Mode        string  `json:"mode"`
	PivrStage   string  `json:"pivrStage"`
	SortOrder   int     `json:"sortOrder"`
	// RecurrenceRule 仅在 Mode=periodic 时有意义，缺失会导致周期里程碑无法滚动。
	RecurrenceRule string                    `json:"recurrenceRule,omitempty"`
	WorkItems      []projectTemplateWorkItem `json:"workItems"`
}

type projectTemplateWorkItem struct {
	Key          string                       `json:"key"`
	Title        string                       `json:"title"`
	Type         string                       `json:"type"`
	Tier         string                       `json:"tier"`
	Description  *string                      `json:"description"`
	Required     bool                         `json:"required"`
	ReviewLevel  int                          `json:"reviewLevel"`
	Priority     string                       `json:"priority"`
	SortOrder    int                          `json:"sortOrder"`
	Deliverables []projectTemplateDeliverable `json:"deliverables"`
}

type projectTemplateDeliverable struct {
	Key                string  `json:"key"`
	Name               string  `json:"name"`
	Description        *string `json:"description"`
	AcceptanceCriteria string  `json:"acceptanceCriteria"`
	DeliverableType    string  `json:"deliverableType"`
	Required           bool    `json:"required"`
	SortOrder          int     `json:"sortOrder"`
}

type resolvedProjectTemplateVersion struct {
	TemplateSetID     int64
	TemplateVersionID int64
	Definition        projectTemplateDefinition
}

type defaultProjectMilestoneSeed struct {
	Key       string
	Name      string
	Mode      string
	PivrStage string
	SortOrder int
	// RecurrenceRule 仅 Mode=periodic 使用，如 monthly / quarterly。
	RecurrenceRule string
}

type opportunityTemplateDeliverableSeed struct {
	Stage, Key, Name, AcceptanceCriteria string
	Required                             bool
}

type projectTemplateVersionDetail struct {
	ID              int64                      `json:"id"`
	TemplateSetID   int64                      `json:"templateSetId"`
	TemplateSetCode string                     `json:"templateSetCode"`
	TemplateSetName string                     `json:"templateSetName"`
	Category        string                     `json:"category"`
	VersionNo       int64                      `json:"versionNo"`
	VersionLabel    string                     `json:"versionLabel"`
	Status          string                     `json:"status"`
	UsageCount      int64                      `json:"usageCount"`
	IsSystem        bool                       `json:"isSystem"`
	Notes           *string                    `json:"notes"`
	PublishedAt     *string                    `json:"publishedAt"`
	ArchivedAt      *string                    `json:"archivedAt"`
	CreatedBy       string                     `json:"createdBy"`
	CreatedAt       string                     `json:"createdAt"`
	UpdatedAt       string                     `json:"updatedAt"`
	Definition      *projectTemplateDefinition `json:"definition,omitempty"`
}

var projectTemplateCategories = []string{
	"product_dev",
	"custom_dev",
	"delivery",
	"maintenance",
	"sales",
	"presales",
	"improvement",
	"routine",
	"compliance",
}

func (a *Adapter) handleProjectTemplateVersionRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if path == "/v1/aims/project-template-versions" {
		switch method {
		case http.MethodGet:
			data, err := a.listProjectTemplateVersions(ctx, query)
			return data, "aims.project_template_versions.list", true, err
		case http.MethodPost:
			data, err := a.createProjectTemplateVersionDraft(ctx, query, body)
			return data, "aims.project_template_versions.create", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "project template version runtime method is not supported")
		}
	}

	if rawID, ok := pathParam(path, "/v1/aims/project-template-versions/", "/transition"); ok {
		if method != http.MethodPost {
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "project template version transition method is not supported")
		}
		data, err := a.transitionProjectTemplateVersion(ctx, rawID, query, body)
		return data, "aims.project_template_versions.transition", true, err
	}

	rawID, ok := directPathParam(path, "/v1/aims/project-template-versions/")
	if !ok {
		return nil, "", false, nil
	}
	switch method {
	case http.MethodGet:
		data, err := a.projectTemplateVersionDetail(ctx, rawID, query)
		return data, "aims.project_template_versions.get", true, err
	case http.MethodPut, http.MethodPatch:
		data, err := a.updateProjectTemplateVersion(ctx, rawID, query, body)
		return data, "aims.project_template_versions.update", true, err
	default:
		return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "project template version runtime method is not supported")
	}
}

func (a *Adapter) listProjectTemplateVersions(ctx context.Context, query url.Values) ([]projectTemplateVersionDetail, error) {
	category := strings.TrimSpace(query.Get("category"))
	status := strings.TrimSpace(query.Get("status"))
	if err := a.ensureDefaultProjectTemplateVersionsSeeded(ctx, category); err != nil {
		return nil, err
	}

	conditions := []string{"1 = 1"}
	args := []any{}
	if category != "" {
		conditions = append(conditions, "s.category = ?")
		args = append(args, category)
	}
	if status != "" {
		conditions = append(conditions, "v.status = ?")
		args = append(args, status)
	}

	rows, err := a.DB().QueryContext(ctx, projectTemplateVersionSelectSQL(`
		WHERE `+strings.Join(conditions, " AND ")+`
		GROUP BY v.id
		ORDER BY s.category ASC, s.is_system DESC, v.version_no DESC, v.updated_at DESC
	`), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]projectTemplateVersionDetail, 0)
	for rows.Next() {
		item, err := scanProjectTemplateVersion(rows, false)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (a *Adapter) projectTemplateVersionDetail(ctx context.Context, rawID string, query url.Values) (*projectTemplateVersionDetail, error) {
	id, err := parseID(rawID, "project_template_version_id")
	if err != nil {
		return nil, err
	}
	detail, err := a.projectTemplateVersionByID(ctx, id)
	if err != nil && isRecordNotFound(err) && strings.TrimSpace(query.Get("optional")) == "1" {
		return nil, nil
	}
	return detail, err
}

func (a *Adapter) projectTemplateVersionByID(ctx context.Context, id int64) (*projectTemplateVersionDetail, error) {
	row := a.DB().QueryRowContext(ctx, projectTemplateVersionSelectSQL("WHERE v.id = ? GROUP BY v.id"), id)
	detail, err := scanProjectTemplateVersion(row, true)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "project_template_version_not_found", "模板版本不存在")
		}
		return nil, err
	}
	return &detail, nil
}

func (a *Adapter) createProjectTemplateVersionDraft(ctx context.Context, query url.Values, body map[string]any) (*projectTemplateVersionDetail, error) {
	uid, err := requireProjectTemplateAdminActor(query, body)
	if err != nil {
		return nil, err
	}
	category := strings.TrimSpace(firstBodyText(body, "category"))
	if category == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_category", "模板分类不能为空")
	}
	if err := a.ensureDefaultProjectTemplateVersionsSeeded(ctx, category); err != nil {
		return nil, err
	}

	templateSetID, _, err := optionalBodyID(body, "templateSetId", "template_set_id")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_template_set_id", "templateSetId must be a positive integer")
	}
	cloneFromVersionID, _, err := optionalBodyID(body, "cloneFromVersionId", "clone_from_version_id")
	if err != nil {
		return nil, httperror.New(http.StatusBadRequest, "invalid_clone_from_version_id", "cloneFromVersionId must be a positive integer")
	}

	if templateSetID == 0 && cloneFromVersionID > 0 {
		source, err := a.projectTemplateVersionByID(ctx, cloneFromVersionID)
		if err != nil {
			return nil, err
		}
		templateSetID = source.TemplateSetID
	}

	if templateSetID == 0 {
		result, err := a.DB().ExecContext(ctx, `
			INSERT INTO project_template_sets
			  (code, name, category, description, is_system, created_by)
			VALUES (?, ?, ?, ?, 0, ?)
		`,
			firstNonEmptyText(firstBodyText(body, "templateSetCode", "template_set_code"), fmt.Sprintf("%s-%d", category, nowMillis())),
			firstNonEmptyText(firstBodyText(body, "templateSetName", "template_set_name"), category+" 自定义模板"),
			category,
			nullableText(firstBodyText(body, "templateSetDescription", "template_set_description")),
			uid,
		)
		if err != nil {
			return nil, err
		}
		templateSetID, err = result.LastInsertId()
		if err != nil {
			return nil, err
		}
	}

	nextVersionNo, err := a.nextProjectTemplateVersionNo(ctx, templateSetID)
	if err != nil {
		return nil, err
	}
	definition := defaultProjectTemplateDefinition(category)
	if cloneFromVersionID > 0 {
		source, err := a.projectTemplateVersionByID(ctx, cloneFromVersionID)
		if err != nil {
			return nil, err
		}
		if source.Definition != nil {
			definition = *source.Definition
		}
	}
	definitionJSON, err := json.Marshal(definition)
	if err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO project_template_versions
		  (template_set_id, version_no, version_label, status, notes, definition_json, created_by)
		VALUES (?, ?, ?, 'draft', ?, ?, ?)
	`, templateSetID, nextVersionNo, fmt.Sprintf("v%d", nextVersionNo), nullableText(cloneNote(cloneFromVersionID)), string(definitionJSON), uid)
	if err != nil {
		return nil, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return nil, err
	}
	return a.projectTemplateVersionByID(ctx, id)
}

func (a *Adapter) updateProjectTemplateVersion(ctx context.Context, rawID string, query url.Values, body map[string]any) (*projectTemplateVersionDetail, error) {
	if _, err := requireProjectTemplateAdminActor(query, body); err != nil {
		return nil, err
	}
	id, err := parseID(rawID, "project_template_version_id")
	if err != nil {
		return nil, err
	}
	current, err := a.projectTemplateVersionByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if current.Status != "draft" {
		return nil, httperror.New(http.StatusBadRequest, "project_template_not_draft", "只有草稿版本允许编辑")
	}

	definition := current.Definition
	if rawDefinition, ok := body["definition"]; ok {
		parsed, err := parseProjectTemplateDefinition(rawDefinition)
		if err != nil {
			return nil, err
		}
		definition = &parsed
	}
	definitionJSON, err := json.Marshal(definition)
	if err != nil {
		return nil, err
	}

	versionLabel := firstNonEmptyText(firstBodyText(body, "versionLabel", "version_label"), current.VersionLabel)
	notes := current.Notes
	if _, ok := body["notes"]; ok {
		notes = nullableTrimmedString(firstBodyText(body, "notes"))
	}
	if _, err := a.DB().ExecContext(ctx, `
		UPDATE project_template_versions
		SET version_label = ?, notes = ?, definition_json = ?
		WHERE id = ?
	`, versionLabel, nullableTemplateStringValue(notes), string(definitionJSON), id); err != nil {
		return nil, err
	}
	return a.projectTemplateVersionByID(ctx, id)
}

func (a *Adapter) transitionProjectTemplateVersion(ctx context.Context, rawID string, query url.Values, body map[string]any) (*projectTemplateVersionDetail, error) {
	uid, err := requireProjectTemplateAdminActor(query, body)
	if err != nil {
		return nil, err
	}
	id, err := parseID(rawID, "project_template_version_id")
	if err != nil {
		return nil, err
	}
	action := strings.TrimSpace(firstBodyText(body, "action"))
	if action != "publish" && action != "archive" && action != "revert_to_draft" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_project_template_transition", "无效的模板版本流转动作")
	}
	current, err := a.projectTemplateVersionByID(ctx, id)
	if err != nil {
		return nil, err
	}
	usageCount, err := a.projectTemplateUsageCount(ctx, id)
	if err != nil {
		return nil, err
	}

	switch action {
	case "publish":
		if current.Status != "draft" {
			return nil, httperror.New(http.StatusBadRequest, "project_template_not_draft", "只有草稿版本可以发布")
		}
		_, err = a.DB().ExecContext(ctx, `
			UPDATE project_template_versions
			SET status = 'published', published_at = CURRENT_TIMESTAMP, published_by = ?
			WHERE id = ?
		`, uid, id)
	case "archive":
		if current.Status != "published" {
			return nil, httperror.New(http.StatusBadRequest, "project_template_not_published", "只有已发布版本可以归档")
		}
		_, err = a.DB().ExecContext(ctx, `
			UPDATE project_template_versions
			SET status = 'archived', archived_at = CURRENT_TIMESTAMP, archived_by = ?
			WHERE id = ?
		`, uid, id)
	case "revert_to_draft":
		if usageCount > 0 {
			return nil, httperror.New(http.StatusBadRequest, "project_template_in_use", "已用于项目的版本不能回退为草稿，请改为克隆新版本")
		}
		if current.Status != "published" && current.Status != "archived" {
			return nil, httperror.New(http.StatusBadRequest, "project_template_transition_not_supported", "当前状态不支持回退为草稿")
		}
		_, err = a.DB().ExecContext(ctx, `
			UPDATE project_template_versions
			SET status = 'draft', published_at = NULL, published_by = NULL, archived_at = NULL, archived_by = NULL
			WHERE id = ?
		`, id)
	}
	if err != nil {
		return nil, err
	}
	return a.projectTemplateVersionByID(ctx, id)
}

func projectTemplateVersionSelectSQL(tail string) string {
	return `
		SELECT
			v.id,
			v.template_set_id,
			s.code AS template_set_code,
			s.name AS template_set_name,
			s.category,
			v.version_no,
			v.version_label,
			v.status,
			v.notes,
			v.definition_json,
			v.published_at,
			v.archived_at,
			v.published_by,
			v.archived_by,
			v.created_by,
			v.created_at,
			v.updated_at,
			s.is_system,
			(SELECT COUNT(*) FROM aims_projects p WHERE p.template_version_id = v.id) AS usage_count
		FROM project_template_versions v
		JOIN project_template_sets s ON s.id = v.template_set_id
		` + tail
}

type projectTemplateVersionScanner interface {
	Scan(dest ...any) error
}

func scanProjectTemplateVersion(scanner projectTemplateVersionScanner, includeDefinition bool) (projectTemplateVersionDetail, error) {
	var (
		item          projectTemplateVersionDetail
		notes         sql.NullString
		publishedAt   any
		archivedAt    any
		publishedBy   sql.NullString
		archivedBy    sql.NullString
		createdAt     any
		updatedAt     any
		isSystem      int64
		definitionRaw any
	)
	if err := scanner.Scan(
		&item.ID,
		&item.TemplateSetID,
		&item.TemplateSetCode,
		&item.TemplateSetName,
		&item.Category,
		&item.VersionNo,
		&item.VersionLabel,
		&item.Status,
		&notes,
		&definitionRaw,
		&publishedAt,
		&archivedAt,
		&publishedBy,
		&archivedBy,
		&item.CreatedBy,
		&createdAt,
		&updatedAt,
		&isSystem,
		&item.UsageCount,
	); err != nil {
		return projectTemplateVersionDetail{}, err
	}
	item.Notes = nullableStringFromSQL(notes)
	item.PublishedAt = nullableStringFromAny(publishedAt)
	item.ArchivedAt = nullableStringFromAny(archivedAt)
	item.CreatedAt = stringFromSQLValue(createdAt)
	item.UpdatedAt = stringFromSQLValue(updatedAt)
	item.IsSystem = isSystem != 0
	_ = publishedBy
	_ = archivedBy

	if includeDefinition {
		definition, err := parseProjectTemplateDefinition(definitionRaw)
		if err != nil {
			return projectTemplateVersionDetail{}, err
		}
		item.Definition = &definition
	}
	return item, nil
}

func (a *Adapter) ensureDefaultProjectTemplateVersionsSeeded(ctx context.Context, category string) error {
	categories := projectTemplateCategories
	if strings.TrimSpace(category) != "" {
		categories = []string{strings.TrimSpace(category)}
	}
	for _, currentCategory := range categories {
		if err := a.ensureDefaultProjectTemplateVersionSeeded(ctx, currentCategory); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) ensureDefaultProjectTemplateVersionSeeded(ctx context.Context, category string) error {
	var (
		templateSetID int64
		isSystem      int64
	)
	if err := a.DB().QueryRowContext(ctx, `
		SELECT id, is_system
		FROM project_template_sets
		WHERE category = ?
		LIMIT 1
	`, category).Scan(&templateSetID, &isSystem); err != nil {
		if err != sql.ErrNoRows {
			return err
		}
		definitionJSON, marshalErr := json.Marshal(defaultProjectTemplateDefinition(category))
		if marshalErr != nil {
			return marshalErr
		}
		result, execErr := a.DB().ExecContext(ctx, `
			INSERT INTO project_template_sets
			  (code, name, category, description, is_system, created_by)
			VALUES (?, ?, ?, '系统初始化模板集', 1, 'system')
		`, "system-"+category, category+" 默认模板", category)
		if execErr != nil {
			return execErr
		}
		templateSetID, execErr = result.LastInsertId()
		if execErr != nil {
			return execErr
		}
		_, execErr = a.DB().ExecContext(ctx, `
			INSERT INTO project_template_versions
			  (template_set_id, version_no, version_label, status, notes, definition_json, published_at, published_by, created_by)
			VALUES (?, 1, 'v1', 'published', '系统初始化版本', ?, CURRENT_TIMESTAMP, 'system', 'system')
		`, templateSetID, string(definitionJSON))
		return execErr
	}

	if isSystem != 0 {
		return a.syncSystemProjectTemplateDefinition(ctx, templateSetID, category)
	}
	return nil
}

func (a *Adapter) syncSystemProjectTemplateDefinition(ctx context.Context, templateSetID int64, category string) error {
	if category != "product_dev" && category != "custom_dev" {
		return nil
	}
	var (
		id            int64
		definitionRaw any
	)
	if err := a.DB().QueryRowContext(ctx, `
		SELECT id, definition_json
		FROM project_template_versions
		WHERE template_set_id = ? AND status = 'published'
		ORDER BY version_no DESC
		LIMIT 1
	`, templateSetID).Scan(&id, &definitionRaw); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return err
	}
	definition, err := parseProjectTemplateDefinition(definitionRaw)
	if err != nil {
		return err
	}
	if !ensureRequirementBaseline(&definition, category) {
		return nil
	}
	updated, err := json.Marshal(definition)
	if err != nil {
		return err
	}
	_, err = a.DB().ExecContext(ctx, "UPDATE project_template_versions SET definition_json = ? WHERE id = ?", string(updated), id)
	return err
}

func (a *Adapter) nextProjectTemplateVersionNo(ctx context.Context, templateSetID int64) (int64, error) {
	var maxVersionNo sql.NullInt64
	if err := a.DB().QueryRowContext(ctx, "SELECT IFNULL(MAX(version_no), 0) FROM project_template_versions WHERE template_set_id = ?", templateSetID).Scan(&maxVersionNo); err != nil {
		return 0, err
	}
	return maxVersionNo.Int64 + 1, nil
}

func (a *Adapter) projectTemplateUsageCount(ctx context.Context, id int64) (int64, error) {
	var usageCount int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) AS usage_count FROM aims_projects WHERE template_version_id = ?", id).Scan(&usageCount); err != nil {
		return 0, err
	}
	return usageCount, nil
}

func requireProjectTemplateAdminActor(query url.Values, body map[string]any) (string, error) {
	uid := currentUserFrom(query, body)
	if uid == "" {
		return "", httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if !hasProjectAdminFlag(query) {
		return "", httperror.New(http.StatusForbidden, "project_template_admin_required", "仅 AIMS 模板管理员可以维护项目模板")
	}
	return uid, nil
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

func cloneNote(id int64) string {
	if id <= 0 {
		return ""
	}
	return fmt.Sprintf("基于版本 #%d 克隆", id)
}

func nullableTrimmedString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func nullableTemplateStringValue(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableStringFromSQL(value sql.NullString) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	text := strings.TrimSpace(value.String)
	return &text
}

func nullableStringFromAny(value any) *string {
	text := stringFromSQLValue(value)
	if text == "" || text == "<nil>" {
		return nil
	}
	return &text
}

func stringFromSQLValue(value any) string {
	normalized := normalizeAimsSQLValue(value)
	if normalized == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(normalized))
}

func resolveProjectTemplateVersionTx(ctx context.Context, tx *sql.Tx, category string, requestedVersionID int64) (resolvedProjectTemplateVersion, error) {
	if requestedVersionID > 0 {
		return projectTemplateVersionByIDTx(ctx, tx, requestedVersionID, category)
	}

	var id int64
	if err := tx.QueryRowContext(ctx, `
		SELECT v.id
		FROM project_template_versions v
		JOIN project_template_sets s ON s.id = v.template_set_id
		WHERE s.category = ? AND v.status = 'published'
		ORDER BY s.is_system DESC, v.version_no DESC, v.updated_at DESC
		LIMIT 1
	`, category).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return createDefaultProjectTemplateVersionTx(ctx, tx, category)
		}
		return resolvedProjectTemplateVersion{}, err
	}

	return projectTemplateVersionByIDTx(ctx, tx, id, category)
}

func projectTemplateVersionByIDTx(ctx context.Context, tx *sql.Tx, id int64, category string) (resolvedProjectTemplateVersion, error) {
	var (
		templateSetID int64
		status        string
		rowCategory   string
		definitionRaw any
	)
	if err := tx.QueryRowContext(ctx, `
		SELECT v.template_set_id, v.status, s.category, v.definition_json
		FROM project_template_versions v
		JOIN project_template_sets s ON s.id = v.template_set_id
		WHERE v.id = ?
		LIMIT 1
	`, id).Scan(&templateSetID, &status, &rowCategory, &definitionRaw); err != nil {
		if err == sql.ErrNoRows {
			return resolvedProjectTemplateVersion{}, httperror.New(http.StatusBadRequest, "project_template_not_found", "project template version not found")
		}
		return resolvedProjectTemplateVersion{}, err
	}
	if rowCategory != category {
		return resolvedProjectTemplateVersion{}, httperror.New(http.StatusBadRequest, "project_template_category_mismatch", "project template version does not match project category")
	}
	if status != "published" {
		return resolvedProjectTemplateVersion{}, httperror.New(http.StatusBadRequest, "project_template_not_published", "project can only use a published template version")
	}

	definition, err := parseProjectTemplateDefinition(definitionRaw)
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}
	return resolvedProjectTemplateVersion{
		TemplateSetID:     templateSetID,
		TemplateVersionID: id,
		Definition:        definition,
	}, nil
}

func createDefaultProjectTemplateVersionTx(ctx context.Context, tx *sql.Tx, category string) (resolvedProjectTemplateVersion, error) {
	definition := defaultProjectTemplateDefinition(category)
	definitionJSON, err := json.Marshal(definition)
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}

	templateSetID := int64(0)
	if err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM project_template_sets
		WHERE category = ? AND is_system = 1
		ORDER BY id ASC
		LIMIT 1
	`, category).Scan(&templateSetID); err != nil {
		if err != sql.ErrNoRows {
			return resolvedProjectTemplateVersion{}, err
		}
		setResult, err := tx.ExecContext(ctx, `
			INSERT INTO project_template_sets
			  (code, name, category, description, is_system, created_by)
			VALUES (?, ?, ?, ?, 1, 'system')
		`, "system-"+category, category+" 默认模板", category, "系统初始化模板集")
		if err != nil {
			return resolvedProjectTemplateVersion{}, err
		}
		templateSetID, err = setResult.LastInsertId()
		if err != nil {
			return resolvedProjectTemplateVersion{}, err
		}
	}

	nextVersionNo := int64(1)
	var maxVersionNo sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT MAX(version_no) FROM project_template_versions WHERE template_set_id = ?", templateSetID).Scan(&maxVersionNo); err != nil {
		return resolvedProjectTemplateVersion{}, err
	}
	if maxVersionNo.Valid {
		nextVersionNo = maxVersionNo.Int64 + 1
	}

	versionResult, err := tx.ExecContext(ctx, `
		INSERT INTO project_template_versions
		  (template_set_id, version_no, version_label, status, notes, definition_json, published_at, published_by, created_by)
		VALUES (?, ?, ?, 'published', '系统初始化版本', ?, CURRENT_TIMESTAMP, 'system', 'system')
	`, templateSetID, nextVersionNo, fmt.Sprintf("v%d", nextVersionNo), string(definitionJSON))
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}
	templateVersionID, err := versionResult.LastInsertId()
	if err != nil {
		return resolvedProjectTemplateVersion{}, err
	}

	return resolvedProjectTemplateVersion{
		TemplateSetID:     templateSetID,
		TemplateVersionID: templateVersionID,
		Definition:        definition,
	}, nil
}

func instantiateProjectFromTemplateTx(
	ctx context.Context,
	tx *sql.Tx,
	projectID int64,
	projectCode string,
	createdBy string,
	definition projectTemplateDefinition,
	excludedWorkItemKeys map[string]bool,
) error {
	counter := int64(0)
	var storedCounter sql.NullInt64
	if err := tx.QueryRowContext(ctx, "SELECT counter FROM project_counters WHERE project_id = ?", projectID).Scan(&storedCounter); err != nil && err != sql.ErrNoRows {
		return err
	}
	if storedCounter.Valid {
		counter = storedCounter.Int64
	}

	for _, milestone := range sortedTemplateMilestones(definition.Milestones) {
		milestoneResult, err := tx.ExecContext(ctx, `
			INSERT INTO milestones
			  (project_id, name, description, mode, pivr_stage, recurrence_rule, sort_order, created_by, template_key)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, projectID, milestoneName(milestone), nullableStringPointer(milestone.Description), milestoneMode(milestone.Mode), nullableTemplateStage(milestone.PivrStage), nullableText(milestone.RecurrenceRule), milestone.SortOrder, createdBy, nullableText(milestone.Key))
		if err != nil {
			return err
		}
		milestoneID, err := milestoneResult.LastInsertId()
		if err != nil {
			return err
		}

		for _, workItem := range sortedTemplateWorkItems(milestone.WorkItems) {
			if excludedWorkItemKeys[workItem.Key] && !workItem.Required {
				continue
			}
			counter++
			itemKey := fmt.Sprintf("%s-%d", projectCode, counter)
			tier := workItemTier(workItem.Tier)
			workItemResult, err := tx.ExecContext(ctx, `
				INSERT INTO work_items
				  (project_id, milestone_id, item_number, item_key, type, tier, title, description,
				   status, priority, severity, weight, assignee_uid, reporter_uid, due_date,
				   estimated_hours, parent_id, sort_order, approval_status, review_level, required, template_key)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, projectID, milestoneID, counter, itemKey, workItemType(workItem.Type), tier, workItemTitle(workItem), nullableStringPointer(workItem.Description), workItemStatus(tier), workItemPriority(workItem.Priority), nil, 1, nil, createdBy, nil, nil, nil, workItem.SortOrder, "not_required", clampInt(workItem.ReviewLevel, 0, 4, 1), boolToInt(workItem.Required), nullableText(workItem.Key))
			if err != nil {
				return err
			}
			workItemID, err := workItemResult.LastInsertId()
			if err != nil {
				return err
			}

			for _, deliverable := range sortedTemplateDeliverables(workItem.Deliverables) {
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO deliverables
					  (project_owner_id, milestone_owner_id, target_id, matter_id,
					   name, description, acceptance_criteria, deliverable_type, required, sort_order,
					   status, project_id, project_code, created_by, template_key)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
				`, nil, nil, workItemID, nil, deliverableName(deliverable), nullableStringPointer(deliverable.Description), nullableText(deliverable.AcceptanceCriteria), deliverableType(deliverable.DeliverableType), boolToInt(deliverable.Required), deliverable.SortOrder, projectID, projectCode, createdBy, nullableText(deliverable.Key)); err != nil {
					return err
				}
			}
		}
	}

	_, err := tx.ExecContext(ctx, "UPDATE project_counters SET counter = ? WHERE project_id = ?", counter, projectID)
	return err
}

func parseProjectTemplateDefinition(raw any) (projectTemplateDefinition, error) {
	var text string
	switch value := raw.(type) {
	case nil:
		return projectTemplateDefinition{}, nil
	case []byte:
		text = strings.TrimSpace(string(value))
	case string:
		text = strings.TrimSpace(value)
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return projectTemplateDefinition{}, err
		}
		text = strings.TrimSpace(string(encoded))
	}
	if text == "" {
		return projectTemplateDefinition{}, nil
	}

	var definition projectTemplateDefinition
	if err := json.Unmarshal([]byte(text), &definition); err != nil {
		return projectTemplateDefinition{}, httperror.New(http.StatusBadRequest, "invalid_project_template_definition", "project template definition is invalid")
	}
	return normalizeProjectTemplateDefinition(definition), nil
}

func normalizeProjectTemplateDefinition(definition projectTemplateDefinition) projectTemplateDefinition {
	for milestoneIndex := range definition.Milestones {
		milestone := &definition.Milestones[milestoneIndex]
		if strings.TrimSpace(milestone.Key) == "" {
			milestone.Key = fmt.Sprintf("milestone-%d", milestoneIndex+1)
		}
		if strings.TrimSpace(milestone.Name) == "" {
			milestone.Name = fmt.Sprintf("里程碑 %d", milestoneIndex+1)
		}
		if strings.TrimSpace(milestone.Mode) == "" {
			milestone.Mode = "rolling_plan"
		}
		if strings.TrimSpace(milestone.PivrStage) == "" {
			milestone.PivrStage = "P"
		}
		for workItemIndex := range milestone.WorkItems {
			workItem := &milestone.WorkItems[workItemIndex]
			if strings.TrimSpace(workItem.Key) == "" {
				workItem.Key = fmt.Sprintf("%s-work-item-%d", milestone.Key, workItemIndex+1)
			}
			if strings.TrimSpace(workItem.Title) == "" {
				workItem.Title = fmt.Sprintf("工作项 %d", workItemIndex+1)
			}
			if strings.TrimSpace(workItem.Type) == "" {
				workItem.Type = "task"
			}
			if strings.TrimSpace(workItem.Tier) == "" {
				workItem.Tier = "target"
			}
			if strings.TrimSpace(workItem.Priority) == "" {
				workItem.Priority = "P2"
			}
			if workItem.ReviewLevel < 0 {
				workItem.ReviewLevel = 1
			}
			for deliverableIndex := range workItem.Deliverables {
				deliverable := &workItem.Deliverables[deliverableIndex]
				if strings.TrimSpace(deliverable.Key) == "" {
					deliverable.Key = fmt.Sprintf("%s-deliverable-%d", workItem.Key, deliverableIndex+1)
				}
				if strings.TrimSpace(deliverable.Name) == "" {
					deliverable.Name = fmt.Sprintf("交付物 %d", deliverableIndex+1)
				}
				if strings.TrimSpace(deliverable.DeliverableType) == "" {
					deliverable.DeliverableType = "document"
				}
			}
		}
	}
	return definition
}

func defaultProjectTemplateDefinition(category string) projectTemplateDefinition {
	seeds := defaultProjectMilestoneSeeds(category)
	milestones := make([]projectTemplateMilestone, 0, len(seeds))
	for _, seed := range seeds {
		milestones = append(milestones, projectTemplateMilestone{
			Key:            seed.Key,
			Name:           seed.Name,
			Mode:           seed.Mode,
			PivrStage:      seed.PivrStage,
			SortOrder:      seed.SortOrder,
			RecurrenceRule: seed.RecurrenceRule,
		})
	}
	definition := projectTemplateDefinition{Milestones: milestones}
	ensureRequirementBaseline(&definition, category)
	ensureOpportunityTemplateDeliverables(&definition, category)
	return definition
}

func ensureOpportunityTemplateDeliverables(definition *projectTemplateDefinition, category string) {
	if definition == nil {
		return
	}
	var seeds []opportunityTemplateDeliverableSeed
	switch category {
	case "presales":
		seeds = []opportunityTemplateDeliverableSeed{
			{Stage: "P", Key: "opportunity-analysis", Name: "《商机分析报告》", AcceptanceCriteria: "竞品分析、技术对标、我方优劣势评估", Required: true},
			{Stage: "I", Key: "technical-proposal-bid", Name: "《技术方案/标书》", AcceptanceCriteria: "方案完整、架构合理、响应招标要求", Required: true},
			{Stage: "V", Key: "bid-presentation", Name: "《讲标材料》", AcceptanceCriteria: "演示流畅、答疑准备充分", Required: true},
			{Stage: "R", Key: "bid-retrospective", Name: "《投标复盘》", AcceptanceCriteria: "中标/未中标原因分析，经验沉淀为模板", Required: true},
		}
	case "sales":
		seeds = []opportunityTemplateDeliverableSeed{
			{Stage: "P", Key: "customer-profile", Name: "《客户画像》", AcceptanceCriteria: "客户基本信息、业务痛点、决策链完整", Required: true},
			{Stage: "I", Key: "solution-proposal", Name: "《解决方案》", AcceptanceCriteria: "针对客户痛点的方案，含产品演示材料", Required: true},
			{Stage: "V", Key: "quotation-contract", Name: "《报价单/合同》", AcceptanceCriteria: "商务条款确认，法务审核通过", Required: true},
			{Stage: "R", Key: "customer-success-plan", Name: "《客户成功计划》", AcceptanceCriteria: "含回款计划、续费策略、客户满意度跟踪", Required: false},
		}
	default:
		return
	}

	byStage := make(map[string]opportunityTemplateDeliverableSeed, len(seeds))
	for _, seed := range seeds {
		byStage[seed.Stage] = seed
	}
	for index := range definition.Milestones {
		milestone := &definition.Milestones[index]
		seed, ok := byStage[milestone.PivrStage]
		if !ok {
			continue
		}
		description := seed.AcceptanceCriteria
		workItemKey := strings.ToLower(seed.Stage) + "-item-1-" + seed.Key
		milestone.WorkItems = append(milestone.WorkItems, projectTemplateWorkItem{
			Key: workItemKey, Title: "编制" + seed.Name, Type: "task", Tier: "target",
			Description: &description, Required: seed.Required, ReviewLevel: 1, Priority: "P2",
			Deliverables: []projectTemplateDeliverable{{
				Key: workItemKey + "-deliverable-1", Name: seed.Name,
				AcceptanceCriteria: seed.AcceptanceCriteria, DeliverableType: "document", Required: seed.Required,
			}},
		})
	}
}

func ensureRequirementBaseline(definition *projectTemplateDefinition, category string) bool {
	if definition == nil || (category != "product_dev" && category != "custom_dev") {
		return false
	}
	for _, milestone := range definition.Milestones {
		for _, workItem := range milestone.WorkItems {
			if workItem.Key == "requirement_baseline" {
				return false
			}
		}
	}
	for index := range definition.Milestones {
		if definition.Milestones[index].PivrStage != "I" {
			continue
		}
		definition.Milestones[index].WorkItems = append(
			[]projectTemplateWorkItem{requirementBaselineTemplateWorkItem()},
			definition.Milestones[index].WorkItems...,
		)
		return true
	}
	return false
}

func requirementBaselineTemplateWorkItem() projectTemplateWorkItem {
	description := "本项目的需求分解工作项，挂载所有基线评审通过的需求项，聚合由需求分解出的实施任务。"
	return projectTemplateWorkItem{
		Key:          "requirement_baseline",
		Title:        "需求分解",
		Type:         "requirement",
		Tier:         "target",
		Description:  &description,
		Required:     true,
		ReviewLevel:  1,
		Priority:     "P1",
		SortOrder:    -1,
		Deliverables: []projectTemplateDeliverable{},
	}
}

func defaultProjectMilestoneSeeds(category string) []defaultProjectMilestoneSeed {
	switch category {
	case "product_dev":
		return []defaultProjectMilestoneSeed{
			{Key: "p-gui-hua-poc", Name: "规划POC", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-he-xin-mvp", Name: "核心MVP", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-shang-yong-mmp", Name: "商用MMP", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-shi-chang-pmf", Name: "市场PMF", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "custom_dev":
		return []defaultProjectMilestoneSeed{
			{Key: "p-xu-qiu-que-ren", Name: "需求确认", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-xi-tong-gou-jian", Name: "系统构建", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-yan-shou-uat", Name: "验收 UAT", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-wei-bao-yi-jiao", Name: "维保移交", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "delivery":
		return []defaultProjectMilestoneSeed{
			{Key: "p-jin-chang-jiao-di", Name: "进场交底", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-bu-shu-pei-zhi", Name: "部署配置", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-shi-yun-xing", Name: "试运行", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			// R「项目结项」为强约束：交付结项有明确截止日期，与前端 pivrMilestoneModes 一致
			{Key: "r-xiang-mu-jie-xiang", Name: "项目结项", Mode: "strong_constraint", PivrStage: "R", SortOrder: 4},
		}
	case "maintenance":
		// 与前端 buildDefaultProjectTemplateDefinition 的 maintenance 分支保持一致：
		// 一个常驻工单容器 + 一个周期单元。周期内的 P/I/V/R（周期规划 / 任务处理 /
		// 质量抽检 / 复盘优化）是节奏标签，不各自生成里程碑——否则一个周期会产生
		// 四次滚动，关期门无法确定作用对象。
		// 规范见《汇智PIVR项目管理生命周期模型说明书V1.1》§4.6.1。
		//
		// 注意：前端同分支还带 carryover 与 recurringWorkItems（巡检模板），
		// 当前 projectTemplateMilestone 尚未承载这两项，属已知差异。
		return []defaultProjectMilestoneSeed{
			{Key: "service_ops", Name: "工单处理", Mode: "rolling_plan", PivrStage: "I", SortOrder: 1},
			{Key: "monthly_cycle", Name: "月度运维周期", Mode: "periodic", PivrStage: "R", SortOrder: 2, RecurrenceRule: "monthly"},
		}
	case "routine":
		// 日常事务容器不使用 PIVR 阶段，也不生成里程碑（V1.1 §4.6.3）
		return nil
	case "sales":
		return []defaultProjectMilestoneSeed{
			{Key: "p-xian-suo-huo-qu", Name: "线索获取", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-fang-an-gou-tong", Name: "方案沟通", Mode: "rolling_plan", PivrStage: "I", SortOrder: 2},
			{Key: "v-shang-wu-tan-pan", Name: "商务谈判", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-ke-hu-cheng-gong", Name: "客户成功", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "presales":
		return []defaultProjectMilestoneSeed{
			{Key: "p-shang-ji-fen-xi", Name: "商机分析", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-biao-shu-zhi-zuo", Name: "标书制作", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-tou-biao-yan-shi", Name: "投标演示", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-jing-yan-fu-pan", Name: "经验复盘", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	// Deprecated: improvement 已于 V1.1 停用，保留仅供存量项目模板渲染。
	case "improvement":
		return []defaultProjectMilestoneSeed{
			{Key: "p-que-xian-fen-xi", Name: "缺陷分析", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-fang-an-zhi-xing", Name: "方案执行", Mode: "rolling_plan", PivrStage: "I", SortOrder: 2},
			{Key: "v-xiao-guo-hui-gui", Name: "效果回归", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-biao-zhun-gu-hua", Name: "标准固化", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	case "compliance":
		return []defaultProjectMilestoneSeed{
			{Key: "p-gui-zhang-shu-li", Name: "规章梳理", Mode: "strong_constraint", PivrStage: "P", SortOrder: 1},
			{Key: "i-zi-cha-zheng-gai", Name: "自查整改", Mode: "strong_constraint", PivrStage: "I", SortOrder: 2},
			{Key: "v-mo-ni-shen-ji", Name: "模拟审计", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-he-gui-jia-gu", Name: "合规加固", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	default:
		// 未登记的分类落入通用模板。新增分类时必须同步本函数与前端
		// app/config/milestone.ts 的 pivrTypeMapping / pivrMilestoneModes，
		// 否则两侧建出的项目结构不同。
		log.Printf("[aims project-template] category %q 未登记默认里程碑模板，回退通用 PIVR 模板", category)
		return []defaultProjectMilestoneSeed{
			{Key: "p-prepare", Name: "准备", Mode: "rolling_plan", PivrStage: "P", SortOrder: 1},
			{Key: "i-implement", Name: "实施", Mode: "rolling_plan", PivrStage: "I", SortOrder: 2},
			{Key: "v-verify", Name: "验证", Mode: "strong_constraint", PivrStage: "V", SortOrder: 3},
			{Key: "r-release", Name: "改进", Mode: "rolling_plan", PivrStage: "R", SortOrder: 4},
		}
	}
}

func sortedTemplateMilestones(items []projectTemplateMilestone) []projectTemplateMilestone {
	sorted := append([]projectTemplateMilestone(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].SortOrder < sorted[j].SortOrder
	})
	return sorted
}

func sortedTemplateWorkItems(items []projectTemplateWorkItem) []projectTemplateWorkItem {
	sorted := append([]projectTemplateWorkItem(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].SortOrder < sorted[j].SortOrder
	})
	return sorted
}

func sortedTemplateDeliverables(items []projectTemplateDeliverable) []projectTemplateDeliverable {
	sorted := append([]projectTemplateDeliverable(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].SortOrder < sorted[j].SortOrder
	})
	return sorted
}

func excludedTemplateWorkItemKeys(body map[string]any) map[string]bool {
	excluded := map[string]bool{}
	for _, key := range []string{"excludedWorkItemKeys", "excluded_work_item_keys"} {
		raw, ok := body[key]
		if !ok || raw == nil {
			continue
		}
		if items, ok := raw.([]any); ok {
			for _, item := range items {
				if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
					excluded[text] = true
				}
			}
			return excluded
		}
		if items, ok := raw.([]string); ok {
			for _, item := range items {
				if text := strings.TrimSpace(item); text != "" {
					excluded[text] = true
				}
			}
			return excluded
		}
	}
	return excluded
}

func nullableStringPointer(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableTemplateStage(value string) any {
	value = strings.TrimSpace(value)
	if value == "P" || value == "I" || value == "V" || value == "R" {
		return value
	}
	return nil
}

func milestoneName(item projectTemplateMilestone) string {
	if text := strings.TrimSpace(item.Name); text != "" {
		return text
	}
	return "里程碑"
}

func milestoneMode(value string) string {
	switch strings.TrimSpace(value) {
	case "strong_constraint", "periodic", "rolling_plan":
		return strings.TrimSpace(value)
	default:
		return "rolling_plan"
	}
}

func workItemTitle(item projectTemplateWorkItem) string {
	if text := strings.TrimSpace(item.Title); text != "" {
		return text
	}
	return "工作项"
}

func workItemType(value string) string {
	switch strings.TrimSpace(value) {
	case "requirement", "task", "bug", "change_request":
		return strings.TrimSpace(value)
	default:
		return "task"
	}
}

func workItemTier(value string) string {
	switch strings.TrimSpace(value) {
	case "target", "matter":
		return strings.TrimSpace(value)
	default:
		return "target"
	}
}

func workItemStatus(tier string) string {
	if strings.TrimSpace(tier) == "target" {
		return "planning"
	}
	return "todo"
}

func workItemPriority(value string) string {
	switch strings.TrimSpace(value) {
	case "P0", "P1", "P2", "P3":
		return strings.TrimSpace(value)
	default:
		return "P2"
	}
}

func deliverableName(item projectTemplateDeliverable) string {
	if text := strings.TrimSpace(item.Name); text != "" {
		return text
	}
	return "交付物"
}

func deliverableType(value string) string {
	switch strings.TrimSpace(value) {
	case "document", "code", "artifact", "task":
		return strings.TrimSpace(value)
	default:
		return "document"
	}
}

func clampInt(value int, min int, max int, fallback int) int {
	if value == 0 {
		return fallback
	}
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

func int64BodyValueOrZero(body map[string]any, keys ...string) (int64, error) {
	id, ok, err := optionalBodyID(body, keys...)
	if err != nil {
		return 0, fmt.Errorf("invalid %s", strings.Join(keys, "/"))
	}
	if !ok {
		return 0, nil
	}
	return id, nil
}
