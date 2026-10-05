package aims

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-sql-driver/mysql"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type portfolioListItem struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	DomainCode  *string `json:"domainCode"`
	OwnerUID    *string `json:"ownerUid"`
	DeptCode    *string `json:"deptCode"`
	GitGroup    *string `json:"gitGroup"`
	// Deprecated: 已由 DefaultCategory=="product_dev" 表达，保留兼容存量前端
	IsProductLine   bool    `json:"isProductLine"`
	DefaultCategory *string `json:"defaultCategory"`
	IsSystem        bool    `json:"isSystem"`
	DisplayOrder    int64   `json:"displayOrder"`
	Status          string  `json:"status"`
	CreatedBy       string  `json:"createdBy"`
	CreatedAt       string  `json:"createdAt"`
	UpdatedAt       string  `json:"updatedAt"`
	ProjectCount    int64   `json:"projectCount"`
}

type portfolioDetail struct {
	ID          int64   `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	DomainCode  *string `json:"domainCode"`
	OwnerUID    *string `json:"ownerUid"`
	DeptCode    *string `json:"deptCode"`
	GitGroup    *string `json:"gitGroup"`
	// Deprecated: 已由 DefaultCategory=="product_dev" 表达，保留兼容存量前端
	IsProductLine   bool               `json:"isProductLine"`
	DefaultCategory *string            `json:"defaultCategory"`
	IsSystem        bool               `json:"isSystem"`
	DisplayOrder    int64              `json:"displayOrder"`
	Status          string             `json:"status"`
	CreatedBy       string             `json:"createdBy"`
	CreatedAt       string             `json:"createdAt"`
	UpdatedAt       string             `json:"updatedAt"`
	Projects        []portfolioProject `json:"projects"`
}

type portfolioProject struct {
	ID              int64   `json:"id"`
	ProjectCode     string  `json:"projectCode"`
	Name            string  `json:"name"`
	Category        string  `json:"category"`
	LifecycleStatus string  `json:"lifecycleStatus"`
	LeaderUID       *string `json:"leaderUid"`
	StartDate       *string `json:"startDate"`
	EndDate         *string `json:"endDate"`
}

func (a *Adapter) handlePortfoliosRuntime(ctx context.Context, method string, path string, query url.Values, body map[string]any) (any, string, bool, error) {
	if path == "/v1/aims/portfolios" {
		switch method {
		case http.MethodGet:
			data, err := a.listPortfolios(ctx, query)
			return data, "aims.portfolios.list", true, err
		case http.MethodPost:
			data, err := a.createPortfolio(ctx, query, body)
			return data, "aims.portfolios.create", true, err
		default:
			return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "portfolios runtime method is not supported")
		}
	}

	portfolioID, ok := directPathParam(path, "/v1/aims/portfolios/")
	if !ok {
		return nil, "", false, nil
	}
	switch method {
	case http.MethodGet:
		data, err := a.portfolioDetail(ctx, portfolioID)
		return data, "aims.portfolios.get", true, err
	case http.MethodPut, http.MethodPatch:
		data, err := a.updatePortfolio(ctx, portfolioID, query, body)
		return data, "aims.portfolios.update", true, err
	case http.MethodDelete:
		data, err := a.deletePortfolio(ctx, portfolioID, query)
		return data, "aims.portfolios.delete", true, err
	default:
		return nil, "", true, httperror.New(http.StatusMethodNotAllowed, "method_not_allowed", "portfolios runtime method is not supported")
	}
}

func (a *Adapter) listPortfolios(ctx context.Context, query url.Values) (map[string]any, error) {
	page := int64(1)
	if parsed, err := parseOptionalPositiveInt(firstQueryText(query, "page")); err == nil && parsed > 0 {
		page = parsed
	}
	pageSize := int64(20)
	if parsed, err := parseOptionalPositiveInt(firstQueryText(query, "pageSize", "page_size")); err == nil && parsed > 0 {
		pageSize = parsed
	}
	if pageSize > 100 {
		pageSize = 100
	}
	offset := (page - 1) * pageSize

	where, args := portfolioListWhere(query)
	var total int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) AS total FROM project_portfolios pf "+where, args...).Scan(&total); err != nil {
		return nil, err
	}

	listArgs := append([]any(nil), args...)
	listArgs = append(listArgs, pageSize, offset)
	rows, err := a.DB().QueryContext(ctx, `
		SELECT pf.id, pf.code, pf.name, pf.description, pf.domain_code, pf.owner_uid,
		       pf.dept_code, pf.git_group, pf.is_product_line, pf.default_category,
		       pf.is_system, pf.display_order,
		       pf.status, pf.created_by, pf.created_at, pf.updated_at,
		       IFNULL(pc.project_count, 0) AS project_count
		FROM project_portfolios pf
		LEFT JOIN (
			SELECT portfolio_id, COUNT(*) AS project_count
			FROM aims_projects
			WHERE portfolio_id IS NOT NULL
			  AND lifecycle_status != 'archived'
			GROUP BY portfolio_id
		) pc ON pc.portfolio_id = pf.id
		`+where+`
		ORDER BY pf.display_order ASC, pf.id ASC
		LIMIT ? OFFSET ?
	`, listArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := make([]portfolioListItem, 0)
	for rows.Next() {
		item, err := scanPortfolioListItem(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": total, "page": page, "pageSize": pageSize}, nil
}

func (a *Adapter) portfolioDetail(ctx context.Context, rawID string) (*portfolioDetail, error) {
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	row := a.DB().QueryRowContext(ctx, `
		SELECT id, code, name, description, domain_code, owner_uid, dept_code,
		       git_group, is_product_line, default_category, is_system, display_order, status, created_by,
		       created_at, updated_at
		FROM project_portfolios
		WHERE id = ?
	`, id)
	detail, err := scanPortfolioDetail(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
		}
		return nil, err
	}

	projects, err := a.portfolioProjects(ctx, id)
	if err != nil {
		return nil, err
	}
	detail.Projects = projects
	return detail, nil
}

func (a *Adapter) createPortfolio(ctx context.Context, query url.Values, body map[string]any) (map[string]any, error) {
	uid := strings.TrimSpace(query.Get("current_user"))
	if uid == "" {
		uid = strings.TrimSpace(query.Get("operator_uid"))
	}
	if uid == "" {
		return nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}
	if err := requirePortfolioManageFlag(query); err != nil {
		return nil, err
	}

	code := strings.ToUpper(strings.TrimSpace(firstBodyText(body, "code")))
	if code == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_code", "项目集编码不能为空")
	}
	name := strings.TrimSpace(firstBodyText(body, "name"))
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_name", "项目集名称不能为空")
	}
	displayOrder := portfolioBodyInt(body, "displayOrder", "display_order")

	defaultCategory, err := portfolioDefaultCategory(body)
	if err != nil {
		return nil, err
	}
	if err := a.ensureSingleRoutinePortfolio(ctx, defaultCategory, 0); err != nil {
		return nil, err
	}

	result, err := a.DB().ExecContext(ctx, `
		INSERT INTO project_portfolios
			(code, name, description, domain_code, owner_uid, dept_code, git_group,
			 is_product_line, default_category, display_order, created_by)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, code, name,
		nullablePortfolioBodyText(body, "description"),
		nullablePortfolioBodyText(body, "domainCode", "domain_code"),
		nullablePortfolioBodyText(body, "ownerUid", "owner_uid"),
		nullablePortfolioBodyText(body, "deptCode", "dept_code"),
		nullablePortfolioBodyText(body, "gitGroup", "git_group"),
		// is_product_line 已降级为派生值，随 default_category 同步写入
		boolToInt64(derivedIsProductLine(defaultCategory, body)),
		nullableTextValue(defaultCategory),
		displayOrder,
		uid)
	if err != nil {
		return nil, portfolioWriteError(err)
	}
	id, _ := result.LastInsertId()
	return map[string]any{"id": id, "code": code}, nil
}

