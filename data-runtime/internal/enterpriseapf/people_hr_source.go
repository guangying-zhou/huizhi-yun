package enterpriseapf

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/google/uuid"
	"github.com/huizhi-yun/data-runtime/internal/apps/altoc"
	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
	"strings"
)

func hrFrozenKey(who Identity, kind string) string {
	h := sha256.Sum256([]byte(who.Tenant + "\n" + who.Deployment + "\n" + who.Actor + "\n" + kind + "\n" + who.Key))
	return "enterprise.people.hr:" + hex.EncodeToString(h[:])
}

// HR metadata is a global administrative dictionary. A scoped employee grant
// never becomes authorization to remap the company's entire canonical tree.
func (s PeopleFactsService) HRSource(ctx context.Context, op string, i people.EnterpriseFactsInput, who Identity, scope altoc.BasicReadScope) (out any, err error) {
	defer func() { err = factsMapError(err) }()
	if err = people.ValidateHRSourceInput(op, i); err != nil {
		return nil, err
	}
	if scope.Access != "all" || len(scope.DepartmentCodes) != 0 || scope.Validate() != nil || who.Actor == "" || who.Client != "enterprise.runtime" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return nil, httperror.New(403, "people_hr_permission_denied", "Global HR permission required")
	}
	d := s.Binding.Domains["people"]
	if s.Registry == nil || !domaininstall.IsPeopleFactsDomain(d) || d.Tables["people_hr_source_state"] != "people_hr_source_state" {
		return nil, httperror.New(503, "people_hr_not_installed", "HR source state is not installed")
	}
	if op != "hr-state" && who.Key == "" {
		return nil, httperror.New(400, "people_hr_key_required", "Idempotency-Key required")
	}
	var tx *sql.Tx
	var resolved []enterprise.Resolved
	if op == "hr-state" {
		tx, resolved, err = s.Registry.BeginSnapshotReadTransaction(ctx, s.request("people", enterprise.Read))
	} else {
		tx, resolved, err = s.Registry.BeginRepeatableWriteTransaction(ctx, s.request("people", enterprise.Write))
	}
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	r := resolved[0]
	state, err := r.Table("people_hr_source_state")
	if err != nil {
		return nil, err
	}
	operations, err := r.Table("integration_operation")
	if err != nil {
		return nil, err
	}
	var version uint64
	var pending sql.NullString
	if op == "hr-state" {
		err = tx.QueryRowContext(ctx, "SELECT row_version,pending_key FROM "+state+" WHERE provider_code='dingtalk'").Scan(&version, &pending)
		if err == sql.ErrNoRows {
			version = 1
			err = nil
		}
		if err != nil {
			return nil, err
		}
		data := map[string]any{"rowVersion": version, "remapPending": pending.Valid, "operationKey": pending.String}
		if pending.Valid {
			rows, e := tx.QueryContext(ctx, "SELECT * FROM "+operations+" WHERE BINARY operation_key=BINARY ? AND BINARY original_actor_uid=BINARY ? AND service_client_id='enterprise.runtime' AND source_biz_type='hr_source'", pending.String, who.Actor)
			if e != nil {
				return nil, e
			}
			cols, e := rows.Columns()
			if e != nil {
				rows.Close()
				return nil, e
			}
			items, e := people.MasterRows(rows, cols)
			if e != nil {
				return nil, e
			}
			row := map[string]any{}
			if len(items) == 1 {
				row = items[0]
			} else {
				e = httperror.New(404, "people_hr_command_not_found", "Frozen command unavailable")
			}
			var he httperror.Error
			if e != nil && !(errors.As(e, &he) && he.Status == 404) {
				return nil, e
			}
			if e == nil {
				var cmd map[string]any
				if e = json.Unmarshal([]byte(fmt.Sprint(row["command_json"])), &cmd); e != nil {
					return nil, e
				}
				delete(cmd, "actorUid")
				for kind, contract := range people.HRSourceContracts {
					if row["operation_code"] == contract[1] {
						if kind == "jobs-start" {
							cmd = map[string]any{}
						}
						var v uint64
						fmt.Sscanf(fmt.Sprint(row["correlation_key"]), pending.String+":v%d", &v)
						if v == 0 {
							return nil, httperror.New(503, "people_hr_intent_invalid", "Invalid frozen intent")
						}
						data["resume"] = map[string]any{"kind": kind, "key": row["source_biz_code"], "expectedVersion": v, "command": cmd}
					}
				}
			}
		}
		out = map[string]any{"data": data}
		err = tx.Commit()
		return out, err
	}
	// Single durable source root prevents job-start from racing a new remap.
	_, err = tx.ExecContext(ctx, "INSERT INTO "+state+"(provider_code,row_version) VALUES('dingtalk',1) ON DUPLICATE KEY UPDATE provider_code=provider_code")
	if err != nil {
		return nil, err
	}
	err = tx.QueryRowContext(ctx, "SELECT row_version,pending_key FROM "+state+" WHERE provider_code='dingtalk' FOR UPDATE").Scan(&version, &pending)
	if err != nil {
		return nil, err
	}
	kind := people.HRSourceKind(op)
	contract := people.HRSourceContracts[kind]
	key := hrFrozenKey(who, kind)
	if strings.HasSuffix(op, "-confirm") {
		key = people.FactsString(i.Payload, "operationKey")
	}
	var frozen map[string]any
	frozen, err = people.FactsRowTx(ctx, tx, operations, "operation_key=? AND BINARY operation_key=BINARY ? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND target_app='console' AND source_biz_type='hr_source' AND service_client_id='enterprise.runtime'", key, key, who.Tenant, who.Deployment)
	missing := false
	var he httperror.Error
	if errors.As(err, &he) && he.Status == 404 {
		missing = true
		err = nil
	}
	if err != nil {
		return nil, err
	}
	if !missing {
		if frozen["original_actor_uid"] != who.Actor || frozen["operation_code"] != contract[1] || frozen["required_capability"] != contract[0] {
			return nil, httperror.New(403, "people_hr_frozen_identity_invalid", "Frozen source identity mismatch")
		}
	}
	preparing := strings.HasSuffix(op, "-prepare")
	if preparing {
		command, e := people.NormalizeHRSourceCommand(kind, i.Payload["command"].(map[string]any))
		if e != nil {
			return nil, e
		}
		command["actorUid"] = who.Actor
		digest, e := integrationoperation.ValidateAndDigestCommand(command)
		if e != nil {
			return nil, e
		}
		if !missing {
			if frozen["command_sha256"] != digest || fmt.Sprint(frozen["correlation_key"]) != fmt.Sprintf("%s:v%d", key, people.FactsVersion(i.Payload)) {
				return nil, httperror.New(409, "people_hr_intent_conflict", "The same key has a different HR intent")
			}
		}
		if missing {
			if kind == "jobs-start" && i.Payload["sourceReady"] != true {
				return nil, httperror.New(409, "people_hr_mappings_not_ready", "钉钉部门映射未全部确认，不能启动同步")
			}
			if pending.Valid {
				return nil, people.HRSourcePendingError()
			}
			if uint64(people.FactsVersion(i.Payload)) != version {
				return nil, httperror.New(409, "people_hr_version_conflict", "HR state changed")
			}
			raw, _ := json.Marshal(command)
			oid := uuid.NewString()
			_, err = tx.ExecContext(ctx, "INSERT INTO "+operations+"(operation_id,operation_key,correlation_key,tenant_code,deployment_code,source_app,target_app,operation_code,required_capability,source_biz_type,source_biz_code,idempotency_key,command_schema_version,command_json,command_sha256,status,next_attempt_at,original_request_id,original_actor_uid,service_client_id,created_by,updated_by) VALUES(?,?,?,?,?,'enterprise','console',?,?,'hr_source',?,?,'v1',?,?,'pending',UTC_TIMESTAMP(3),?,?,?,?,?)", oid, key, fmt.Sprintf("%s:v%d", key, people.FactsVersion(i.Payload)), who.Tenant, who.Deployment, contract[1], contract[0], who.Key, key, string(raw), digest, who.RequestID, who.Actor, who.Client, who.Actor, who.Actor)
			if err != nil {
				return nil, err
			}
			_, err = tx.ExecContext(ctx, "UPDATE "+state+" SET pending_key=?,row_version=row_version+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE provider_code='dingtalk'", key, who.Actor)
			if err != nil {
				return nil, err
			}
			frozen = map[string]any{"correlation_key": fmt.Sprintf("%s:v%d", key, people.FactsVersion(i.Payload)), "operation_id": oid, "command_json": string(raw), "command_sha256": digest, "status": "pending", "operation_code": contract[1], "required_capability": contract[0]}
		}
	} else {
		if missing {
			return nil, httperror.New(404, "people_hr_command_not_found", "Frozen HR command not found")
		}
		confirmation := i.Payload["confirmation"].(map[string]any)
		if len(confirmation) != 3 || confirmation["targetConfirmed"] != true || confirmation["commandSha256"] != frozen["command_sha256"] {
			return nil, httperror.New(403, "people_hr_target_confirmation_invalid", "Exact target confirmation required")
		}
		confirmationDigest, e := integrationoperation.ValidateAndDigestCommand(confirmation)
		if e != nil {
			return nil, e
		}
		if frozen["status"] == "succeeded" && frozen["response_summary_sha256"] != confirmationDigest {
			return nil, httperror.New(409, "people_hr_confirmation_conflict", "Confirmation changed")
		}
		if frozen["status"] != "succeeded" {
			if !pending.Valid || pending.String != key {
				return nil, httperror.New(409, "people_hr_confirmation_conflict", "Source root changed")
			}
			confirmation := i.Payload["confirmation"].(map[string]any)
			// Only Host signs this target response. There is no public confirmation BFF.
			if confirmation["targetConfirmed"] != true || confirmation["commandSha256"] != frozen["command_sha256"] {
				return nil, httperror.New(403, "people_hr_target_confirmation_invalid", "Exact target confirmation required")
			}
			if kind == "mappings" {
				if _, err = people.RemapHRSourceDepartmentsTx(ctx, tx, r.Table, confirmation["aliases"]); err != nil {
					return nil, err
				}
			}
			_, err = tx.ExecContext(ctx, "UPDATE "+operations+" SET status='succeeded',target_biz_type='hr_source',target_biz_code='dingtalk',last_http_status=200,response_summary_sha256=?,succeeded_at=UTC_TIMESTAMP(3),updated_by=?,updated_at=UTC_TIMESTAMP(3),version_no=version_no+1 WHERE operation_key=? AND status='pending'", confirmationDigest, who.Actor, key)
			if err != nil {
				return nil, err
			}
			_, err = tx.ExecContext(ctx, "UPDATE "+state+" SET pending_key=NULL,row_version=row_version+1,updated_by=?,updated_at=UTC_TIMESTAMP(3) WHERE provider_code='dingtalk' AND BINARY pending_key=BINARY ?", who.Actor, key)
			if err != nil {
				return nil, err
			}
			frozen["status"] = "succeeded"
		}
	}
	// Response includes only the original frozen intent, never a mutable request copy.
	var command map[string]any
	err = json.Unmarshal([]byte(fmt.Sprint(frozen["command_json"])), &command)
	if err != nil {
		return nil, err
	}
	receiptInput := i
	receiptInput.Payload = map[string]any{}
	for k, v := range i.Payload {
		if k != "sourceReady" {
			receiptInput.Payload[k] = v
		}
	}
	receiptOut, e := s.receipt(ctx, tx, r, op, receiptInput, who, func() (map[string]any, error) {
		return map[string]any{"id": frozen["operation_id"], "row_version": 1}, nil
	})
	if e != nil {
		return nil, e
	}
	receiptMeta := receiptOut.(map[string]any) // immutable actor/intent audit in existing receipt table
	out = map[string]any{"receiptId": receiptMeta["receiptId"], "replayed": receiptMeta["replayed"], "data": map[string]any{"status": frozen["status"], "operationKey": key, "frozen": map[string]any{"operationId": frozen["operation_id"], "operationKey": key, "operationCode": contract[1], "requiredCapability": contract[0], "idempotencyKey": key, "commandSchemaVersion": "v1", "commandSha256": frozen["command_sha256"], "command": command, "tenantCode": who.Tenant, "deploymentCode": who.Deployment, "sourceApp": "enterprise", "targetApp": "console"}}}
	err = tx.Commit()
	return out, err
}
