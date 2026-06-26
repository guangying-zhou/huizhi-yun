package altoc

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) leadConversionCandidates(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	leadID, err := altocIdentifierID(identifier, "lead_id")
	if err != nil {
		return nil, err
	}
	filters := []string{"id = ?", "deleted_at IS NULL"}
	args := []any{leadID}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "lead", "", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	lead, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT *
		FROM `+"`lead`"+`
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if lead == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "lead not found")
	}

	customers, err := a.matchLeadCustomerCandidates(ctx, lead, query)
	if err != nil {
		return nil, err
	}
	contacts, err := a.matchLeadContactCandidates(ctx, lead, query)
	if err != nil {
		return nil, err
	}
	similarOpportunities, err := a.matchLeadOpenOpportunityCandidates(ctx, lead, customers, query)
	if err != nil {
		return nil, err
	}
	stages, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM opportunity_stage
		WHERE is_enabled = 1
		ORDER BY sort_no ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"lead":                       lead,
		"customers":                  customers,
		"contacts":                   contacts,
		"similar_open_opportunities": similarOpportunities,
		"stages":                     stages,
	}, nil
}

func altocRuntimeBodyFromQuery(query url.Values) map[string]any {
	body := map[string]any{}
	if currentUser := strings.TrimSpace(query.Get("current_user")); currentUser != "" {
		body["current_user"] = currentUser
	}
	if operatorUID := strings.TrimSpace(query.Get("operator_uid")); operatorUID != "" {
		body["operator_uid"] = operatorUID
	}
	if scopes := strings.Fields(query.Get("current_user_scopes")); len(scopes) > 0 {
		body["current_user_scopes"] = scopes
	}
	for _, key := range []string{
		"current_user_altoc_access",
		"currentUserAltocAccess",
		"current_user_altoc_dept_codes",
		"currentUserAltocDeptCodes",
		"current_user_altoc_dept_code",
		"currentUserAltocDeptCode",
		"current_user_data_access",
		"currentUserDataAccess",
		"current_user_data_dept_codes",
		"currentUserDataDeptCodes",
		"current_user_data_dept_code",
		"currentUserDataDeptCode",
		"current_user_dept_codes",
		"currentUserDeptCodes",
		"current_user_dept_code",
		"currentUserDeptCode",
		"current_user_department_codes",
		"currentUserDepartmentCodes",
		"current_user_department_code",
		"currentUserDepartmentCode",
	} {
		values := query[key]
		if len(values) == 1 {
			body[key] = values[0]
		} else if len(values) > 1 {
			body[key] = values
		}
	}
	return body
}

func altocRuntimeBodyFromRequest(query url.Values, body map[string]any) map[string]any {
	merged := altocRuntimeBodyFromQuery(query)
	for _, key := range []string{
		"current_user",
		"currentUser",
		"operator_uid",
		"operatorUid",
		"current_user_scopes",
		"currentUserScopes",
		"current_user_altoc_access",
		"currentUserAltocAccess",
		"current_user_altoc_dept_codes",
		"currentUserAltocDeptCodes",
		"current_user_altoc_dept_code",
		"currentUserAltocDeptCode",
		"current_user_data_access",
		"currentUserDataAccess",
		"current_user_data_dept_codes",
		"currentUserDataDeptCodes",
		"current_user_data_dept_code",
		"currentUserDataDeptCode",
		"current_user_dept_codes",
		"currentUserDeptCodes",
		"current_user_dept_code",
		"currentUserDeptCode",
		"current_user_department_codes",
		"currentUserDepartmentCodes",
		"current_user_department_code",
		"currentUserDepartmentCode",
	} {
		if value, ok := body[key]; ok {
			merged[key] = value
		}
	}
	return merged
}

func altocCommandBodyFromRequest(query url.Values, body map[string]any) map[string]any {
	merged := make(map[string]any, len(body)+8)
	for key, value := range body {
		merged[key] = value
	}
	for key, value := range altocRuntimeBodyFromRequest(query, body) {
		merged[key] = value
	}
	return merged
}

