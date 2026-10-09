package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"time"
)

const directoryRecoveryFamily = "tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND target_app='console' AND source_biz_type='employee' AND operation_code IN ('people.directory.employment-sync.v1','people.directory.offboarding-disable.v1')"

var directoryRecoveryColumns = []string{"operation_id", "operation_code", "source_biz_code", "status", "attempt_count", "max_attempts", "version_no", "replay_count", "last_http_status", "updated_at"}

func directoryRecoveryProjection(row map[string]any) map[string]any {
	out := map[string]any{}
	for _, k := range directoryRecoveryColumns {
		out[k] = row[k]
	}
	return out
}
func (s PeopleFactsService) DirectoryRecovery(ctx context.Context, op string, i people.EnterpriseFactsInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() { err = factsMapError(err) }()
	if err = people.ValidateDirectoryRecoveryInput(op, i); err != nil {
		return nil, err
	}
	if scope.Validate() != nil || scope.Access != "all" || len(scope.DepartmentCodes) != 0 || who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return nil, httperror.New(403, "people_recovery_permission_denied", "Tenant-global operation permission required")
	}
	if s.Registry == nil || !domaininstall.IsPeopleFactsDomain(s.Binding.Domains["people"]) {
		return nil, httperror.New(503, "people_recovery_unavailable", "People recovery unavailable")
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	write := op == "directory-operations-replay"
	if write {
		if who.Key == "" {
			return nil, httperror.New(400, "people_key_required", "Key required")
		}
		tx, resolved, err = s.Registry.BeginWriteTransaction(ctx, s.request("people", enterprise.Write))
	} else {
		tx, resolved, err = s.Registry.BeginSnapshotReadTransaction(ctx, s.request("people", enterprise.Read))
	}
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	r := resolved[0]
	operations, err := r.Table("integration_operation")
	if err != nil {
		return nil, err
	}
	if op == "directory-operations-list" {
		var total int
		if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+operations+" WHERE "+directoryRecoveryFamily, who.Tenant, who.Deployment).Scan(&total); err != nil {
			return nil, err
		}
		rows, e := tx.QueryContext(ctx, "SELECT operation_id,operation_code,source_biz_code,status,attempt_count,max_attempts,version_no,replay_count,last_http_status,updated_at FROM "+operations+" WHERE "+directoryRecoveryFamily+" ORDER BY updated_at DESC,operation_id DESC LIMIT ? OFFSET ?", who.Tenant, who.Deployment, i.PageSize, (i.Page-1)*i.PageSize)
		if e != nil {
			return nil, e
		}
		data, e := people.MasterRows(rows, directoryRecoveryColumns)
		if e != nil {
			return nil, e
		}
		out = map[string]any{"data": data, "total": total, "page": i.Page, "pageSize": i.PageSize}
	} else {
		// FactsRowTx locks the immutable source/family before receipt replay or mutation.
		row, e := people.FactsRowTx(ctx, tx, operations, directoryRecoveryFamily+" AND operation_id=?", who.Tenant, who.Deployment, i.ID)
		if e != nil {
			return nil, e
		}
		var cmd map[string]any
		if e = json.Unmarshal([]byte(fmt.Sprint(row["command_json"])), &cmd); e != nil {
			return nil, e
		}
		digest, e := integrationoperation.ValidateAndDigestCommand(cmd)
		if e != nil || digest != row["command_sha256"] || cmd["employeeUid"] != row["source_biz_code"] {
			return nil, httperror.New(409, "people_recovery_command_invalid", "Frozen command integrity invalid")
		}
		expectedCapability := "console:directory-employment:sync"
		if row["operation_code"] == "people.directory.offboarding-disable.v1" {
			expectedCapability = "console:directory-offboarding:disable"
		}
		if row["required_capability"] != expectedCapability || cmd["originalActorUid"] == nil || fmt.Sprint(cmd["originalActorUid"]) == "" {
			return nil, httperror.New(409, "people_recovery_command_invalid", "Frozen target contract differs")
		}
		if write {
			names := []string{}
			for _, n := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"} {
				name, e := r.Table(n)
				if e != nil {
					return nil, e
				}
				names = append(names, name)
			}
			mapping, e := integrationoperation.NewOutboxTables(names[0], names[1], names[2], names[3])
			if e != nil {
				return nil, e
			}
			repo, e := integrationoperation.NewRepository(r.DB, integrationoperation.WithOutboxTables(mapping))
			if e != nil {
				return nil, e
			}
			out, err = s.receipt(ctx, tx, r, op, i, who, func() (map[string]any, error) {
				// Unknown/processing results cannot be forced to success or given a new key.
				result, e := repo.ReplayInTransaction(ctx, tx, integrationoperation.ReplayInput{TenantCode: who.Tenant, DeploymentCode: who.Deployment, SourceApp: "enterprise", OperationID: i.ID, ExpectedVersion: uint64(people.FactsVersion(i.Payload)), ActorUID: who.Actor, Reason: people.FactsString(i.Payload, "reason"), Now: time.Now().UTC()})
				if e == integrationoperation.ErrReplayRejected {
					return nil, httperror.New(409, "people_recovery_not_replayable", "Only terminal failures can be requeued with their original command")
				}
				if e != nil {
					return nil, e
				}
				return map[string]any{"id": i.ID, "row_version": result.Version}, nil
			})
			if err != nil {
				return nil, err
			}
		} else {
			out = map[string]any{"data": directoryRecoveryProjection(row), "frozen": map[string]any{"operationId": row["operation_id"], "operationKey": row["operation_key"], "operationCode": row["operation_code"], "requiredCapability": row["required_capability"], "idempotencyKey": row["idempotency_key"], "commandSha256": row["command_sha256"], "commandSchemaVersion": row["command_schema_version"], "tenantCode": who.Tenant, "deploymentCode": who.Deployment, "sourceApp": "enterprise", "targetApp": "console", "command": cmd}}
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}
