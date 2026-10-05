package altoc

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func (a *Adapter) listSalesTeams(ctx context.Context, query url.Values) ([]map[string]any, error) {
	where := make([]string, 0, 2)
	args := make([]any, 0, 2)
	if teamType := strings.TrimSpace(firstNonEmptyText(query.Get("team_type"), query.Get("teamType"))); teamType != "" {
		where = append(where, "t.team_type = ?")
		args = append(args, teamType)
	}
	if status := strings.TrimSpace(query.Get("status")); status != "" {
		where = append(where, "t.status = ?")
		args = append(args, status)
	} else {
		where = append(where, "t.status = 'active'")
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = "WHERE " + strings.Join(where, " AND ")
	}
	return altocQueryMaps(ctx, a.DB(), `
		SELECT t.*,
		       pt.name AS parent_name,
		       (
		         SELECT COUNT(*)
		         FROM sales_team_member m
		         WHERE m.team_id = t.id AND m.status = 'active'
		       ) AS member_count
		FROM sales_team t
		LEFT JOIN sales_team pt ON t.parent_id = pt.id
		`+whereSQL+`
		ORDER BY t.team_type ASC, t.id ASC
	`, args...)
}

func (a *Adapter) getSalesTeam(ctx context.Context, rawID string) (map[string]any, error) {
	teamID, err := altocIdentifierID(rawID, "team_id")
	if err != nil {
		return nil, err
	}
	team, err := altocQueryOneMap(ctx, a.DB(), `
		SELECT t.*, pt.name AS parent_name
		FROM sales_team t
		LEFT JOIN sales_team pt ON t.parent_id = pt.id
		WHERE t.id = ?
		LIMIT 1
	`, teamID)
	if err != nil {
		return nil, err
	}
	if team == nil {
		return nil, httperror.New(http.StatusNotFound, "team_not_found", "Team not found")
	}
	members, err := a.listSalesTeamMembers(ctx, teamID)
	if err != nil {
		return nil, err
	}
	children, err := altocQueryMaps(ctx, a.DB(), `
		SELECT id,
		       code,
		       name,
		       team_type,
		       status,
		       (
		         SELECT COUNT(*)
		         FROM sales_team_member m
		         WHERE m.team_id = sales_team.id AND m.status = 'active'
		       ) AS member_count
		FROM sales_team
		WHERE parent_id = ?
		ORDER BY id ASC
	`, teamID)
	if err != nil {
		return nil, err
	}
	team["members"] = members
	team["children"] = children
	return team, nil
}

func (a *Adapter) listSalesTeamUsers(ctx context.Context, query url.Values) ([]map[string]any, error) {
	teamID := altocPositiveID(firstNonEmptyText(query.Get("team_id"), query.Get("teamId")))
	if teamID == 0 {
		return []map[string]any{}, nil
	}
	return altocQueryMaps(ctx, a.DB(), `
		SELECT m.user_id AS uid, m.role
		FROM sales_team_member m
		WHERE m.team_id = ? AND m.status = 'active'
		ORDER BY FIELD(m.role, 'senior_manager', 'manager', 'assistant', 'member'), m.id ASC
	`, teamID)
}

