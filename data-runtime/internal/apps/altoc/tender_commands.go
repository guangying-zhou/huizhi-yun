package altoc

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

var tenderStatuses = map[string]bool{
	"info_gathering":  true,
	"qualification":   true,
	"bid_preparation": true,
	"bid_submitted":   true,
	"bid_opening":     true,
	"won":             true,
	"lost":            true,
	"review_done":     true,
	"abandoned":       true,
}

func (a *Adapter) listTenders(ctx context.Context, query url.Values) (map[string]any, error) {
	page := altocGetPageParams(query)
	where, args := tenderWhereParts(query)
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "quotation", "t", "owner_user_id", "")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)
	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM tender t
		LEFT JOIN customer c ON t.customer_id = c.id
		LEFT JOIN opportunity o ON t.opportunity_id = o.id
		`+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT
		  t.*,
		  c.name AS customer_name,
		  o.name AS opportunity_name
		FROM tender t
		LEFT JOIN customer c ON t.customer_id = c.id
		LEFT JOIN opportunity o ON t.opportunity_id = o.id
		`+whereSQL+`
		ORDER BY `+tenderOrderBy(query)+`
		LIMIT ? OFFSET ?
	`, append(args, page.pageSize, page.offset)...)
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

func (a *Adapter) getTender(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	tenderID, err := altocIdentifierID(identifier, "tender_id")
	if err != nil {
		return nil, err
	}
	where := []string{"t.id = ?", "t.deleted_at IS NULL"}
	args := []any{tenderID}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "quotation", "t", "owner_user_id", "")
	if err != nil {
		return nil, err
	}
	where = append(where, scopeWhere...)
	args = append(args, scopeArgs...)

	tender, err := altocQueryOneMap(ctx, a.DB(), tenderDetailSQL(strings.Join(where, " AND ")), args...)
	if err != nil {
		return nil, err
	}
	if tender == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "tender not found")
	}
	if err := a.attachTenderChildren(ctx, tender); err != nil {
		return nil, err
	}
	return tender, nil
}

