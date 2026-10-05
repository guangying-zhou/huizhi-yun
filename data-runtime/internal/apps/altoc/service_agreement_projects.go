package altoc

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const contractProjectCostLookupStatusesSQL = "('planned', 'active', 'closed')"

func (a *Adapter) handleServiceAgreementProjectGet(ctx context.Context, path string, query url.Values) (any, string, bool, error) {
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/project-relations"); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.listServiceAgreementProjectRelations(ctx, unescapePathParam(agreementCode))
		return runtimeOK(data), "altoc.service.service_agreements.project_relations.list", true, err
	}
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/default-project"); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.resolveServiceAgreementDefaultProject(ctx, unescapePathParam(agreementCode), serviceAllowMissingDefault(query))
		return runtimeOK(data), "altoc.service.service_agreements.default_project.resolve", true, err
	}
	if projectCode, ok := pathParam(path, "/v1/altoc/service/service-agreement-projects/by-project/", ""); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.serviceAgreementProjectsByProjectCode(ctx, unescapePathParam(projectCode))
		return runtimeOK(data), "altoc.service.service_agreement_projects.by_project", true, err
	}
	if projectCode, ok := pathParam(path, "/v1/altoc/service/projects/", "/contract-lines"); ok {
		if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "contract", "view"); err != nil {
			return nil, "", true, err
		}
		data, err := a.contractLinesByProjectCode(ctx, unescapePathParam(projectCode))
		return runtimeOK(data), "altoc.service.projects.contract_lines", true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) handleServiceAgreementProjectPost(ctx context.Context, path string, body map[string]any) (any, string, bool, error) {
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/project-relations"); ok {
		data, err := a.bindServiceAgreementProject(ctx, unescapePathParam(agreementCode), body)
		return runtimeOK(data), "altoc.service.service_agreements.project_relations.bind", true, err
	}
	if agreementCode, ok := pathParam(path, "/v1/altoc/service/service-agreements/", "/project-relations/default"); ok {
		data, err := a.setServiceAgreementDefaultProject(ctx, unescapePathParam(agreementCode), body)
		return runtimeOK(data), "altoc.service.service_agreements.project_relations.default", true, err
	}
	if agreementCode, projectCode, action, ok := serviceAgreementProjectRelationCommandPath(path); ok {
		data, err := a.changeServiceAgreementProjectRelationStatus(ctx, agreementCode, projectCode, action, body)
		return runtimeOK(data), "altoc.service.service_agreements.project_relations." + action, true, err
	}
	return nil, "", false, nil
}