func (a *Adapter) createSalesTeam(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "admin", "create"); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(altocBodyText(body, "name"))
	if name == "" {
		return nil, httperror.New(http.StatusBadRequest, "team_name_required", "Team name is required")
	}
	code := strings.TrimSpace(altocBodyText(body, "code"))
	if code == "" {
		return nil, httperror.New(http.StatusBadRequest, "team_code_required", "Team code is required")
	}
	teamType := firstNonEmptyText(altocBodyText(body, "team_type"), "sales")

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := altocQueryOneMap(ctx, tx, "SELECT id FROM sales_team WHERE code = ? LIMIT 1", code)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, httperror.New(http.StatusBadRequest, "team_code_exists", "Team code already exists")
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO sales_team (code, name, team_type, parent_id, leader_user_id, description, status)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`,
		code,
		name,
		teamType,
		nullableTeamID(body, "parent_id"),
		nullableText(altocBodyText(body, "leader_user_id")),
		nullableText(altocBodyText(body, "description")),
		"active",
	)
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	if err := insertAltocAuditTx(ctx, tx, "sales_team", id, "create", nil, map[string]any{
		"code":           code,
		"name":           name,
		"team_type":      teamType,
		"leader_user_id": nullableText(altocBodyText(body, "leader_user_id")),
	}, altocActor(body)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}

func (a *Adapter) updateSalesTeam(ctx context.Context, rawID string, body map[string]any) (any, error) {
	if err := altocRequireActionScope(body, "admin", "edit"); err != nil {
		return nil, err
	}
	teamID, err := altocIdentifierID(rawID, "team_id")
	if err != nil {
		return nil, err
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	existing, err := altocQueryOneMap(ctx, tx, "SELECT id, name, status FROM sales_team WHERE id = ? LIMIT 1", teamID)
	if err != nil {
		return nil, err
	}
	if existing == nil {
		return nil, httperror.New(http.StatusNotFound, "team_not_found", "Team not found")
	}

	fields := make([]string, 0, 6)
	args := make([]any, 0, 7)
	for _, field := range []string{"name", "team_type", "parent_id", "leader_user_id", "description", "status"} {
		value, ok := altocBodyValue(body, field)
		if !ok {
			continue
		}
		fields = append(fields, altocQuoteID(field)+" = ?")
		if field == "parent_id" {
			args = append(args, nullableTeamID(body, field))
		} else {
			args = append(args, nullableBodyValue(value))
		}
	}
	if len(fields) == 0 {
		return nil, nil
	}
	args = append(args, teamID)
	if _, err := tx.ExecContext(ctx, "UPDATE sales_team SET "+strings.Join(fields, ", ")+" WHERE id = ?", args...); err != nil {
		return nil, err
	}
	action := "update"
	if status := altocBodyText(body, "status"); status != "" && status != altocMapText(existing, "status") {
		action = "status_change"
	}
	if err := insertAltocAuditTx(ctx, tx, "sales_team", teamID, action, map[string]any{
		"name":   existing["name"],
		"status": existing["status"],
	}, body, altocActor(body)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) addSalesTeamMember(ctx context.Context, rawTeamID string, body map[string]any) (map[string]any, error) {
	if err := altocRequireActionScope(body, "admin", "edit"); err != nil {
		return nil, err
	}
	teamID, err := altocIdentifierID(rawTeamID, "team_id")
	if err != nil {
		return nil, err
	}
	userID := strings.TrimSpace(firstNonEmptyText(altocBodyText(body, "user_id"), altocBodyText(body, "uid")))
	if userID == "" {
		return nil, httperror.New(http.StatusBadRequest, "team_member_user_required", "User is required")
	}
	role := firstNonEmptyText(altocBodyText(body, "role"), "member")

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	team, err := altocQueryOneMap(ctx, tx, "SELECT id FROM sales_team WHERE id = ? LIMIT 1", teamID)
	if err != nil {
		return nil, err
	}
	if team == nil {
		return nil, httperror.New(http.StatusNotFound, "team_not_found", "Team not found")
	}
	existing, err := altocQueryOneMap(ctx, tx, "SELECT id FROM sales_team_member WHERE team_id = ? AND user_id = ? AND status = 'active' LIMIT 1", teamID, userID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, httperror.New(http.StatusBadRequest, "team_member_exists", "User is already in this team")
	}
	isPrimary, _ := altocBodyValue(body, "is_primary")
	result, err := tx.ExecContext(ctx, `
		INSERT INTO sales_team_member (team_id, user_id, role, is_primary, joined_at, status)
		VALUES (?, ?, ?, ?, CURDATE(), 'active')
	`, teamID, userID, role, boolishInt(isPrimary))
	if err != nil {
		return nil, err
	}
	id, _ := result.LastInsertId()
	if err := insertAltocAuditTx(ctx, tx, "sales_team_member", id, "create", nil, map[string]any{
		"team_id": teamID,
		"user_id": userID,
		"role":    role,
	}, altocActor(body)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{"id": id}, nil
}

func (a *Adapter) removeSalesTeamMember(ctx context.Context, rawTeamID string, body map[string]any) (any, error) {
	if err := altocRequireActionScope(body, "admin", "delete"); err != nil {
		return nil, err
	}
	teamID, err := altocIdentifierID(rawTeamID, "team_id")
	if err != nil {
		return nil, err
	}
	memberID := altocPositiveID(firstNonEmptyText(altocBodyText(body, "member_id"), altocBodyText(body, "memberId"), altocBodyText(body, "id")))
	if memberID == 0 {
		return nil, httperror.New(http.StatusBadRequest, "team_member_required", "Member is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `
		UPDATE sales_team_member
		SET status = 'inactive', left_at = CURDATE()
		WHERE id = ? AND team_id = ?
	`, memberID, teamID)
	if err != nil {
		return nil, err
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, httperror.New(http.StatusNotFound, "team_member_not_found", "Team member not found")
	}
	if err := insertAltocAuditTx(ctx, tx, "sales_team_member", memberID, "delete", map[string]any{
		"team_id": teamID,
	}, nil, altocActor(body)); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return nil, nil
}

func (a *Adapter) listSalesTeamMembers(ctx context.Context, teamID int64) ([]map[string]any, error) {
	return altocQueryMaps(ctx, a.DB(), `
		SELECT m.*
		FROM sales_team_member m
		WHERE m.team_id = ? AND m.status = 'active'
		ORDER BY FIELD(m.role, 'senior_manager', 'manager', 'assistant', 'member'), m.joined_at ASC, m.id ASC
	`, teamID)
}

func nullableTeamID(body map[string]any, key string) any {
	value, ok := altocBodyValue(body, key)
	if !ok {
		return nil
	}
	id := altocPositiveID(value)
	if id == 0 {
		return nil
	}
	return id
}

func boolishInt(value any) int {
	switch typed := value.(type) {
	case bool:
		if typed {
			return 1
		}
	case int:
		if typed != 0 {
			return 1
		}
	case int64:
		if typed != 0 {
			return 1
		}
	case float64:
		if typed != 0 {
			return 1
		}
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "y", "on":
			return 1
		}
	}
	return 0
}
