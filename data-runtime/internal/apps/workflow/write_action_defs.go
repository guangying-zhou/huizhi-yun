package workflow

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type SyncAction struct {
	ResourceCode    string `json:"resourceCode"`
	ActionCode      string `json:"actionCode"`
	Name            string `json:"name"`
	Description     string `json:"description,omitempty"`
	FormSchemaCode  string `json:"formSchemaCode,omitempty"`
	Icon            string `json:"icon,omitempty"`
	EmbedURLPattern string `json:"embedUrlPattern,omitempty"`
	SortOrder       int    `json:"sortOrder,omitempty"`
	Enabled         *bool  `json:"enabled,omitempty"`
}

type SyncActionDefsRequest struct {
	AppCode string       `json:"appCode"`
	Actions []SyncAction `json:"actions"`
}

type SyncActionDefsResult struct {
	Created    int      `json:"created"`
	Updated    int      `json:"updated"`
	Deprecated int      `json:"deprecated"`
	Errors     []string `json:"errors"`
}

type SyncActionDefsResponse struct {
	Code int                  `json:"code"`
	Data SyncActionDefsResult `json:"data"`
}

type actionDefRow struct {
	ID              int64
	ResourceCode    string
	ActionCode      string
	Name            string
	Description     sql.NullString
	FormSchemaID    sql.NullInt64
	Icon            sql.NullString
	EmbedURLPattern sql.NullString
	SortOrder       int
	Status          int
	Source          string
}

func (a *Adapter) SyncActionDefs(ctx context.Context, rawBody map[string]any) (SyncActionDefsResponse, error) {
	var request SyncActionDefsRequest
	encoded, err := json.Marshal(rawBody)
	if err != nil {
		return SyncActionDefsResponse{}, err
	}
	if err := json.Unmarshal(encoded, &request); err != nil {
		return SyncActionDefsResponse{}, httperror.New(http.StatusBadRequest, "invalid_json", "Invalid action definition sync body")
	}

	if request.AppCode == "" || request.Actions == nil {
		return SyncActionDefsResponse{}, httperror.New(http.StatusBadRequest, "field_required", "appCode and actions are required")
	}

	result := SyncActionDefsResult{Errors: []string{}}

	existing, err := a.actionDefsByApp(ctx, request.AppCode)
	if err != nil {
		return SyncActionDefsResponse{}, err
	}

	manifestKeys := map[string]bool{}

	for _, action := range request.Actions {
		if action.ResourceCode == "" || action.ActionCode == "" || action.Name == "" {
			result.Errors = append(result.Errors, "缺少必填字段："+action.ResourceCode+":"+action.ActionCode)
			continue
		}

		key := action.ResourceCode + ":" + action.ActionCode
		manifestKeys[key] = true

		formSchemaID, err := a.lookupFormSchemaID(ctx, action.FormSchemaCode)
		if err != nil {
			return SyncActionDefsResponse{}, err
		}
		if action.FormSchemaCode != "" && !formSchemaID.Valid {
			result.Errors = append(result.Errors, "表单 schema 不存在："+action.FormSchemaCode+"（动作："+key+"）")
			continue
		}

		status := 1
		if action.Enabled != nil && !*action.Enabled {
			status = 0
		}

		if row, ok := existing[key]; ok {
			if actionDefNeedsUpdate(row, action, formSchemaID, status) {
				if err := a.updateActionDef(ctx, row.ID, action, formSchemaID, status); err != nil {
					return SyncActionDefsResponse{}, err
				}
				result.Updated++
			}
			continue
		}

		if err := a.insertActionDef(ctx, request.AppCode, action, formSchemaID, status); err != nil {
			return SyncActionDefsResponse{}, err
		}
		result.Created++
	}

	for key, row := range existing {
		if !manifestKeys[key] && row.Status == 1 && row.Source == "sync" {
			if _, err := a.db.ExecContext(ctx, "UPDATE flow_action_defs SET status = 0, updated_at = NOW() WHERE id = ?", row.ID); err != nil {
				return SyncActionDefsResponse{}, err
			}
			result.Deprecated++
		}
	}

	return SyncActionDefsResponse{Code: 0, Data: result}, nil
}