func (a *Adapter) listServiceAgreementProjectRelations(ctx context.Context, agreementCode string) (map[string]any, error) {
	agreement, err := serviceAgreementByCode(ctx, a.DB(), agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	items, err := a.serviceAgreementProjectRelations(ctx, a.DB(), agreement["id"])
	if err != nil {
		return nil, err
	}
	return map[string]any{"service_agreement": agreement, "items": items, "total": len(items)}, nil
}

func (a *Adapter) bindServiceAgreementProject(ctx context.Context, agreementCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	projectCode := firstBodyText(body, "project_code", "projectCode", "aims_project_code", "aimsProjectCode")
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_code_required", "project_code is required")
	}
	projectRole, err := serviceAgreementProjectRoleInput(body)
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	agreement, err := lockServiceAgreementByCodeTx(ctx, tx, agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	defaultProject, defaultProvided := serviceAgreementRelationDefaultInput(body)
	if err := a.upsertServiceAgreementProjectRelationTx(ctx, tx, agreement, projectCode, projectRole, defaultProject, defaultProvided, body); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.listServiceAgreementProjectRelations(ctx, agreementCode)
}

func (a *Adapter) setServiceAgreementDefaultProject(ctx context.Context, agreementCode string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	projectCode := firstBodyText(body, "project_code", "projectCode", "aims_project_code", "aimsProjectCode")
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_code_required", "project_code is required")
	}
	requestedRole, err := serviceAgreementProjectRoleInput(body)
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	agreement, err := lockServiceAgreementByCodeTx(ctx, tx, agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	relations, err := altocQueryMaps(ctx, tx, `
		SELECT *
		FROM service_agreement_project_rel
		WHERE service_agreement_id = ?
		  AND deleted_at IS NULL
		FOR UPDATE
	`, agreement["id"])
	if err != nil {
		return nil, err
	}
	projectRole, err := serviceAgreementDefaultProjectRole(projectCode, requestedRole, serviceAgreementProjectRoleProvided(body), relations)
	if err != nil {
		return nil, err
	}
	if err := a.clearCurrentDefaultServiceAgreementProjectsTx(ctx, tx, agreement["id"], altocActor(body)); err != nil {
		return nil, err
	}
	if err := a.upsertServiceAgreementProjectRelationTx(ctx, tx, agreement, projectCode, projectRole, true, true, body); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.resolveServiceAgreementDefaultProject(ctx, agreementCode, false)
}

func (a *Adapter) changeServiceAgreementProjectRelationStatus(ctx context.Context, agreementCode string, projectCode string, action string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	agreement, err := lockServiceAgreementByCodeTx(ctx, tx, agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	role := firstBodyText(body, "project_role", "projectRole")
	if role != "" {
		var err error
		role, err = serviceAgreementProjectRoleInput(body)
		if err != nil {
			return nil, err
		}
	}
	where := []string{"service_agreement_id = ?", "project_code = ?", "deleted_at IS NULL"}
	args := []any{agreement["id"], projectCode}
	if role != "" {
		where = append(where, "project_role = ?")
		args = append(args, role)
	}
	relations, err := altocQueryMaps(ctx, tx, `
		SELECT *
		FROM service_agreement_project_rel
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY is_default DESC, id DESC
		FOR UPDATE
	`, args...)
	if err != nil {
		return nil, err
	}
	if len(relations) == 0 {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_project_not_found", "service agreement project relation not found")
	}
	if role == "" && len(relations) > 1 {
		return nil, httperror.New(http.StatusConflict, "relation_ambiguous", "project has multiple service agreement roles; project_role is required")
	}
	relation := relations[0]
	status := "ended"
	if action == "suspend" {
		status = "suspended"
	}
	effectiveTo := altocDateText(firstNonEmptyText(firstBodyText(body, "effective_to", "effectiveTo", "ended_at", "endedAt"), time.Now().Format("2006-01-02")))
	if _, err := tx.ExecContext(ctx, `
		UPDATE service_agreement_project_rel
		SET status = ?,
		    is_default = 0,
		    effective_to = COALESCE(?, effective_to),
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, effectiveTo, nullableText(altocActor(body)), relation["id"]); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return a.listServiceAgreementProjectRelations(ctx, agreementCode)
}

func (a *Adapter) resolveServiceAgreementDefaultProject(ctx context.Context, agreementCode string, allowMissing bool) (map[string]any, error) {
	agreement, err := serviceAgreementByCode(ctx, a.DB(), agreementCode)
	if err != nil {
		return nil, err
	}
	if agreement == nil {
		return nil, httperror.New(http.StatusNotFound, "service_agreement_not_found", "service agreement not found")
	}
	rows, err := currentDefaultServiceAgreementProjectRows(ctx, a.DB(), agreement["id"])
	if err != nil {
		return nil, err
	}
	if len(rows) > 1 {
		return nil, httperror.New(http.StatusConflict, "multiple_default_service_projects", "service agreement has multiple active default projects")
	}
	if len(rows) == 0 {
		if allowMissing {
			return map[string]any{"service_agreement": agreement, "project_code": "", "source": "none", "reason": "no_default_project"}, nil
		}
		return nil, httperror.New(http.StatusNotFound, "no_default_project", "service agreement has no active default project")
	}
	return map[string]any{
		"service_agreement": agreement,
		"relation":          rows[0],
		"project_code":      rows[0]["project_code"],
		"project_role":      rows[0]["project_role"],
		"source":            "service_agreement_default",
	}, nil
}

func (a *Adapter) serviceAgreementProjectsByProjectCode(ctx context.Context, projectCode string) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_code_required", "project_code is required")
	}
	exists, err := altocTableExists(ctx, a.DB(), "service_agreement_project_rel")
	if err != nil || !exists {
		return map[string]any{"items": []map[string]any{}, "total": 0}, err
	}
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  rel.*,
		  sa.code AS service_agreement_code,
		  sa.name AS service_agreement_name,
		  sa.customer_code,
		  sa.contract_id,
		  ct.code AS contract_code
		FROM service_agreement_project_rel rel
		INNER JOIN service_agreement sa ON sa.id = rel.service_agreement_id
		INNER JOIN contract ct ON ct.id = sa.contract_id
		WHERE rel.project_code = ?
		  AND rel.deleted_at IS NULL
		  AND sa.deleted_at IS NULL
		  AND ct.deleted_at IS NULL
		ORDER BY rel.is_default DESC, rel.status ASC, rel.id DESC
	`, projectCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items, "total": len(items)}, nil
}

func (a *Adapter) contractLinesByProjectCode(ctx context.Context, projectCode string) (map[string]any, error) {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "project_code_required", "project_code is required")
	}
	if exists, err := altocTableExists(ctx, a.DB(), "contract_project_line_rel"); err != nil {
		return nil, err
	} else if exists {
		items, err := altocQueryMaps(ctx, a.DB(), `
			SELECT
			  cpl.project_code,
			  ct.code AS contract_code,
			  cl.code AS contract_line_code,
			  rel.relation_type,
			  rel.allocation_method,
			  rel.allocation_ratio,
			  rel.allocated_amount,
			  rel.planned_workdays,
			  cpl.project_role,
			  cpl.plan_key
			FROM contract_project_link cpl
			INNER JOIN contract ct ON ct.id = cpl.contract_id
			INNER JOIN contract_project_line_rel rel ON rel.contract_project_link_id = cpl.id
			INNER JOIN contract_line cl ON cl.id = rel.contract_line_id
			WHERE cpl.project_code = ?
			  AND cpl.deleted_at IS NULL
			  AND cpl.status IN `+contractProjectCostLookupStatusesSQL+`
			  AND rel.deleted_at IS NULL
			  AND cl.deleted_at IS NULL
			  AND ct.deleted_at IS NULL
			ORDER BY ct.code ASC, cl.sort_no ASC, cl.line_no ASC, cl.id ASC
		`, projectCode)
		if err != nil {
			return nil, err
		}
		if len(items) > 0 {
			return map[string]any{"project_code": projectCode, "items": items, "total": len(items), "source": "structured"}, nil
		}
	}
	items, err := a.contractLinesByProjectCodeFromJSON(ctx, projectCode)
	if err != nil {
		return nil, err
	}
	return map[string]any{"project_code": projectCode, "items": items, "total": len(items), "source": "json_fallback"}, nil
}

