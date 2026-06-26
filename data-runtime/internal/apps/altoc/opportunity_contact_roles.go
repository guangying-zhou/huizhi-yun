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

func (a *Adapter) scopedOpportunity(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(identifier, "opportunity_id")
	if err != nil {
		return nil, err
	}
	filters := []string{"op.id = ?", "op.deleted_at IS NULL"}
	args := []any{opportunityID}
	scopeWhere, scopeArgs, err := altocReadScopeWhere(query, "opportunity", "op", "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	filters = append(filters, scopeWhere...)
	args = append(args, scopeArgs...)
	opportunity, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT op.*
		FROM opportunity op
		WHERE `+strings.Join(filters, " AND ")+`
		LIMIT 1
	`, args...)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}
	return opportunity, nil
}

func lockOpportunityForWriteTx(ctx context.Context, tx *sql.Tx, opportunityID int64, body map[string]any) (map[string]any, error) {
	opportunity, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity
		WHERE id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID)
	if err != nil {
		return nil, err
	}
	if opportunity == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "opportunity not found")
	}
	if err := altocRequireRecordWrite(body, "opportunity", opportunity, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "opportunity", "edit"); err != nil {
		return nil, err
	}
	return opportunity, nil
}

func (a *Adapter) listOpportunityActivities(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	opportunity, err := a.scopedOpportunity(ctx, identifier, query)
	if err != nil {
		return nil, err
	}
	page := altocGetPageParams(query)
	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM sales_activity
		WHERE opportunity_id = ?
		  AND deleted_at IS NULL
	`, opportunity["id"]).Scan(&total); err != nil {
		return nil, err
	}
	items, err := altocQueryMaps(ctx, a.DB(), `
		SELECT *
		FROM sales_activity
		WHERE opportunity_id = ?
		  AND deleted_at IS NULL
		ORDER BY activity_at DESC, id DESC
		LIMIT ? OFFSET ?
	`, opportunity["id"], page.pageSize, page.offset)
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

func (a *Adapter) listOpportunityContactRoles(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	opportunity, err := a.scopedOpportunity(ctx, identifier, query)
	if err != nil {
		return nil, err
	}
	page := altocGetPageParams(query)
	var total int64
	if err := a.DB().QueryRowContext(ctx, `
		SELECT COUNT(*) AS total
		FROM opportunity_contact_role
		WHERE opportunity_id = ?
		  AND deleted_at IS NULL
	`, opportunity["id"]).Scan(&total); err != nil {
		return nil, err
	}
	items, err := opportunityContactRoleRows(ctx, a.DB(), opportunity["id"], "LIMIT ? OFFSET ?", page.pageSize, page.offset)
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

func (a *Adapter) getOpportunityContactRole(ctx context.Context, opportunityIdentifier string, roleIdentifier string, query url.Values) (map[string]any, error) {
	opportunity, err := a.scopedOpportunity(ctx, opportunityIdentifier, query)
	if err != nil {
		return nil, err
	}
	roleID, err := altocIdentifierID(roleIdentifier, "contact_role_id")
	if err != nil {
		return nil, err
	}
	role, err := opportunityContactRoleByID(ctx, a.DB(), opportunity["id"], roleID)
	if err != nil {
		return nil, err
	}
	if role == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contact role not found")
	}
	return role, nil
}

func (a *Adapter) createOpportunityContactRole(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(identifier, "opportunity_id")
	if err != nil {
		return nil, err
	}
	contactID := altocPositiveID(firstNonEmptyText(firstBodyText(body, "contactId", "contact_id")))
	if contactID <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "missing_contact_id", "contact_id is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	opportunity, err := lockOpportunityForWriteTx(ctx, tx, opportunityID, body)
	if err != nil {
		return nil, err
	}
	contact, err := contactForOpportunityTx(ctx, tx, contactID, opportunity["customer_id"])
	if err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := a.recordOpportunityContactRoleTx(ctx, tx, opportunityID, contact, body, operator); err != nil {
		return nil, err
	}
	role, err := opportunityContactRoleByContactTx(ctx, tx, opportunityID, contactID)
	if err != nil {
		return nil, err
	}
	if role == nil {
		return nil, httperror.New(http.StatusInternalServerError, "schema_mismatch", "opportunity contact role was not recorded")
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity_contact_role", role["id"], "upsert", nil, role, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"contact_role": role, "id": role["id"]}, nil
}

func (a *Adapter) updateOpportunityContactRole(ctx context.Context, opportunityIdentifier string, roleIdentifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(opportunityIdentifier, "opportunity_id")
	if err != nil {
		return nil, err
	}
	roleID, err := altocIdentifierID(roleIdentifier, "contact_role_id")
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := lockOpportunityForWriteTx(ctx, tx, opportunityID, body); err != nil {
		return nil, err
	}
	existing, err := lockOpportunityContactRoleTx(ctx, tx, opportunityID, roleID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contact role not found")
	}
	operator := altocActor(body)
	updates := opportunityContactRoleUpdates(body)
	if isPrimary, ok := updates["is_primary"]; ok && altocBool(isPrimary) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE opportunity_contact_role
			SET is_primary = 0,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE opportunity_id = ?
			  AND id <> ?
			  AND deleted_at IS NULL
		`, operator, opportunityID, roleID); err != nil {
			return nil, err
		}
	}
	if len(updates) > 0 {
		if err := updateOpportunityContactRoleTx(ctx, tx, roleID, updates, operator); err != nil {
			return nil, err
		}
	}
	updated, err := opportunityContactRoleByIDTx(ctx, tx, opportunityID, roleID)
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity_contact_role", roleID, "update", existing, updated, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"contact_role": updated, "changed": len(updates) > 0}, nil
}

func (a *Adapter) deleteOpportunityContactRole(ctx context.Context, opportunityIdentifier string, roleIdentifier string, body map[string]any) (map[string]any, error) {
	opportunityID, err := altocIdentifierID(opportunityIdentifier, "opportunity_id")
	if err != nil {
		return nil, err
	}
	roleID, err := altocIdentifierID(roleIdentifier, "contact_role_id")
	if err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	if _, err := lockOpportunityForWriteTx(ctx, tx, opportunityID, body); err != nil {
		return nil, err
	}
	existing, err := lockOpportunityContactRoleTx(ctx, tx, opportunityID, roleID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contact role not found")
	}
	operator := altocActor(body)
	if _, err := tx.ExecContext(ctx, `
		UPDATE opportunity_contact_role
		SET deleted_at = CURRENT_TIMESTAMP,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, operator, roleID); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "opportunity_contact_role", roleID, "delete", existing, nil, operator); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"deleted": true, "id": roleID}, nil
}