func (a *Adapter) listTenderAgencies(ctx context.Context, query url.Values) ([]map[string]any, error) {
	if err := altocRequireActionScope(altocRuntimeBodyFromQuery(query), "quotation", "view"); err != nil {
		return nil, err
	}
	keyword := strings.TrimSpace(query.Get("keyword"))
	if keyword != "" {
		return altocQueryMaps(ctx, a.DB(), `
			SELECT *
			FROM tender_agency
			WHERE name LIKE ? ESCAPE '\\'
			ORDER BY name ASC
			LIMIT 20
		`, altocLikeKeyword(keyword))
	}
	return altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM tender_agency
		ORDER BY updated_at DESC, id DESC
		LIMIT 50
	`)
}

func (a *Adapter) createTenderAgency(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(altocBodyText(body, "name"))
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_agency_name", "agency name is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	agencyID, err := a.upsertTenderAgencyTx(ctx, tx, body)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": agencyID}, nil
}

func (a *Adapter) createTender(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "quotation", "create"); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	opportunityID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "opportunity_id"), altocBodyText(body, "opportunityId")))
	if opportunityID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_opportunity_id", "opportunity_id is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	opportunity, err := tenderOpportunityForCreateTx(ctx, tx, body, opportunityID)
	if err != nil {
		return nil, err
	}
	customerID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "customer_id"), altocBodyText(body, "customerId")))
	if customerID <= 0 {
		customerID = altocPositiveID(opportunity["customer_id"])
	}
	agencyID, err := a.upsertTenderAgencyTx(ctx, tx, body)
	if err != nil {
		return nil, err
	}
	code, err := nextAltocCode(ctx, tx, "TD", "tender")
	if err != nil {
		return nil, err
	}
	fields, err := tenderCreateFields(body, code, customerID, agencyID, operator)
	if err != nil {
		return nil, err
	}
	tenderID, err := altocInsertRecordTx(ctx, tx, "tender", fields)
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "tender", tenderID, "create", nil, map[string]any{
		"code":           code,
		"name":           fields["name"],
		"opportunity_id": opportunityID,
		"customer_id":    customerID,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": tenderID, "code": code}, nil
}

func (a *Adapter) updateTender(ctx context.Context, identifier string, body map[string]any) (any, error) {
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	tenderID, err := altocIdentifierID(identifier, "tender_id")
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := lockTenderForWriteTx(ctx, tx, tenderID, body)
	if err != nil {
		return nil, err
	}
	updates, err := tenderUpdateFields(body, existing, operator)
	if err != nil {
		return nil, err
	}
	if len(updates) == 0 {
		return nil, nil
	}
	if err := updateTenderRecordTx(ctx, tx, tenderID, updates); err != nil {
		return nil, err
	}
	action := "update"
	if _, ok := updates["status"]; ok {
		action = "status_change"
	}
	if err := insertAltocAuditTx(ctx, tx, "tender", tenderID, action, map[string]any{
		"status": existing["status"],
	}, updates, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) createTenderMilestone(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	tenderID, err := altocIdentifierID(identifier, "tender_id")
	if err != nil {
		return nil, err
	}
	name := strings.TrimSpace(altocBodyText(body, "name"))
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_milestone_name", "milestone name is required")
	}
	operator := altocActor(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := lockTenderForWriteTx(ctx, tx, tenderID, body); err != nil {
		return nil, err
	}
	milestoneID, err := altocInsertRecordTx(ctx, tx, "tender_milestone", map[string]any{
		"tender_id":        tenderID,
		"name":             name,
		"due_date":         altocDateText(altocBodyText(body, "due_date")),
		"status":           "todo",
		"assignee_user_id": nullableText(altocBodyText(body, "assignee_user_id")),
		"sort_no":          numberValue(firstNonEmptyText(altocBodyText(body, "sort_no"), altocBodyText(body, "sortNo")), 0),
		"remark":           nullableText(altocBodyText(body, "remark")),
	})
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "tender", tenderID, "update", nil, map[string]any{
		"milestone_created": map[string]any{"id": milestoneID, "name": name},
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": milestoneID}, nil
}

func (a *Adapter) updateTenderMilestone(ctx context.Context, identifier string, body map[string]any) (any, error) {
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	tenderID, err := altocIdentifierID(identifier, "tender_id")
	if err != nil {
		return nil, err
	}
	milestoneID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "milestone_id"), altocBodyText(body, "milestoneId")))
	if milestoneID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_milestone_id", "milestone_id is required")
	}
	operator := altocActor(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := lockTenderForWriteTx(ctx, tx, tenderID, body); err != nil {
		return nil, err
	}
	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM tender_milestone
		WHERE id = ?
		  AND tender_id = ?
		LIMIT 1
		FOR UPDATE
	`, milestoneID, tenderID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusNotFound, "milestone_not_found", "milestone not found")
	}
	updates := tenderMilestoneUpdates(body)
	if len(updates) == 0 {
		return nil, nil
	}
	if err := updateTenderMilestoneTx(ctx, tx, milestoneID, updates); err != nil {
		return nil, err
	}
	action := "update"
	if status := strings.TrimSpace(fmt.Sprint(updates["status"])); status == "done" {
		action = "status_change"
	}
	if err := insertAltocAuditTx(ctx, tx, "tender", tenderID, action, map[string]any{
		"milestone_id": milestoneID,
		"status":       existing["status"],
	}, map[string]any{
		"milestone_id": milestoneID,
		"updates":      updates,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) addTenderMember(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	tenderID, err := altocIdentifierID(identifier, "tender_id")
	if err != nil {
		return nil, err
	}
	userID := strings.TrimSpace(firstNonEmptyText(altocBodyText(body, "user_id"), altocBodyText(body, "uid")))
	if userID == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_user_id", "user_id is required")
	}
	role := firstNonEmptyText(altocBodyText(body, "role"), "member")
	operator := altocActor(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := lockTenderForWriteTx(ctx, tx, tenderID, body); err != nil {
		return nil, err
	}
	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT id
		FROM tender_member
		WHERE tender_id = ?
		  AND user_id = ?
		LIMIT 1
	`, tenderID, userID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, httperror.New(http.StatusBadRequest, "tender_member_exists", "user is already in tender team")
	}
	memberID, err := altocInsertRecordTx(ctx, tx, "tender_member", map[string]any{
		"tender_id": tenderID,
		"user_id":   userID,
		"role":      role,
	})
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "tender", tenderID, "update", nil, map[string]any{
		"member": map[string]any{"id": memberID, "user_id": userID, "role": role},
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": memberID}, nil
}

func (a *Adapter) removeTenderMember(ctx context.Context, identifier string, body map[string]any) (any, error) {
	if err := altocRequireActionScope(body, "quotation", "edit"); err != nil {
		return nil, err
	}
	tenderID, err := altocIdentifierID(identifier, "tender_id")
	if err != nil {
		return nil, err
	}
	memberID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "member_id"), altocBodyText(body, "memberId")))
	if memberID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_member_id", "member_id is required")
	}
	operator := altocActor(body)

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := lockTenderForWriteTx(ctx, tx, tenderID, body); err != nil {
		return nil, err
	}
	existing, err := altocQueryOneMap(ctx, tx, `
		SELECT id, user_id, role
		FROM tender_member
		WHERE id = ?
		  AND tender_id = ?
		LIMIT 1
		FOR UPDATE
	`, memberID, tenderID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusNotFound, "member_not_found", "member not found")
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM tender_member WHERE id = ? AND tender_id = ?", memberID, tenderID); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "tender", tenderID, "update", map[string]any{
		"member": existing,
	}, map[string]any{
		"member": nil,
	}, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return nil, nil
}

func tenderWhereParts(query url.Values) ([]string, []any) {
	where := []string{"t.deleted_at IS NULL"}
	args := make([]any, 0)
	if keyword := strings.TrimSpace(firstNonEmptyText(query.Get("keyword"), query.Get("search"), query.Get("q"))); keyword != "" {
		where = append(where, `(
			t.name LIKE ? ESCAPE '\\'
			OR t.code LIKE ? ESCAPE '\\'
			OR t.project_code LIKE ? ESCAPE '\\'
			OR c.name LIKE ? ESCAPE '\\'
			OR o.name LIKE ? ESCAPE '\\'
		)`)
		for i := 0; i < 5; i++ {
			args = append(args, altocLikeKeyword(keyword))
		}
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "t.status = ?")
		args = append(args, status)
	}
	if opportunityID := strings.TrimSpace(query.Get("opportunity_id")); opportunityID != "" {
		where = append(where, "t.opportunity_id = ?")
		args = append(args, opportunityID)
	}
	if customerID := strings.TrimSpace(query.Get("customer_id")); customerID != "" {
		where = append(where, "t.customer_id = ?")
		args = append(args, customerID)
	}
	if owner := strings.TrimSpace(query.Get("owner_user_id")); owner != "" {
		where = append(where, "t.owner_user_id = ?")
		args = append(args, owner)
	}
	return where, args
}

func tenderOrderBy(query url.Values) string {
	order := altocSortDirection(query)
	switch strings.TrimSpace(query.Get("sort")) {
	case "bid_submission_deadline":
		return "t.bid_submission_deadline " + order + ", t.id " + order
	case "created_at":
		return "t.created_at " + order + ", t.id " + order
	case "name":
		return "t.name " + order + ", t.id " + order
	default:
		return "t.updated_at " + order + ", t.id " + order
	}
}

func tenderDetailSQL(whereSQL string) string {
	return `
		SELECT
		  t.*,
		  c.name AS customer_name,
		  o.name AS opportunity_name,
		  a.name AS agency_name,
		  a.agency_type AS agency_type_val,
		  a.address AS agency_address,
		  a.contact_name AS agency_contact_name,
		  a.contact_phone AS agency_contact_phone,
		  a.contact_email AS agency_contact_email,
		  ct.name AS contact_name_val,
		  ct.mobile AS contact_mobile_val
		FROM tender t
		LEFT JOIN customer c ON t.customer_id = c.id
		LEFT JOIN opportunity o ON t.opportunity_id = o.id
		LEFT JOIN tender_agency a ON t.agency_id = a.id
		LEFT JOIN contact ct ON t.contact_id = ct.id
		WHERE ` + whereSQL + `
		LIMIT 1
	`
}

func (a *Adapter) attachTenderChildren(ctx context.Context, tender map[string]any) error {
	tenderID := tender["id"]
	milestones, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM tender_milestone
		WHERE tender_id = ?
		ORDER BY sort_no ASC, due_date ASC, id ASC
	`, tenderID)
	if err != nil {
		return err
	}
	members, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM tender_member
		WHERE tender_id = ?
		ORDER BY FIELD(role, 'pm', 'business', 'presales', 'technical', 'finance', 'member'), id ASC
	`, tenderID)
	if err != nil {
		return err
	}
	tender["milestones"] = milestones
	tender["members"] = members
	return nil
}

func tenderOpportunityForCreateTx(ctx context.Context, tx *sql.Tx, body map[string]any, opportunityID int64) (map[string]any, error) {
	filters := []string{"op.id = ?", "op.deleted_at IS NULL"}
	args := []any{opportunityID}
	scopeWhere, scopeArgs, err := altocReadScopeWhereFromBody(body, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	opportunity, err := altocQueryOneMap(ctx, tx, `
		SELECT op.*
		FROM opportunity op
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "opportunity_not_found", "opportunity not found")
	}
	return opportunity, nil
}