func (a *Adapter) contractLinesByProjectCodeFromJSON(ctx context.Context, projectCode string) ([]map[string]any, error) {
	links, err := altocQueryMaps(ctx, a.DB(), `
		SELECT cpl.*, ct.code AS contract_code
		FROM contract_project_link cpl
		INNER JOIN contract ct ON ct.id = cpl.contract_id
		WHERE cpl.project_code = ?
		  AND cpl.deleted_at IS NULL
		  AND cpl.status IN `+contractProjectCostLookupStatusesSQL+`
		  AND ct.deleted_at IS NULL
		ORDER BY cpl.id ASC
	`, projectCode)
	if err != nil {
		return nil, err
	}
	items := []map[string]any{}
	for _, link := range links {
		for _, lineCode := range activationStringSlice(link["line_codes_json"]) {
			line, err := altocQueryOneMap(ctx, a.DB(), `
				SELECT code
				FROM contract_line
				WHERE contract_id = ?
				  AND code = ?
				  AND deleted_at IS NULL
				LIMIT 1
			`, link["contract_id"], lineCode)
			if err != nil {
				return nil, err
			}
			if line == nil {
				continue
			}
			items = append(items, map[string]any{
				"project_code":       projectCode,
				"contract_code":      link["contract_code"],
				"contract_line_code": lineCode,
				"relation_type":      contractProjectRelationType(altocMapText(link, "project_role")),
				"allocation_method":  "unallocated",
				"allocation_ratio":   nil,
				"allocated_amount":   nil,
				"planned_workdays":   nil,
				"project_role":       link["project_role"],
				"plan_key":           link["plan_key"],
			})
		}
	}
	return items, nil
}