func contactForOpportunityTx(ctx context.Context, tx *sql.Tx, contactID int64, customerID any) (map[string]any, error) {
	contact, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contact
		WHERE id = ?
		  AND customer_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, contactID, customerID)
	if err != nil {
		return nil, err
	}
	if contact == nil {
		return nil, httperror.New(http.StatusNotFound, "contact_not_found", "contact not found under opportunity customer")
	}
	return contact, nil
}

func opportunityContactRoleRows(ctx context.Context, conn altocQueryer, opportunityID any, suffix string, args ...any) ([]map[string]any, error) {
	queryArgs := append([]any{opportunityID}, args...)
	return altocQueryMaps(ctx, conn, `
		SELECT
		  ocr.*,
		  ct.name AS contact_name,
		  ct.mobile AS contact_mobile,
		  ct.email AS contact_email,
		  ct.job_title AS contact_job_title,
		  ct.dept_name AS contact_dept_name
		FROM opportunity_contact_role ocr
		LEFT JOIN contact ct ON ct.id = ocr.contact_id
		WHERE ocr.opportunity_id = ?
		  AND ocr.deleted_at IS NULL
		ORDER BY ocr.is_primary DESC, ocr.id ASC
		`+suffix, queryArgs...)
}

func opportunityContactRoleByID(ctx context.Context, conn altocQueryer, opportunityID any, roleID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, conn, `
		SELECT
		  ocr.*,
		  ct.name AS contact_name,
		  ct.mobile AS contact_mobile,
		  ct.email AS contact_email,
		  ct.job_title AS contact_job_title,
		  ct.dept_name AS contact_dept_name
		FROM opportunity_contact_role ocr
		LEFT JOIN contact ct ON ct.id = ocr.contact_id
		WHERE ocr.opportunity_id = ?
		  AND ocr.id = ?
		  AND ocr.deleted_at IS NULL
		LIMIT 1
	`, opportunityID, roleID)
}

func opportunityContactRoleByIDTx(ctx context.Context, tx *sql.Tx, opportunityID any, roleID int64) (map[string]any, error) {
	return opportunityContactRoleByID(ctx, tx, opportunityID, roleID)
}

func opportunityContactRoleByContactTx(ctx context.Context, tx *sql.Tx, opportunityID any, contactID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity_contact_role
		WHERE opportunity_id = ?
		  AND contact_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, opportunityID, contactID)
}

func lockOpportunityContactRoleTx(ctx context.Context, tx *sql.Tx, opportunityID int64, roleID int64) (map[string]any, error) {
	return altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM opportunity_contact_role
		WHERE opportunity_id = ?
		  AND id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, opportunityID, roleID)
}

func opportunityContactRoleUpdates(body map[string]any) map[string]any {
	updates := map[string]any{}
	for _, field := range []string{"role", "influence_level", "attitude", "is_primary", "remark"} {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		if field == "is_primary" {
			updates[field] = altocBool(value)
			continue
		}
		text := strings.TrimSpace(fmt.Sprint(value))
		if text == "" || text == "<nil>" {
			updates[field] = nil
		} else {
			updates[field] = text
		}
	}
	return updates
}

func updateOpportunityContactRoleTx(ctx context.Context, tx *sql.Tx, roleID int64, updates map[string]any, operator string) error {
	columns, err := altocTableColumns(ctx, tx, "opportunity_contact_role")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(updates))
	for name := range updates {
		if columns[name] {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return nil
	}
	set := make([]string, 0, len(names)+2)
	args := make([]any, 0, len(names)+2)
	for _, name := range names {
		set = append(set, altocQuoteID(name)+" = ?")
		args = append(args, altocNormalizeInsertValue(updates[name]))
	}
	if columns["updated_by"] {
		set = append(set, "updated_by = ?")
		args = append(args, nullableText(operator))
	}
	if columns["updated_at"] {
		set = append(set, "updated_at = CURRENT_TIMESTAMP")
	}
	args = append(args, roleID)
	_, err = tx.ExecContext(ctx, "UPDATE opportunity_contact_role SET "+strings.Join(set, ", ")+" WHERE id = ?", args...)
	return err
}