func (a *Adapter) upsertTenderAgencyTx(ctx context.Context, tx *sql.Tx, body map[string]any) (any, error) {
	agencyID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "agency_id"), altocBodyText(body, "agencyId")))
	if agencyID > 0 {
		return agencyID, nil
	}
	name := firstNonEmptyText(altocBodyText(body, "agency_name"), altocBodyText(body, "name"))
	if name == "" {
		return nil, nil
	}
	existing, err := altocQueryOneMap(ctx, tx, "SELECT id FROM tender_agency WHERE name = ? LIMIT 1", name)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return existing["id"], nil
	}
	return altocInsertRecordTx(ctx, tx, "tender_agency", map[string]any{
		"name":          name,
		"agency_type":   nullableText(altocBodyText(body, "agency_type")),
		"address":       nullableText(firstNonEmptyText(altocBodyText(body, "agency_address"), altocBodyText(body, "address"))),
		"contact_name":  nullableText(firstNonEmptyText(altocBodyText(body, "agency_contact_name"), altocBodyText(body, "contact_name"))),
		"contact_phone": nullableText(firstNonEmptyText(altocBodyText(body, "agency_contact_phone"), altocBodyText(body, "contact_phone"))),
		"contact_email": nullableText(firstNonEmptyText(altocBodyText(body, "agency_contact_email"), altocBodyText(body, "contact_email"))),
	})
}