func (a *Adapter) serviceAgreementProjectRelations(ctx context.Context, conn altocQueryer, agreementID any) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "service_agreement_project_rel")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	return altocQueryMaps(ctx, conn, `
		SELECT *
		FROM service_agreement_project_rel
		WHERE service_agreement_id = ?
		  AND deleted_at IS NULL
		ORDER BY is_default DESC, status ASC, project_role ASC, id ASC
	`, agreementID)
}

func (a *Adapter) upsertServiceAgreementProjectRelationTx(ctx context.Context, tx *sql.Tx, agreement map[string]any, projectCode string, projectRole string, defaultProject bool, defaultProvided bool, body map[string]any) error {
	projectCode = strings.TrimSpace(projectCode)
	if projectCode == "" {
		return httperror.New(http.StatusBadRequest, "project_code_required", "project_code is required")
	}
	if defaultProvided && defaultProject {
		if err := a.clearCurrentDefaultServiceAgreementProjectsTx(ctx, tx, agreement["id"], altocActor(body)); err != nil {
			return err
		}
	}
	status := firstNonEmptyText(firstBodyText(body, "status"), "active")
	sourceType := firstNonEmptyText(firstBodyText(body, "source_type", "sourceType"), "manual")
	effectiveFrom := altocDateText(firstNonEmptyText(firstBodyText(body, "effective_from", "effectiveFrom"), firstNonEmptyDate(agreement["service_start_date"])))
	effectiveTo := altocDateText(firstNonEmptyText(firstBodyText(body, "effective_to", "effectiveTo"), firstNonEmptyDate(agreement["service_end_date"])))
	operator := altocActor(body)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO service_agreement_project_rel (
		  service_agreement_id,
		  project_code,
		  project_role,
		  is_default,
		  effective_from,
		  effective_to,
		  status,
		  source_type,
		  created_by,
		  updated_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  is_default = IF(?, VALUES(is_default), is_default),
		  effective_from = COALESCE(VALUES(effective_from), effective_from),
		  effective_to = VALUES(effective_to),
		  status = VALUES(status),
		  source_type = VALUES(source_type),
		  deleted_at = NULL,
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP
	`, agreement["id"], projectCode, projectRole, boolInt(defaultProject), effectiveFrom, effectiveTo, status, sourceType, nullableText(operator), nullableText(operator), boolInt(defaultProvided))
	return err
}

func (a *Adapter) clearCurrentDefaultServiceAgreementProjectsTx(ctx context.Context, tx *sql.Tx, agreementID any, operator string) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE service_agreement_project_rel
		SET is_default = 0,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE service_agreement_id = ?
		  AND deleted_at IS NULL
		  AND is_default = 1
		  AND status IN ('planned', 'active')
	`, nullableText(operator), agreementID)
	return err
}

func currentDefaultServiceAgreementProjectRows(ctx context.Context, conn altocQueryer, agreementID any) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "service_agreement_project_rel")
	if err != nil || !exists {
		return []map[string]any{}, err
	}
	return altocQueryMaps(ctx, conn, `
		SELECT *
		FROM service_agreement_project_rel
		WHERE service_agreement_id = ?
		  AND deleted_at IS NULL
		  AND is_default = 1
		  AND status = 'active'
		  AND (effective_from IS NULL OR effective_from <= CURRENT_DATE)
		  AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
		ORDER BY id ASC
	`, agreementID)
}

func serviceAgreementByCode(ctx context.Context, conn altocQueryer, agreementCode string) (map[string]any, error) {
	return altocQueryOneMap(ctx, conn, `
		SELECT
		  sa.*,
		  ct.code AS contract_code,
		  ct.owner_user_id AS contract_owner_user_id,
		  ct.owner_dept_code AS contract_owner_dept_code
		FROM service_agreement sa
		INNER JOIN contract ct ON ct.id = sa.contract_id
		WHERE sa.code = ?
		  AND sa.deleted_at IS NULL
		  AND ct.deleted_at IS NULL
		LIMIT 1
	`, strings.TrimSpace(agreementCode))
}