func (a *Adapter) updatePortfolio(ctx context.Context, rawID string, query url.Values, body map[string]any) (map[string]any, error) {
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	if err := requirePortfolioManageFlag(query); err != nil {
		return nil, err
	}
	if exists, err := a.portfolioExists(ctx, id); err != nil {
		return nil, err
	} else if !exists {
		return nil, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
	}

	fields := make([]string, 0)
	args := make([]any, 0)
	addTextField := func(bodyKey string, column string) {
		if value, ok := body[bodyKey]; ok {
			fields = append(fields, column+" = ?")
			args = append(args, nullableTextValue(value))
		}
	}
	addTextField("code", "code")
	addTextField("name", "name")
	addTextField("description", "description")
	addTextField("domainCode", "domain_code")
	addTextField("domain_code", "domain_code")
	addTextField("ownerUid", "owner_uid")
	addTextField("owner_uid", "owner_uid")
	addTextField("deptCode", "dept_code")
	addTextField("dept_code", "dept_code")
	addTextField("gitGroup", "git_group")
	addTextField("git_group", "git_group")
	_, hasDefaultCategory := body["defaultCategory"]
	if !hasDefaultCategory {
		_, hasDefaultCategory = body["default_category"]
	}
	if hasDefaultCategory {
		defaultCategory, err := portfolioDefaultCategory(body)
		if err != nil {
			return nil, err
		}
		if err := a.ensureSingleRoutinePortfolio(ctx, defaultCategory, id); err != nil {
			return nil, err
		}
		fields = append(fields, "default_category = ?")
		args = append(args, nullableTextValue(defaultCategory))
		// is_product_line 为派生值，与 default_category 保持一致
		fields = append(fields, "is_product_line = ?")
		args = append(args, boolToInt64(defaultCategory == "product_dev"))
	} else {
		// 未传 defaultCategory 时沿用旧字段写法，兼容存量前端
		if _, ok := body["isProductLine"]; ok {
			fields = append(fields, "is_product_line = ?")
			args = append(args, boolToInt64(portfolioBodyBool(body, "isProductLine")))
		}
		if _, ok := body["is_product_line"]; ok {
			fields = append(fields, "is_product_line = ?")
			args = append(args, boolToInt64(portfolioBodyBool(body, "is_product_line")))
		}
	}
	if _, ok := body["displayOrder"]; ok {
		fields = append(fields, "display_order = ?")
		args = append(args, portfolioBodyInt(body, "displayOrder"))
	}
	if _, ok := body["display_order"]; ok {
		fields = append(fields, "display_order = ?")
		args = append(args, portfolioBodyInt(body, "display_order"))
	}
	addTextField("status", "status")
	if len(fields) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_request", "没有需要更新的字段")
	}
	args = append(args, id)
	if _, err := a.DB().ExecContext(ctx, "UPDATE project_portfolios SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, portfolioWriteError(err)
	}
	return nil, nil
}