func tenderCreateFields(body map[string]any, code string, customerID int64, agencyID any, operator string) (map[string]any, error) {
	name := strings.TrimSpace(altocBodyText(body, "name"))
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "missing_tender_name", "tender name is required")
	}
	tenderType := firstNonEmptyText(altocBodyText(body, "tender_type"), "open")
	if err := validateTenderBudget(tenderType, bodyValueOrNil(body, "budget_amount")); err != nil {
		return nil, err
	}
	opportunityID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "opportunity_id"), altocBodyText(body, "opportunityId")))
	if opportunityID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_opportunity_id", "opportunity_id is required")
	}
	owner := firstNonEmptyText(altocBodyText(body, "owner_user_id"), operator)
	if owner == "" || owner == "system" {
		return nil, httperror.New(http.StatusBadRequest, "missing_owner_user_id", "owner_user_id is required")
	}
	return map[string]any{
		"code":                    code,
		"name":                    name,
		"opportunity_id":          opportunityID,
		"customer_id":             nullablePositiveID(fmt.Sprint(customerID)),
		"status":                  "info_gathering",
		"project_code":            nullableText(altocBodyText(body, "project_code")),
		"budget_amount":           nullableBodyValue(bodyValueOrNil(body, "budget_amount")),
		"tender_type":             nullableText(tenderType),
		"publish_date":            altocDateText(altocBodyText(body, "publish_date")),
		"registration_deadline":   altocDateText(altocBodyText(body, "registration_deadline")),
		"bid_submission_deadline": altocDateText(altocBodyText(body, "bid_submission_deadline")),
		"bid_opening_date":        altocDateText(altocBodyText(body, "bid_opening_date")),
		"bid_amount":              nullableBodyValue(bodyValueOrNil(body, "bid_amount")),
		"bid_bond_amount":         nullableBodyValue(bodyValueOrNil(body, "bid_bond_amount")),
		"owner_user_id":           owner,
		"presales_user_id":        nullableText(altocBodyText(body, "presales_user_id")),
		"tenderer_name":           nullableText(altocBodyText(body, "tenderer_name")),
		"agency_id":               agencyID,
		"contact_id":              nullablePositiveID(firstNonEmptyText(altocBodyText(body, "contact_id"), altocBodyText(body, "contactId"))),
		"contact_phone":           nullableText(altocBodyText(body, "contact_phone")),
		"contact_email":           nullableText(altocBodyText(body, "contact_email")),
		"competitors":             nullableText(altocBodyText(body, "competitors")),
		"key_requirements":        nullableText(altocBodyText(body, "key_requirements")),
		"remark":                  nullableText(altocBodyText(body, "remark")),
		"created_by":              nullableText(operator),
		"updated_by":              nullableText(operator),
	}, nil
}