func lockServiceAgreementByCodeTx(ctx context.Context, tx *sql.Tx, agreementCode string) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT
		  sa.*,
		  ct.code AS contract_code,
		  ct.owner_user_id AS contract_owner_user_id,
		  ct.owner_dept_code AS contract_owner_dept_code
		FROM service_agreement sa
		INNER JOIN contract ct ON ct.id = sa.contract_id
		WHERE sa.code = ?
		  AND sa.deleted_at IS NULL
		  AND ct.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, strings.TrimSpace(agreementCode))
}

func serviceAgreementProjectRelationCommandPath(path string) (string, string, string, bool) {
	const prefix = "/v1/altoc/service/service-agreements/"
	if !strings.HasPrefix(path, prefix) {
		return "", "", "", false
	}
	rest := strings.TrimPrefix(path, prefix)
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "project-relations" || parts[2] == "" {
		return "", "", "", false
	}
	projectPart := parts[2]
	action := ""
	switch {
	case strings.HasSuffix(projectPart, ":end"):
		action = "end"
		projectPart = strings.TrimSuffix(projectPart, ":end")
	case strings.HasSuffix(projectPart, ":suspend"):
		action = "suspend"
		projectPart = strings.TrimSuffix(projectPart, ":suspend")
	default:
		return "", "", "", false
	}
	agreementCode, _ := url.PathUnescape(parts[0])
	projectCode, _ := url.PathUnescape(projectPart)
	return agreementCode, projectCode, action, true
}

func serviceAgreementProjectRole(body map[string]any) string {
	role, _ := serviceAgreementProjectRoleInput(body)
	return role
}

func serviceAgreementProjectRoleInput(body map[string]any) (string, error) {
	switch value := strings.TrimSpace(firstBodyText(body, "project_role", "projectRole")); value {
	case "maintenance", "operation", "inspection", "upgrade", "special":
		return value, nil
	case "":
		return "maintenance", nil
	default:
		return "", httperror.New(http.StatusBadRequest, "invalid_service_agreement_project_role", "invalid service agreement project_role")
	}
}

func serviceAgreementProjectRoleProvided(body map[string]any) bool {
	return strings.TrimSpace(firstBodyText(body, "project_role", "projectRole")) != ""
}

func serviceAgreementDefaultProjectRole(projectCode string, requestedRole string, roleProvided bool, relations []map[string]any) (string, error) {
	if roleProvided {
		return firstNonEmptyText(requestedRole, "maintenance"), nil
	}
	matches := []string{}
	seen := map[string]bool{}
	projectCode = strings.TrimSpace(projectCode)
	for _, relation := range relations {
		if altocMapText(relation, "project_code") != projectCode {
			continue
		}
		role := firstNonEmptyText(altocMapText(relation, "project_role"), "maintenance")
		if !seen[role] {
			seen[role] = true
			matches = append(matches, role)
		}
	}
	switch len(matches) {
	case 0:
		return "maintenance", nil
	case 1:
		return matches[0], nil
	default:
		return "", httperror.New(http.StatusConflict, "relation_ambiguous", "project has multiple service agreement roles; project_role is required")
	}
}

func serviceAgreementRelationDefaultInput(body map[string]any) (bool, bool) {
	for _, key := range []string{"isDefault", "is_default", "default"} {
		if value, ok := body[key]; ok {
			return altocBool(value), true
		}
	}
	return false, false
}

func serviceAllowMissingDefault(query url.Values) bool {
	return strings.EqualFold(strings.TrimSpace(query.Get("allow_missing")), "true") ||
		strings.EqualFold(strings.TrimSpace(query.Get("allowMissing")), "true") ||
		strings.TrimSpace(query.Get("allow_missing")) == "1" ||
		strings.TrimSpace(query.Get("allowMissing")) == "1"
}