func (a *Adapter) actionDefsByApp(ctx context.Context, appCode string) (map[string]actionDefRow, error) {
	rows, err := a.db.QueryContext(ctx, `
		SELECT id, resource_code, action_code, name, description, form_schema_id,
		       icon, embed_url_pattern, sort_order, status, source
		FROM flow_action_defs
		WHERE app_code = ?
	`, appCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]actionDefRow{}
	for rows.Next() {
		var row actionDefRow
		if err := rows.Scan(
			&row.ID,
			&row.ResourceCode,
			&row.ActionCode,
			&row.Name,
			&row.Description,
			&row.FormSchemaID,
			&row.Icon,
			&row.EmbedURLPattern,
			&row.SortOrder,
			&row.Status,
			&row.Source,
		); err != nil {
			return nil, err
		}
		result[row.ResourceCode+":"+row.ActionCode] = row
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (a *Adapter) lookupFormSchemaID(ctx context.Context, code string) (sql.NullInt64, error) {
	if code == "" {
		return sql.NullInt64{}, nil
	}

	var id int64
	err := a.db.QueryRowContext(ctx, "SELECT id FROM form_schemas WHERE code = ? AND status = 1 LIMIT 1", code).Scan(&id)
	if err == sql.ErrNoRows {
		return sql.NullInt64{}, nil
	}
	if err != nil {
		return sql.NullInt64{}, err
	}
	return sql.NullInt64{Int64: id, Valid: true}, nil
}

func actionDefNeedsUpdate(row actionDefRow, action SyncAction, formSchemaID sql.NullInt64, status int) bool {
	return row.Name != action.Name ||
		nullStringValue(row.Description) != action.Description ||
		!sameNullInt64(row.FormSchemaID, formSchemaID) ||
		nullStringValue(row.Icon) != action.Icon ||
		nullStringValue(row.EmbedURLPattern) != action.EmbedURLPattern ||
		row.SortOrder != action.SortOrder ||
		row.Status != status
}

func (a *Adapter) updateActionDef(ctx context.Context, id int64, action SyncAction, formSchemaID sql.NullInt64, status int) error {
	_, err := a.db.ExecContext(ctx, `
		UPDATE flow_action_defs
		SET name = ?, description = ?, form_schema_id = ?, icon = ?,
		    embed_url_pattern = ?, sort_order = ?, status = ?, source = 'sync', updated_at = NOW()
		WHERE id = ?
	`,
		action.Name,
		nilIfEmpty(action.Description),
		nullInt64Value(formSchemaID),
		nilIfEmpty(action.Icon),
		nilIfEmpty(action.EmbedURLPattern),
		action.SortOrder,
		status,
		id,
	)
	return err
}

func (a *Adapter) insertActionDef(ctx context.Context, appCode string, action SyncAction, formSchemaID sql.NullInt64, status int) error {
	_, err := a.db.ExecContext(ctx, `
		INSERT INTO flow_action_defs
		  (app_code, resource_code, action_code, name, description, form_schema_id,
		   icon, embed_url_pattern, sort_order, status, source, created_by, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sync', 'system', NOW(), NOW())
	`,
		appCode,
		action.ResourceCode,
		action.ActionCode,
		action.Name,
		nilIfEmpty(action.Description),
		nullInt64Value(formSchemaID),
		nilIfEmpty(action.Icon),
		nilIfEmpty(action.EmbedURLPattern),
		action.SortOrder,
		status,
	)
	return err
}

func nilIfEmpty(value string) any {
	if value == "" {
		return nil
	}
	return value
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func nullInt64Value(value sql.NullInt64) any {
	if !value.Valid {
		return nil
	}
	return value.Int64
}

func sameNullInt64(left sql.NullInt64, right sql.NullInt64) bool {
	if left.Valid != right.Valid {
		return false
	}
	if !left.Valid {
		return true
	}
	return left.Int64 == right.Int64
}
