package console

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type fixedServiceGrant struct {
	resourceCode string
	audience     string
}

var aimsCodocsRuntimeReadGrants = []fixedServiceGrant{
	{resourceCode: "data-runtime:codocs", audience: "data-runtime"},
	{resourceCode: "tenant-runtime:codocs", audience: "tenant-runtime"},
}

// ReconcileAimsCodocsRuntimeReadGrant repairs one narrowly scoped production
// invariant. It deliberately accepts no client, resource, action, or scope
// input so callers cannot turn this operational repair into a generic grant
// mutation surface.
func (a *Adapter) ReconcileAimsCodocsRuntimeReadGrant(
	ctx context.Context,
	actorUID string,
	requestID string,
) (map[string]any, error) {
	actorUID = strings.TrimSpace(actorUID)
	if actorUID == "" {
		return nil, httperror.New(http.StatusForbidden, "trusted_console_admin_actor_required", "Trusted Console administrator actor is required")
	}

	tx, err := a.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var serviceClientID uint64
	var credentialID sql.NullInt64
	var status string
	err = tx.QueryRowContext(ctx, `
		SELECT id,current_credential_id,status
		FROM service_clients
		WHERE app_code='aims' AND client_code='aims.runtime'
		LIMIT 1 FOR UPDATE
	`).Scan(&serviceClientID, &credentialID, &status)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusConflict, "aims_runtime_service_client_missing", "Active credential-backed aims.runtime service client is required")
	}
	if err != nil {
		return nil, err
	}
	if status != "active" || !credentialID.Valid {
		return nil, httperror.New(http.StatusConflict, "aims_runtime_service_client_inactive", "Active credential-backed aims.runtime service client is required")
	}

	grantNames := make([]string, 0, len(aimsCodocsRuntimeReadGrants))
	for _, grant := range aimsCodocsRuntimeReadGrants {
		scopeJSON, marshalErr := json.Marshal(map[string]any{
			"source":        "runtime-repair:aims-codocs-runtime-read.v1",
			"semanticScope": "codocs.read",
			"purpose":       "aims-runtime-codocs-document-access-check",
			"audience":      grant.audience,
			"endpoints":     []string{"/v1/codocs/document-access/check"},
		})
		if marshalErr != nil {
			return nil, marshalErr
		}
		if _, err = tx.ExecContext(ctx, `
			INSERT INTO service_client_grants (
				service_client_id,resource_code,action,scope_json,status,created_at,updated_at
			) VALUES (?,?,'read',CAST(? AS JSON),'active',UTC_TIMESTAMP(),UTC_TIMESTAMP())
			ON DUPLICATE KEY UPDATE scope_json=VALUES(scope_json),status='active',updated_at=UTC_TIMESTAMP()
		`, serviceClientID, grant.resourceCode, string(scopeJSON)); err != nil {
			return nil, err
		}
		grantNames = append(grantNames, grant.resourceCode+":read")
	}

	detailJSON, err := json.Marshal(map[string]any{
		"repair": "aims-codocs-runtime-read.v1",
		"grants": grantNames,
	})
	if err != nil {
		return nil, err
	}
	if _, err = tx.ExecContext(ctx, `
		INSERT INTO operation_logs (
			domain_code,action,target_type,target_key,actor_type,actor_id,request_id,detail_json,created_at
		) VALUES ('service_client','reconcile_aims_codocs_runtime_read','service_client',
			'aims.runtime','human',?,?,CAST(? AS JSON),UTC_TIMESTAMP())
	`, actorUID, nullableLimitedString(requestID, 64), string(detailJSON)); err != nil {
		return nil, err
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}

	return map[string]any{
		"status":            "reconciled",
		"serviceClientCode": "aims.runtime",
		"grants":            grantNames,
	}, nil
}