func portfolioWriteError(err error) error {
	var mysqlError *mysql.MySQLError
	if errors.As(err, &mysqlError) && mysqlError.Number == 1062 {
		return httperror.New(
			http.StatusConflict,
			"portfolio_code_conflict",
			"项目集编码已存在，请修改后重试",
		)
	}
	return err
}

func (a *Adapter) deletePortfolio(ctx context.Context, rawID string, query url.Values) (map[string]any, error) {
	id, err := parseID(rawID, "portfolio_id")
	if err != nil {
		return nil, err
	}
	if err := requirePortfolioManageFlag(query); err != nil {
		return nil, err
	}
	if exists, err := a.portfolioExists(ctx, id); err != nil {
		return nil, err
	} else if !exists {
		return nil, httperror.New(http.StatusNotFound, "portfolio_not_found", "项目集不存在")
	}

	var isSystem int64
	if err := a.DB().QueryRowContext(ctx, "SELECT is_system FROM project_portfolios WHERE id = ?", id).Scan(&isSystem); err != nil {
		return nil, err
	}
	if isSystem != 0 {
		return nil, httperror.New(http.StatusBadRequest, "portfolio_is_system", "系统预置项目集不可删除")
	}

	var count int64
	if err := a.DB().QueryRowContext(ctx, "SELECT COUNT(*) AS cnt FROM aims_projects WHERE portfolio_id = ? AND lifecycle_status != 'archived'", id).Scan(&count); err != nil {
		return nil, err
	}
	if count > 0 {
		return nil, httperror.New(http.StatusBadRequest, "portfolio_has_projects", "项目集下仍有关联项目，无法删除")
	}
	if _, err := a.DB().ExecContext(ctx, "DELETE FROM project_portfolios WHERE id = ?", id); err != nil {
		return nil, err
	}
	return nil, nil
}