func tenderUpdateFields(body map[string]any, existing map[string]any, operator string) (map[string]any, error) {
	updates := make(map[string]any)
	for _, field := range []string{
		"name",
		"opportunity_id",
		"customer_id",
		"project_code",
		"budget_amount",
		"tender_type",
		"publish_date",
		"registration_deadline",
		"bid_submission_deadline",
		"bid_opening_date",
		"winning_notice_date",
		"bid_amount",
		"bid_bond_amount",
		"owner_user_id",
		"presales_user_id",
		"tenderer_name",
		"agency_id",
		"contact_id",
		"contact_phone",
		"contact_email",
		"competitors",
		"key_requirements",
		"winning_amount",
		"lost_to",
		"lost_to_amount",
		"lost_reason_type",
		"lost_reason_detail",
		"improvement_suggestion",
		"remark",
	} {
		if value, ok := altocBodyValue(body, field); ok {
			updates[field] = normalizeTenderField(field, value)
		}
	}
	if status := strings.TrimSpace(altocBodyText(body, "status")); status != "" {
		if !tenderStatuses[status] {
			return nil, httperror.New(http.StatusBadRequest, "invalid_tender_status", "tender status is invalid")
		}
		updates["status"] = status
		if status == "review_done" {
			reviewBy := firstNonEmptyText(altocBodyText(body, "review_by"), operator)
			updates["review_by"] = nullableText(reviewBy)
			updates["review_at"] = sqlLiteral("CURRENT_TIMESTAMP")
		}
	}
	nextType := firstNonEmptyText(textFromUpdate(updates, "tender_type"), altocMapText(existing, "tender_type"))
	nextBudget := valueFromUpdate(updates, existing, "budget_amount")
	if err := validateTenderBudget(nextType, nextBudget); err != nil {
		return nil, err
	}
	if len(updates) > 0 {
		updates["updated_by"] = nullableText(operator)
		updates["updated_at"] = sqlLiteral("CURRENT_TIMESTAMP")
	}
	return updates, nil
}