func (a *Adapter) matchLeadCustomerCandidates(ctx context.Context, lead map[string]any, query url.Values) ([]map[string]any, error) {
	columns, err := altocTableColumns(ctx, a.DB(), "customer")
	if err != nil {
		return nil, err
	}
	name := firstNonEmptyText(query.Get("customer_name"), altocMapText(lead, "org_name"), altocMapText(lead, "name"))
	normalizedName := altocNormalizeEntityName(name)
	domain := altocNormalizeDomain(query.Get("organization_domain"))
	creditCode := strings.TrimSpace(query.Get("unified_social_credit_code"))

	conditions := make([]string, 0, 5)
	args := make([]any, 0, 8)
	if creditCode != "" && columns["unified_social_credit_code"] {
		conditions = append(conditions, "cu.unified_social_credit_code = ?")
		args = append(args, creditCode)
	}
	if domain != "" && columns["organization_domain"] {
		conditions = append(conditions, "cu.organization_domain = ?")
		args = append(args, domain)
	}
	if normalizedName != "" {
		if columns["normalized_name"] {
			conditions = append(conditions, "cu.normalized_name = ?")
			args = append(args, normalizedName)
		}
		conditions = append(conditions, "LOWER(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(cu.name), ' ', ''), '　', ''), '（', '('), '）', ')')) = ?")
		args = append(args, normalizedName)
		if strings.TrimSpace(name) != "" {
			conditions = append(conditions, "cu.name LIKE ?")
			args = append(args, "%"+strings.TrimSpace(name)+"%")
		}
	}
	if len(conditions) == 0 {
		return []map[string]any{}, nil
	}
	where := []string{
		"cu.deleted_at IS NULL",
		"(" + strings.Join(conditions, " OR ") + ")",
	}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "customer", "cu", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)

	return altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM customer cu
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY cu.updated_at DESC, cu.id DESC
		LIMIT 8
	`, args...)
}

func (a *Adapter) matchLeadContactCandidates(ctx context.Context, lead map[string]any, query url.Values) ([]map[string]any, error) {
	columns, err := altocTableColumns(ctx, a.DB(), "contact")
	if err != nil {
		return nil, err
	}
	name := firstNonEmptyText(query.Get("contact_name"), altocMapText(lead, "contact_name"))
	mobile := firstNonEmptyText(query.Get("contact_mobile"), altocMapText(lead, "contact_mobile"))
	email := firstNonEmptyText(query.Get("contact_email"), altocMapText(lead, "contact_email"))
	normalizedMobile := altocNormalizeMobile(mobile)
	normalizedEmail := altocNormalizeEmail(email)

	conditions := make([]string, 0, 5)
	args := make([]any, 0, 8)
	if normalizedMobile != "" {
		if columns["normalized_mobile"] {
			conditions = append(conditions, "ct.normalized_mobile = ?")
			args = append(args, normalizedMobile)
		}
		conditions = append(conditions, "ct.mobile = ?")
		args = append(args, mobile)
	}
	if normalizedEmail != "" {
		if columns["normalized_email"] {
			conditions = append(conditions, "ct.normalized_email = ?")
			args = append(args, normalizedEmail)
		}
		conditions = append(conditions, "LOWER(ct.email) = ?")
		args = append(args, normalizedEmail)
	}
	if strings.TrimSpace(name) != "" {
		conditions = append(conditions, "ct.name = ?")
		args = append(args, strings.TrimSpace(name))
	}
	if len(conditions) == 0 {
		return []map[string]any{}, nil
	}
	customerColumns, err := altocTableColumns(ctx, a.DB(), "customer")
	if err != nil {
		return nil, err
	}
	where := []string{
		"ct.deleted_at IS NULL",
		"cu.deleted_at IS NULL",
		"(" + strings.Join(conditions, " OR ") + ")",
	}
	scopeWhere, scopeArgs, err := altocContactCandidateScopeWhere(query, columns, customerColumns)
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)

	return altocQueryMaps(ctx, a.DB(), `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name
		FROM contact ct
		INNER JOIN customer cu ON cu.id = ct.customer_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY ct.updated_at DESC, ct.id DESC
		LIMIT 12
	`, args...)
}

func altocContactCandidateScopeWhere(query url.Values, contactColumns map[string]bool, customerColumns map[string]bool) ([]string, []any, error) {
	body := altocRuntimeBodyFromQuery(query)
	if altocActorHasAdminScope(body, "contact") || altocActorHasAdminScope(body, "customer") {
		return nil, nil, nil
	}
	actor := firstBodyText(body, "current_user", "currentUser", "operator_uid", "operatorUid")
	if actor == "" {
		return nil, nil, httperror.New(http.StatusUnauthorized, "missing_current_user", "current_user is required")
	}

	clauses := make([]string, 0, 3)
	args := make([]any, 0, 4)
	if contactColumns["owner_user_id"] {
		clauses = append(clauses, "ct.owner_user_id = ?")
		args = append(args, actor)
	}
	if customerColumns["owner_user_id"] {
		clauses = append(clauses, "cu.owner_user_id = ?")
		args = append(args, actor)
	}
	deptCodes := altocActorDeptCodes(body)
	if customerColumns["owner_dept_code"] && len(deptCodes) > 0 {
		clauses = append(clauses, "cu.owner_dept_code IN ("+altocPlaceholders(len(deptCodes))+")")
		for _, deptCode := range deptCodes {
			args = append(args, deptCode)
		}
	}
	if len(clauses) == 0 {
		return []string{"1 = 0"}, nil, nil
	}
	return []string{"(" + strings.Join(clauses, " OR ") + ")"}, args, nil
}

func (a *Adapter) matchLeadOpenOpportunityCandidates(ctx context.Context, lead map[string]any, customers []map[string]any, query url.Values) ([]map[string]any, error) {
	conditions := make([]string, 0, 2)
	args := make([]any, 0, len(customers)+2)
	customerIDs := make([]any, 0, len(customers))
	seen := map[int64]bool{}
	for _, customer := range customers {
		id := altocPositiveID(customer["id"])
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		customerIDs = append(customerIDs, id)
	}
	if len(customerIDs) > 0 {
		conditions = append(conditions, "op.customer_id IN ("+altocPlaceholders(len(customerIDs))+")")
		args = append(args, customerIDs...)
	}
	leadName := strings.TrimSpace(altocMapText(lead, "name"))
	if leadName != "" {
		conditions = append(conditions, "op.name LIKE ?")
		args = append(args, "%"+leadName+"%")
	}
	if len(conditions) == 0 {
		return []map[string]any{}, nil
	}
	where := []string{
		"op.deleted_at IS NULL",
		"op.status IN ('active', 'paused')",
		"(" + strings.Join(conditions, " OR ") + ")",
	}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	return altocQueryMaps(ctx, a.DB(), `
		SELECT
		  op.id,
		  op.code,
		  op.name,
		  op.customer_id,
		  op.stage_id,
		  op.status,
		  op.amount_tax_inclusive,
		  op.expected_sign_date,
		  op.owner_user_id,
		  cu.name AS customer_name,
		  os.name AS stage_name
		FROM opportunity op
		LEFT JOIN customer cu ON cu.id = op.customer_id
		LEFT JOIN opportunity_stage os ON os.id = op.stage_id
		WHERE `+strings.Join(where, " AND ")+`
		ORDER BY op.updated_at DESC, op.id DESC
		LIMIT 8
	`, args...)
}

func altocPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	values := make([]string, count)
	for i := range values {
		values[i] = "?"
	}
	return strings.Join(values, ", ")
}