func portfolioListWhere(query url.Values) (string, []any) {
	conditions := make([]string, 0)
	args := make([]any, 0)
	if status := firstQueryText(query, "status"); status != "" {
		conditions = append(conditions, "pf.status = ?")
		args = append(args, status)
	} else {
		conditions = append(conditions, "pf.status = 'active'")
	}
	if domainCode := firstQueryText(query, "domainCode", "domain_code"); domainCode != "" {
		conditions = append(conditions, "pf.domain_code = ?")
		args = append(args, domainCode)
	}
	if deptCode := firstQueryText(query, "deptCode", "dept_code"); deptCode != "" {
		conditions = append(conditions, "pf.dept_code = ?")
		args = append(args, deptCode)
	}
	if search := firstQueryText(query, "search", "keyword", "q"); search != "" {
		conditions = append(conditions, "pf.name LIKE ?")
		args = append(args, "%"+search+"%")
	}
	if len(conditions) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(conditions, " AND "), args
}

func scanPortfolioListItem(scanner interface {
	Scan(dest ...any) error
}) (portfolioListItem, error) {
	var item portfolioListItem
	var description, domainCode, ownerUID, deptCode, gitGroup sql.NullString
	var status, createdBy, createdAt, updatedAt sql.NullString
	var isProductLine, isSystem int64
	var defaultCategory sql.NullString
	if err := scanner.Scan(
		&item.ID,
		&item.Code,
		&item.Name,
		&description,
		&domainCode,
		&ownerUID,
		&deptCode,
		&gitGroup,
		&isProductLine,
		&defaultCategory,
		&isSystem,
		&item.DisplayOrder,
		&status,
		&createdBy,
		&createdAt,
		&updatedAt,
		&item.ProjectCount,
	); err != nil {
		return portfolioListItem{}, err
	}
	item.Description = nullableString(description)
	item.DomainCode = nullableString(domainCode)
	item.OwnerUID = nullableString(ownerUID)
	item.DeptCode = nullableString(deptCode)
	item.GitGroup = nullableString(gitGroup)
	item.IsProductLine = isProductLine != 0
	item.DefaultCategory = nullableString(defaultCategory)
	item.IsSystem = isSystem != 0
	item.Status = nullStringOr(status, "")
	item.CreatedBy = nullStringOr(createdBy, "")
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	return item, nil
}

func scanPortfolioDetail(scanner interface {
	Scan(dest ...any) error
}) (*portfolioDetail, error) {
	var item portfolioDetail
	var description, domainCode, ownerUID, deptCode, gitGroup sql.NullString
	var status, createdBy, createdAt, updatedAt sql.NullString
	var isProductLine, isSystem int64
	var defaultCategory sql.NullString
	if err := scanner.Scan(
		&item.ID,
		&item.Code,
		&item.Name,
		&description,
		&domainCode,
		&ownerUID,
		&deptCode,
		&gitGroup,
		&isProductLine,
		&defaultCategory,
		&isSystem,
		&item.DisplayOrder,
		&status,
		&createdBy,
		&createdAt,
		&updatedAt,
	); err != nil {
		return nil, err
	}
	item.Description = nullableString(description)
	item.DomainCode = nullableString(domainCode)
	item.OwnerUID = nullableString(ownerUID)
	item.DeptCode = nullableString(deptCode)
	item.GitGroup = nullableString(gitGroup)
	item.IsProductLine = isProductLine != 0
	item.DefaultCategory = nullableString(defaultCategory)
	item.IsSystem = isSystem != 0
	item.Status = nullStringOr(status, "")
	item.CreatedBy = nullStringOr(createdBy, "")
	item.CreatedAt = nullStringOr(createdAt, "")
	item.UpdatedAt = nullStringOr(updatedAt, "")
	item.Projects = []portfolioProject{}
	return &item, nil
}

