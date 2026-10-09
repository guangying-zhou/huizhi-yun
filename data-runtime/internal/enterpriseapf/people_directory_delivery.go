package enterpriseapf

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"regexp"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/apps/people"
	"github.com/huizhi-yun/data-runtime/internal/enterprise"
	"github.com/huizhi-yun/data-runtime/internal/enterprise/domaininstall"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

type PeopleDirectoryInput struct {
	Cursor       string         `json:"cursor"`
	OperationKey string         `json:"operationKey"`
	OperationID  string         `json:"operationId"`
	FencingToken uint64         `json:"fencingToken"`
	HTTPStatus   int            `json:"httpStatus"`
	Receipt      map[string]any `json:"receipt"`
}

// A fixed worker name is chosen here, never supplied by a caller. All four
// commands operate on the Registry-bound People domain under the same generation.
func (s PeopleFactsService) Directory(ctx context.Context, op string, i PeopleDirectoryInput, who Identity) (any, error) {
	if s.Registry == nil || !domaininstall.IsPeopleFactsDomain(s.Binding.Domains["people"]) {
		return nil, httperror.New(503, "people_facts_not_installed", "People facts unavailable")
	}
	if who.Client != "enterprise.runtime" || who.Actor != "" || who.Tenant != s.Binding.Key.Tenant || who.Deployment != s.Binding.Domains["people"].OwnerDeployment {
		return nil, httperror.New(403, "people_system_identity_invalid", "Exact Enterprise system identity required")
	}
	if op != "prepare-due" && op != "claim" && op != "ack" && op != "fail" {
		return nil, httperror.New(400, "people_delivery_input_invalid", "Closed delivery operation required")
	}
	tx, resolved, e := s.Registry.BeginWriteTransaction(ctx, s.request("people", enterprise.Write))
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	r := resolved[0]
	// BeginWriteTransaction already holds and verifies the persistent generation
	// FOR SHARE until commit. Upgrading it here deadlocks concurrent deliveries;
	// operation/employee row locks below serialize domain mutations independently.
	tables := []string{}
	for _, name := range []string{"integration_operation", "integration_operation_attempt", "service_command_receipt", "integration_operation_dead_letter_actionable"} {
		t, e := r.Table(name)
		if e != nil {
			return nil, e
		}
		tables = append(tables, t)
	}
	mapping, e := integrationoperation.NewOutboxTables(tables[0], tables[1], tables[2], tables[3])
	if e != nil {
		return nil, e
	}
	repo, e := integrationoperation.NewRepository(r.DB, integrationoperation.WithOutboxTables(mapping))
	if e != nil {
		return nil, e
	}
	now := time.Now().UTC()
	worker := "enterprise.people.directory"
	var out any
	if op == "prepare-due" {
		if i.OperationKey != "" || i.OperationID != "" || i.FencingToken != 0 || i.HTTPStatus != 0 || len(i.Receipt) > 0 || len(i.Cursor) > 64 {
			return nil, httperror.New(400, "people_delivery_input_invalid", "Invalid due input")
		}
		assignments, e := r.Table("people_assignments")
		if e != nil {
			return nil, e
		}
		employees, e := r.Table("people_employees")
		if e != nil {
			return nil, e
		}
		versions, e := r.Table("people_directory_lifecycle_versions")
		if e != nil {
			return nil, e
		}
		// Only missing watermarks or a changed *latest effective primary* are due.
		// Once processed they leave this set, so the bounded first page cannot
		// starve later employees on the next wake.
		rows, e := tx.QueryContext(ctx, "SELECT p.employee_uid FROM "+employees+" p LEFT JOIN "+versions+" v ON BINARY v.employee_uid=BINARY p.employee_uid LEFT JOIN "+assignments+" a ON a.id=(SELECT latest.id FROM "+assignments+" latest WHERE BINARY latest.employee_uid=BINARY p.employee_uid AND latest.is_primary=1 AND latest.approval_status IN ('none','approved') AND latest.effective_from<=UTC_DATE() AND (latest.effective_to IS NULL OR latest.effective_to>=UTC_DATE()) ORDER BY latest.effective_from DESC,latest.id DESC LIMIT 1) WHERE p.archived_at IS NULL AND BINARY p.employee_uid>BINARY ? AND (p.employment_status<>'inactive' OR a.id IS NOT NULL) AND (v.employee_uid IS NULL OR a.id IS NOT NULL AND NOT(p.dept_code<=>a.dept_code AND p.position_code<=>a.position_code AND p.rank_code<=>a.rank_code AND p.manager_uid<=>a.manager_uid AND p.employment_status<=>IF(a.change_type='leave','left','active'))) ORDER BY BINARY p.employee_uid LIMIT 100 FOR UPDATE", i.Cursor)
		if e != nil {
			return nil, e
		}
		uids := []string{}
		for rows.Next() {
			var uid string
			if e = rows.Scan(&uid); e != nil {
				rows.Close()
				return nil, e
			}
			uids = append(uids, uid)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
		for _, uid := range uids {
			facts := people.FactsContext{Tenant: who.Tenant, Deployment: who.Deployment, Client: who.Client, RequestID: who.RequestID, Actor: who.Client, AsOf: now}
			if e = people.ProjectEnterprisePrimaryTx(ctx, tx, r.Table, uid, facts); e != nil {
				return nil, e
			}
			if _, e = people.FreezeEnterpriseLifecycleTx(ctx, tx, r.Table, uid, facts); e != nil {
				return nil, e
			}
		}
		cursor := ""
		if len(uids) == 100 {
			cursor = uids[len(uids)-1]
		}
		out = map[string]any{"prepared": len(uids), "cursor": cursor, "hasMore": cursor != ""}
	} else if op == "claim" {
		if i.Cursor != "" || i.OperationID != "" || i.FencingToken != 0 || i.HTTPStatus != 0 || len(i.Receipt) > 0 {
			return nil, httperror.New(400, "people_delivery_input_invalid", "Invalid claim input")
		}
		// Onboarding confirmations remain request-driven; this worker cannot claim
		// those frozen commands or another APF domain's operations.
		key := i.OperationKey
		where := "tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND target_app='console' AND source_biz_type='employee' AND operation_code IN ('people.directory.employment-sync.v1','people.directory.offboarding-disable.v1')"
		args := []any{who.Tenant, who.Deployment}
		if key != "" {
			where += " AND BINARY operation_key=BINARY ?"
			args = append(args, key)
		}
		{
			where += " AND (status IN ('pending','retry_wait','partial_unknown') AND next_attempt_at<=UTC_TIMESTAMP(3) OR status='processing' AND locked_until<UTC_TIMESTAMP(3))"
		}
		e = tx.QueryRowContext(ctx, "SELECT operation_key FROM "+tables[0]+" WHERE "+where+" ORDER BY created_at,operation_id LIMIT 1 FOR UPDATE", args...).Scan(&key)
		if e == sql.ErrNoRows {
			out = map[string]any{"operation": nil}
		} else if e != nil {
			return nil, e
		} else {
			claim, e := repo.ClaimByOperationKeyInTransaction(ctx, tx, who.Tenant, who.Deployment, "enterprise", key, worker, now, 30*time.Second)
			if e != nil {
				return nil, e
			}
			if claim == nil {
				out = map[string]any{"operation": nil}
			} else {
				var command map[string]any
				if e = json.Unmarshal(claim.Command, &command); e != nil {
					return nil, e
				}
				out = map[string]any{"operation": map[string]any{"operationId": claim.OperationID, "operationKey": claim.OperationKey, "fencingToken": claim.FencingToken, "operationCode": claim.Identity.OperationCode, "requiredCapability": claim.RequiredCapability, "idempotencyKey": claim.Identity.IdempotencyKey, "commandSha256": claim.Identity.CommandSHA256, "commandSchemaVersion": claim.CommandSchemaVersion, "tenantCode": who.Tenant, "deploymentCode": who.Deployment, "sourceApp": "enterprise", "targetApp": "console", "command": command}}
			}
		}
	} else {
		if i.Cursor != "" || i.OperationKey != "" || i.OperationID == "" || i.FencingToken == 0 {
			return nil, httperror.New(400, "people_delivery_input_invalid", "Observed claim required")
		}
		row, e := people.FactsRowTx(ctx, tx, tables[0], "operation_id=? AND tenant_code=? AND deployment_code=? AND source_app='enterprise' AND service_client_id='enterprise.runtime' AND target_app='console' AND source_biz_type='employee' AND operation_code IN ('people.directory.employment-sync.v1','people.directory.offboarding-disable.v1')", i.OperationID, who.Tenant, who.Deployment)
		if e != nil {
			return nil, e
		}
		lease := integrationoperation.CompletionLease{OperationID: i.OperationID, Worker: worker, FencingToken: i.FencingToken}
		if op == "ack" {
			if i.HTTPStatus != 0 {
				return nil, httperror.New(400, "people_delivery_input_invalid", "Ack must not contain failure status")
			}
			receipt := i.Receipt
			if receipt["operationId"] != i.OperationID || receipt["commandSha256"] != row["command_sha256"] || receipt["targetBizType"] != "directory_user" || receipt["targetBizCode"] != row["source_biz_code"] || receipt["receiptStatus"] != "succeeded" || receipt["operationCode"] != row["operation_code"] || receipt["idempotencyKey"] != row["idempotency_key"] || receipt["commandSchemaVersion"] != row["command_schema_version"] || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(fmt.Sprint(receipt["responseSummarySha256"])) {
				return nil, httperror.New(409, "people_target_confirmation_invalid", "Confirmed Directory and Platform receipt required")
			}
			if _, e := uuid.Parse(fmt.Sprint(receipt["receiptId"])); e != nil {
				return nil, httperror.New(409, "people_target_confirmation_invalid", "Receipt UUID required")
			}
			if row["status"] == "succeeded" {
				// A lost source ACK response may be replayed after the lease was
				// cleared. Only the exact already committed target receipt can
				// converge; it never creates another attempt or audit transition.
				if receipt["receiptId"] != row["target_receipt_id"] {
					return nil, httperror.New(409, "people_target_confirmation_invalid", "Committed receipt differs")
				}
				if e := tx.Commit(); e != nil {
					return nil, e
				}
				return map[string]any{"acked": true, "idempotent": true}, nil
			}
			digest, e := integrationoperation.ValidateAndDigestCommand(receipt)
			if e != nil {
				return nil, e
			}
			out, e = repo.RecordSuccessWithMutationInTransaction(ctx, tx, integrationoperation.RecordSuccessInput{Lease: lease, Now: now, HTTPStatus: 200, TargetReceiptID: fmt.Sprint(receipt["receiptId"]), TargetBizType: "directory_user", TargetBizCode: fmt.Sprint(row["source_biz_code"]), ResponseSummarySHA256: digest}, nil)
			if e != nil {
				return nil, e
			}
		} else {
			if len(i.Receipt) > 0 || i.HTTPStatus < 400 || i.HTTPStatus > 599 {
				return nil, httperror.New(400, "people_delivery_input_invalid", "Fixed target failure status required")
			}
			out, e = repo.RecordFailureInTransaction(ctx, tx, integrationoperation.RecordFailureInput{Lease: lease, Now: now, Failure: integrationoperation.FailureInput{HTTPStatus: i.HTTPStatus}, ErrorCode: "directory_delivery_failed", ErrorSummary: "Directory lifecycle delivery failed"})
			if e != nil {
				return nil, e
			}
		}
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return out, nil
}