func tenderMilestoneUpdates(body map[string]any) map[string]any {
	updates := make(map[string]any)
	for _, field := range []string{"name", "due_date", "status", "assignee_user_id", "remark"} {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		switch field {
		case "due_date":
			updates[field] = altocDateText(strings.TrimSpace(fmt.Sprint(value)))
		case "assignee_user_id", "remark":
			updates[field] = nullableBodyValue(value)
		default:
			updates[field] = nullableBodyValue(value)
		}
	}
	if status, ok := updates["status"]; ok {
		if strings.TrimSpace(fmt.Sprint(status)) == "done" {
			updates["completed_at"] = sqlLiteral("CURRENT_TIMESTAMP")
		} else {
			updates["completed_at"] = nil
		}
	}
	return updates
}

func validateTenderBudget(tenderType string, budget any) error {
	if strings.TrimSpace(tenderType) != "framework" && moneyValue(budget) <= 0 {
		return httperror.New(http.StatusBadRequest, "invalid_tender_budget", "budget_amount must be positive unless tender_type is framework")
	}
	return nil
}

func normalizeTenderField(field string, value any) any {
	switch field {
	case "opportunity_id", "customer_id", "agency_id", "contact_id":
		return nullablePositiveID(fmt.Sprint(value))
	case "publish_date", "registration_deadline", "bid_submission_deadline", "bid_opening_date", "winning_notice_date":
		return altocDateText(strings.TrimSpace(fmt.Sprint(value)))
	default:
		return nullableBodyValue(value)
	}
}

func updateTenderRecordTx(ctx context.Context, tx *sql.Tx, tenderID int64, updates map[string]any) error {
	set, args := assignmentParts(updates)
	args = append(args, tenderID)
	_, err := tx.ExecContext(ctx, "UPDATE tender SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

func updateTenderMilestoneTx(ctx context.Context, tx *sql.Tx, milestoneID int64, updates map[string]any) error {
	set, args := assignmentParts(updates)
	args = append(args, milestoneID)
	_, err := tx.ExecContext(ctx, "UPDATE tender_milestone SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}

type sqlLiteral string

func assignmentParts(updates map[string]any) ([]string, []any) {
	names := make([]string, 0, len(updates))
	for name := range updates {
		names = append(names, name)
	}
	sort.Strings(names)
	set := make([]string, 0, len(names))
	args := make([]any, 0, len(names))
	for _, name := range names {
		if literal, ok := updates[name].(sqlLiteral); ok {
			set = append(set, altocQuoteID(name)+" = "+string(literal))
			continue
		}
		set = append(set, altocQuoteID(name)+" = ?")
		args = append(args, altocNormalizeInsertValue(updates[name]))
	}
	return set, args
}

func lockTenderForWriteTx(ctx context.Context, tx *sql.Tx, tenderID int64, body map[string]any) (map[string]any, error) {
	tender, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM tender
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, tenderID)
	if err != nil {
		return nil, err
	}
	if tender == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "tender not found")
	}
	return tender, altocRequireRecordWrite(body, "quotation", tender, "owner_user_id", "")
}

func bodyValueOrNil(body map[string]any, field string) any {
	value, ok := altocBodyValue(body, field)
	if !ok {
		return nil
	}
	return value
}

func valueFromUpdate(updates map[string]any, existing map[string]any, field string) any {
	if value, ok := updates[field]; ok {
		return value
	}
	if existing == nil {
		return nil
	}
	return existing[field]
}

func textFromUpdate(updates map[string]any, field string) string {
	if value, ok := updates[field]; ok {
		return strings.TrimSpace(fmt.Sprint(value))
	}
	return ""
}