func (a *Adapter) portfolioProjects(ctx context.Context, portfolioID int64) ([]portfolioProject, error) {
	rows, err := a.DB().QueryContext(ctx, `
		SELECT id, project_code, name, category, lifecycle_status, leader_uid, start_date, end_date
		FROM aims_projects
		WHERE portfolio_id = ?
		  AND lifecycle_status != 'archived'
		ORDER BY updated_at DESC
	`, portfolioID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := make([]portfolioProject, 0)
	for rows.Next() {
		var project portfolioProject
		var leaderUID, startDate, endDate sql.NullString
		if err := rows.Scan(
			&project.ID,
			&project.ProjectCode,
			&project.Name,
			&project.Category,
			&project.LifecycleStatus,
			&leaderUID,
			&startDate,
			&endDate,
		); err != nil {
			return nil, err
		}
		project.LeaderUID = nullableString(leaderUID)
		project.StartDate = nullableString(startDate)
		project.EndDate = nullableString(endDate)
		projects = append(projects, project)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return projects, nil
}

func (a *Adapter) portfolioExists(ctx context.Context, id int64) (bool, error) {
	var existing int64
	if err := a.DB().QueryRowContext(ctx, "SELECT id FROM project_portfolios WHERE id = ?", id).Scan(&existing); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func requirePortfolioManageFlag(query url.Values) error {
	if strings.TrimSpace(firstQueryText(query, "current_user_can_manage_portfolios", "currentUserCanManagePortfolios")) == "1" {
		return nil
	}
	return httperror.New(http.StatusForbidden, "portfolio_admin_required", "仅 AIMS 管理员可以维护项目集")
}

func parseOptionalPositiveInt(text string) (int64, error) {
	if strings.TrimSpace(text) == "" {
		return 0, nil
	}
	return parseID(text, "number")
}

func nullablePortfolioBodyText(body map[string]any, keys ...string) any {
	text := firstBodyText(body, keys...)
	if text == "" {
		return nil
	}
	return text
}

func nullableTextValue(value any) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return nil
	}
	return text
}

func portfolioBodyInt(body map[string]any, keys ...string) int64 {
	text := firstBodyText(body, keys...)
	if text == "" {
		return 0
	}
	id, err := parseOptionalPositiveInt(text)
	if err != nil {
		return 0
	}
	return id
}

func portfolioBodyBool(body map[string]any, keys ...string) bool {
	for _, key := range keys {
		if value, ok := body[key]; ok {
			return truthyBodyValue(value)
		}
	}
	return false
}

// portfolioDefaultCategory 解析并校验请求中的默认分类，空值表示不预设。
func portfolioDefaultCategory(body map[string]any) (string, error) {
	value := strings.TrimSpace(portfolioBodyText(body, "defaultCategory", "default_category"))
	if value == "" {
		return "", nil
	}
	for _, allowed := range projectTemplateCategories {
		if value == allowed {
			// improvement 已停用，不允许作为新的默认分类
			if value == "improvement" {
				return "", httperror.New(http.StatusBadRequest, "default_category_deprecated",
					"改进分类已停用，不能作为项目集默认分类")
			}
			return value, nil
		}
	}
	return "", httperror.New(http.StatusBadRequest, "invalid_default_category", "默认分类不合法")
}

// ensureSingleRoutinePortfolio 保证 default_category=routine 的项目集全局唯一。
// 日常事务容器依赖唯一入口，多个 routine 项目集会使工时归集口径分裂（V1.1 §1.4）。
func (a *Adapter) ensureSingleRoutinePortfolio(ctx context.Context, defaultCategory string, excludeID int64) error {
	if defaultCategory != "routine" {
		return nil
	}
	var count int64
	if err := a.DB().QueryRowContext(ctx,
		"SELECT COUNT(*) FROM project_portfolios WHERE default_category = 'routine' AND id != ?",
		excludeID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return httperror.New(http.StatusBadRequest, "routine_portfolio_exists",
			"日常事务项目集全局唯一，已存在一个")
	}
	return nil
}

// derivedIsProductLine 兼容期内保持 is_product_line 与 default_category 一致。
func derivedIsProductLine(defaultCategory string, body map[string]any) bool {
	if defaultCategory != "" {
		return defaultCategory == "product_dev"
	}
	return portfolioBodyBool(body, "isProductLine", "is_product_line")
}

func portfolioBodyText(body map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, ok := body[key]; ok {
			if text, ok := raw.(string); ok {
				return text
			}
		}
	}
	return ""
}

func boolToInt64(value bool) int64 {
	if value {
		return 1
	}
	return 0
}
