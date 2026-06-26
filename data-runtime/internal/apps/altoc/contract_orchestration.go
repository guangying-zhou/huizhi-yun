package altoc

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

type contractActivationStepPlan struct {
	Key                string
	Name               string
	TargetApp          string
	TargetAction       string
	DependsOn          []string
	Request            map[string]any
	Required           bool
	SortNo             int
	BlockingDependency bool
	BlockedReason      string
}

func (a *Adapter) contractActivationPlan(ctx context.Context, identifier string, query url.Values) (map[string]any, error) {
	contract, err := a.getContractScoped(ctx, identifier, query)
	if err != nil {
		return nil, err
	}
	result := buildContractActivationPlan(contract, nil)
	latestJob, err := a.latestContractActivationJob(ctx, a.DB(), contract["id"])
	if err != nil {
		return nil, err
	}
	result["latestJob"] = latestJob
	return result, nil
}

func (a *Adapter) contractActivationPlanFromBody(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.contractForActivationTx(ctx, tx, identifier)
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "view"); err != nil {
		return nil, err
	}
	matches, err := altocRecordMatchesReadScope(body, "contract", contract, "owner_user_id", "owner_dept_code")
	if err != nil {
		return nil, err
	}
	if !matches {
		return nil, altocDataAccessForbidden()
	}
	if err := a.enrichContractActivationInputsTx(ctx, tx, contract); err != nil {
		return nil, err
	}
	result := buildContractActivationPlan(contract, body)
	latestJob, err := a.latestContractActivationJob(ctx, tx, contract["id"])
	if err != nil {
		return nil, err
	}
	result["latestJob"] = latestJob
	return result, nil
}

func (a *Adapter) executeContractActivation(ctx context.Context, identifier string, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, err := a.contractForActivationTx(ctx, tx, identifier)
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	if err := a.enrichContractActivationInputsTx(ctx, tx, contract); err != nil {
		return nil, err
	}

	operator := altocActor(body)
	plan := buildContractActivationPlan(contract, body)
	idempotencyKey := contractActivationIdempotencyKey(contract, body)
	existing, err := a.contractActivationJobByIdempotencyTx(ctx, tx, contract["id"], idempotencyKey)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		existing["idempotent"] = true
		return existing, nil
	}

	code, err := nextAltocCode(ctx, tx, "COJ", "contract_orchestration_job")
	if err != nil {
		return nil, err
	}
	jobID, err := altocInsertRecordTx(ctx, tx, "contract_orchestration_job", map[string]any{
		"code":                  code,
		"job_type":              "activation",
		"contract_id":           contract["id"],
		"source_contract_code":  altocMapText(contract, "code"),
		"idempotency_key":       idempotencyKey,
		"requested_by":          nullableText(operator),
		"status":                "running",
		"tenant_code":           nullableText(firstBodyText(body, "tenantCode", "tenant_code", "current_tenant", "currentTenant")),
		"deployment_code":       nullableText(firstBodyText(body, "deploymentCode", "deployment_code", "current_deployment", "currentDeployment")),
		"feature_flag_snapshot": nestedMap(body, "featureFlagSnapshot", "feature_flag_snapshot"),
		"plan_snapshot_json":    plan,
		"started_at":            time.Now().UTC().Format("2006-01-02 15:04:05"),
		"created_by":            nullableText(operator),
		"updated_by":            nullableText(operator),
	})
	if err != nil {
		return nil, err
	}
	steps := contractActivationStepsFromPlan(plan)
	for _, step := range steps {
		status := "planned"
		lastError := ""
		if step.BlockingDependency {
			status = "needs_manual_action"
			lastError = step.BlockedReason
		}
		if _, err := altocInsertRecordTx(ctx, tx, "contract_orchestration_step", map[string]any{
			"job_id":               jobID,
			"contract_id":          contract["id"],
			"step_key":             step.Key,
			"step_name":            step.Name,
			"sort_no":              step.SortNo,
			"depends_on_step_keys": step.DependsOn,
			"idempotency_key":      contractActivationStepIdempotencyKey(contract, step),
			"target_app":           step.TargetApp,
			"target_action":        step.TargetAction,
			"request_snapshot":     step.Request,
			"status":               status,
			"last_error":           nullableText(lastError),
			"created_by":           nullableText(operator),
			"updated_by":           nullableText(operator),
		}); err != nil {
			return nil, err
		}
	}
	assetPlanCount, err := a.ensureContractDeliveryAssetPlansTx(ctx, tx, contract, jobID, operator)
	if err != nil {
		return nil, err
	}
	serviceAgreementCount, err := a.ensureContractServiceAgreementPlansTx(ctx, tx, contract, jobID, operator)
	if err != nil {
		return nil, err
	}
	if assetPlanCount > 0 {
		// Assets 主档同步由 Nuxt 编排器调用 Assets service API 后回写步骤状态。
	}
	if serviceAgreementCount > 0 {
		if err := a.markActivationLocalPlanStepSucceededTx(ctx, tx, jobID, "altoc_service_agreement_plan", operator, map[string]any{
			"placeholder":             true,
			"service_agreement_count": serviceAgreementCount,
			"external_writes":         0,
			"dependency_status":       "assets_contract_pending",
		}); err != nil {
			return nil, err
		}
	}
	if _, err := a.refreshContractActivationJobStatusTx(ctx, tx, jobID, contract["id"], operator); err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_orchestration_job", jobID, "create", nil, map[string]any{
		"contract_id": contract["id"],
		"steps":       len(steps),
		"status":      "running",
	}, operator); err != nil {
		return nil, err
	}
	if err := insertContractDomainEventTx(ctx, tx, contractDomainEventKey("contract.activation", contract["id"], "job_created", code), "ContractActivationJobCreated", "contract", contract["id"], map[string]any{
		"job_id":        jobID,
		"job_code":      code,
		"contract_code": altocMapText(contract, "code"),
	}, operator); err != nil {
		return nil, err
	}
	detail, err := a.contractActivationJobDetailTx(ctx, tx, contract["id"], jobID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	detail["idempotent"] = false
	return detail, nil
}

func (a *Adapter) getContractActivationJob(ctx context.Context, contractIdentifier string, jobIdentifier string, query url.Values) (map[string]any, error) {
	contract, err := a.getContractScoped(ctx, contractIdentifier, query)
	if err != nil {
		return nil, err
	}
	return a.contractActivationJobDetail(ctx, a.DB(), contract["id"], jobIdentifier)
}

func (a *Adapter) retryContractActivationJob(ctx context.Context, contractIdentifier string, jobIdentifier string, body map[string]any) (map[string]any, error) {
	return a.mutateContractActivationJob(ctx, contractIdentifier, jobIdentifier, body, func(ctx context.Context, tx *sql.Tx, contract map[string]any, job map[string]any, operator string) error {
		result, err := tx.ExecContext(ctx, `
			UPDATE contract_orchestration_step
			SET status = 'planned',
			    retry_count = retry_count + 1,
			    last_error = NULL,
			    next_retry_at = NULL,
			    locked_by = NULL,
			    locked_until = NULL,
			    heartbeat_at = NULL,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE job_id = ?
			  AND status IN ('failed', 'needs_manual_action')
			  AND retry_count < max_retries
			  AND deleted_at IS NULL
		`, nullableText(operator), job["id"])
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			return httperror.New(http.StatusConflict, "no_retryable_step", "no failed activation step can be retried")
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE contract_orchestration_job
			SET status = 'running',
			    cancel_reason = NULL,
			    finished_at = NULL,
			    last_error = NULL,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, nullableText(operator), job["id"])
		return err
	})
}

func (a *Adapter) cancelContractActivationJob(ctx context.Context, contractIdentifier string, jobIdentifier string, body map[string]any) (map[string]any, error) {
	return a.mutateContractActivationJob(ctx, contractIdentifier, jobIdentifier, body, func(ctx context.Context, tx *sql.Tx, contract map[string]any, job map[string]any, operator string) error {
		reason := firstNonEmptyText(firstBodyText(body, "reason", "cancelReason", "cancel_reason"), "manual_cancel")
		if _, err := tx.ExecContext(ctx, `
			UPDATE contract_orchestration_step
			SET status = 'cancelled',
			    last_error = COALESCE(last_error, ?),
			    locked_by = NULL,
			    locked_until = NULL,
			    heartbeat_at = NULL,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE job_id = ?
			  AND status NOT IN ('succeeded', 'skipped', 'cancelled')
			  AND deleted_at IS NULL
		`, reason, nullableText(operator), job["id"]); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE contract_orchestration_job
			SET status = 'cancelled',
			    cancel_reason = ?,
			    finished_at = CURRENT_TIMESTAMP,
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, reason, nullableText(operator), job["id"]); err != nil {
			return err
		}
		return a.updateContractActivationStatusTx(ctx, tx, contract["id"], "cancelled", operator)
	})
}

func (a *Adapter) recordContractActivationStepResult(ctx context.Context, contractIdentifier string, jobIdentifier string, stepKey string, body map[string]any) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, job, err := a.lockContractActivationJobTx(ctx, tx, contractIdentifier, jobIdentifier)
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	step, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_orchestration_step
		WHERE job_id = ?
		  AND step_key = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, job["id"], stepKey)
	if err != nil {
		return nil, err
	}
	if step == nil {
		return nil, httperror.New(http.StatusNotFound, "activation_step_not_found", "activation step not found")
	}
	status := normalizeActivationStepResultStatus(firstNonEmptyText(firstBodyText(body, "status"), firstBodyText(body, "resultStatus", "result_status")))
	if status == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_step_status", "step result status is required")
	}
	resultSnapshot := nestedMap(body, "result", "resultSnapshot", "result_snapshot")
	if len(resultSnapshot) == 0 {
		resultSnapshot = map[string]any{}
	}
	for _, key := range []string{"projectCode", "project_code", "projectName", "project_name", "created", "idempotent"} {
		if value, ok := body[key]; ok {
			resultSnapshot[key] = value
		}
	}
	lastError := firstBodyText(body, "error", "lastError", "last_error", "message")
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_orchestration_step
		SET status = ?,
		    result_snapshot = ?,
		    last_error = ?,
		    next_retry_at = ?,
		    locked_by = NULL,
		    locked_until = NULL,
		    heartbeat_at = NULL,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, jsonColumnText(resultSnapshot), nullableText(lastError), activationNextRetryAt(status, step), nullableText(operator), step["id"]); err != nil {
		return nil, err
	}
	if status == "succeeded" && stepKey == "aims_project_link" {
		if err := a.upsertContractProjectLinkFromActivationTx(ctx, tx, contract, job, resultSnapshot, operator); err != nil {
			return nil, err
		}
	}
	if status == "succeeded" && stepKey == "assets_delivery_assets_plan" {
		if err := a.syncContractDeliveryAssetsFromActivationTx(ctx, tx, contract, resultSnapshot, operator); err != nil {
			return nil, err
		}
	}
	nextStatus, err := a.refreshContractActivationJobStatusTx(ctx, tx, job["id"], contract["id"], operator)
	if err != nil {
		return nil, err
	}
	if err := insertAltocAuditTx(ctx, tx, "contract_orchestration_step", step["id"], "status_change", map[string]any{
		"status": step["status"],
	}, map[string]any{
		"status":     status,
		"job_status": nextStatus,
		"step_key":   stepKey,
	}, operator); err != nil {
		return nil, err
	}
	detail, err := a.contractActivationJobDetailTx(ctx, tx, contract["id"], job["id"])
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return detail, nil
}

func (a *Adapter) mutateContractActivationJob(ctx context.Context, contractIdentifier string, jobIdentifier string, body map[string]any, mutate func(context.Context, *sql.Tx, map[string]any, map[string]any, string) error) (map[string]any, error) {
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	contract, job, err := a.lockContractActivationJobTx(ctx, tx, contractIdentifier, jobIdentifier)
	if err != nil {
		return nil, err
	}
	if err := altocRequireActionScope(body, "contract", "edit"); err != nil {
		return nil, err
	}
	if err := altocRequireRecordWrite(body, "contract", contract, "owner_user_id", "owner_dept_code"); err != nil {
		return nil, err
	}
	operator := altocActor(body)
	if err := mutate(ctx, tx, contract, job, operator); err != nil {
		return nil, err
	}
	if _, err := a.refreshContractActivationJobStatusTx(ctx, tx, job["id"], contract["id"], operator); err != nil {
		return nil, err
	}
	detail, err := a.contractActivationJobDetailTx(ctx, tx, contract["id"], job["id"])
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return detail, nil
}

func (a *Adapter) enrichContractActivationInputsTx(ctx context.Context, tx *sql.Tx, contract map[string]any) error {
	contractID := contract["id"]
	paymentTerms, err := a.contractPaymentTerms(ctx, tx, contractID)
	if err != nil {
		return err
	}
	lines, err := a.contractLines(ctx, tx, contractID)
	if err != nil {
		return err
	}
	obligations, err := a.contractObligations(ctx, tx, contractID)
	if err != nil {
		return err
	}
	billingSchedules, err := a.contractBillingSchedules(ctx, tx, contractID)
	if err != nil {
		return err
	}
	projectLinks, err := a.contractProjectLinks(ctx, tx, contractID)
	if err != nil {
		return err
	}
	deliveryAssets, err := a.contractDeliveryAssetPlans(ctx, tx, contractID)
	if err != nil {
		return err
	}
	serviceAgreements, err := a.contractServiceAgreements(ctx, tx, contractID)
	if err != nil {
		return err
	}
	contract["payment_terms"] = paymentTerms
	contract["lines"] = lines
	contract["obligations"] = obligations
	contract["billing_schedules"] = billingSchedules
	contract["project_links"] = projectLinks
	contract["delivery_asset_plans"] = deliveryAssets
	contract["service_agreements"] = serviceAgreements
	return nil
}

func buildContractActivationPlan(contract map[string]any, body map[string]any) map[string]any {
	lines := activationMapSlice(contract["lines"])
	obligations := activationMapSlice(contract["obligations"])
	paymentTerms := activationMapSlice(contract["payment_terms"])
	billingSchedules := activationMapSlice(contract["billing_schedules"])
	projectLinks := activationMapSlice(contract["project_links"])
	effectiveDate := firstNonEmptyText(firstBodyText(body, "effectiveDate", "effective_date"), altocMapText(contract, "effective_date"))
	contractCode := altocMapText(contract, "code")

	warnings := make([]map[string]any, 0)
	suggestions := map[string]any{
		"projects":           []map[string]any{},
		"delivery_assets":    []map[string]any{},
		"service_agreements": []map[string]any{},
		"billing_schedules":  []map[string]any{},
		"purchase_demands":   []map[string]any{},
	}
	steps := make([]contractActivationStepPlan, 0, 8)
	steps = append(steps, contractActivationStepPlan{
		Key:          "altoc_activate_contract",
		Name:         "合同生效和回款计划生成",
		TargetApp:    "altoc",
		TargetAction: "service/contracts/activate-delivery",
		Required:     true,
		SortNo:       10,
		Request: map[string]any{
			"contract_code":  contractCode,
			"effective_date": effectiveDate,
		},
	})

	projectPlans := activationProjectPlans(contract, lines, obligations, projectLinks)
	projectLineCodes := activationProjectLineCodes(projectPlans)
	if len(projectLineCodes) > 0 {
		suggestions["projects"] = projectPlans
		steps = append(steps, contractActivationStepPlan{
			Key:          "aims_project_link",
			Name:         "创建或关联 Aims 项目",
			TargetApp:    "aims",
			TargetAction: "projects/from-contract",
			DependsOn:    []string{"altoc_activate_contract"},
			Required:     activationAnyProjectRequired(lines),
			SortNo:       20,
			Request: map[string]any{
				"contract_code":       contractCode,
				"project_plan_count":  len(projectPlans),
				"project_plans":       projectPlans,
				"existing_link_count": len(projectLinks),
			},
		})
	}

	if len(paymentTerms) > 0 || len(billingSchedules) > 0 {
		for _, schedule := range billingSchedules {
			suggestions["billing_schedules"] = append(suggestions["billing_schedules"].([]map[string]any), map[string]any{
				"schedule_code": altocMapText(schedule, "code"),
				"trigger":       altocMapText(schedule, "trigger_type"),
				"expected_date": altocMapText(schedule, "expected_date"),
				"status":        altocMapText(schedule, "status"),
			})
		}
		depends := []string{"altoc_activate_contract"}
		if len(projectLineCodes) > 0 {
			depends = []string{"aims_project_link"}
			steps = append(steps, contractActivationStepPlan{
				Key:          "aims_payment_milestones_sync",
				Name:         "同步项目收款里程碑",
				TargetApp:    "aims",
				TargetAction: "payment-milestones:sync",
				DependsOn:    depends,
				Required:     false,
				SortNo:       30,
				Request: map[string]any{
					"contract_code":          contractCode,
					"payment_term_count":     len(paymentTerms),
					"billing_schedule_count": len(billingSchedules),
					"project_plans":          projectPlans,
				},
			})
			depends = []string{"altoc_activate_contract"}
		}
		steps = append(steps, contractActivationStepPlan{
			Key:          "altoc_receivable_plan",
			Name:         "生成 Altoc 回款计划",
			TargetApp:    "altoc",
			TargetAction: "receivable-plans/from-contract",
			DependsOn:    depends,
			Required:     true,
			SortNo:       40,
			Request: map[string]any{
				"contract_code":          contractCode,
				"payment_term_count":     len(paymentTerms),
				"billing_schedule_count": len(billingSchedules),
			},
		})
	}

	assetLineCodes := activationLineCodes(lines, func(line map[string]any) bool {
		return activationPolicy(line, "asset_policy") != "none"
	})
	if len(assetLineCodes) > 0 {
		for _, line := range lines {
			if activationPolicy(line, "asset_policy") == "none" {
				continue
			}
			suggestions["delivery_assets"] = append(suggestions["delivery_assets"].([]map[string]any), map[string]any{
				"plan_key":     "asset-" + altocMapText(line, "code"),
				"action":       "create_planned",
				"line_code":    altocMapText(line, "code"),
				"product_code": altocMapText(line, "product_code"),
				"asset_policy": activationPolicy(line, "asset_policy"),
			})
		}
		steps = append(steps, contractActivationStepPlan{
			Key:          "assets_delivery_assets_plan",
			Name:         "同步客户交付资产",
			TargetApp:    "assets",
			TargetAction: "customer-delivery-assets/plans",
			DependsOn:    activationDependsOnProject(projectLineCodes),
			Required:     false,
			SortNo:       50,
			Request: map[string]any{
				"contract_code": contractCode,
				"line_codes":    assetLineCodes,
			},
		})
	}

	serviceLineCodes := activationLineCodes(lines, func(line map[string]any) bool {
		return activationPolicy(line, "service_policy") != "none"
	})
	if len(serviceLineCodes) > 0 {
		suggestions["service_agreements"] = append(suggestions["service_agreements"].([]map[string]any), map[string]any{
			"plan_key":   "service-agreement-main",
			"action":     "create_after_acceptance",
			"line_codes": serviceLineCodes,
		})
		warnings = append(warnings, map[string]any{"code": "service_agreement_depends_on_assets", "message": "服务协议覆盖正式资产仍依赖 Assets 编码，本批先生成计划服务协议。"})
		steps = append(steps, contractActivationStepPlan{
			Key:          "altoc_service_agreement_plan",
			Name:         "计划服务协议和 SLA 覆盖",
			TargetApp:    "altoc",
			TargetAction: "service-agreements/plan",
			DependsOn:    activationDependsOnAssets(assetLineCodes),
			Required:     false,
			SortNo:       60,
			Request: map[string]any{
				"contract_code": contractCode,
				"line_codes":    serviceLineCodes,
			},
		})
	}

	purchaseLineCodes := activationLineCodes(lines, func(line map[string]any) bool {
		return activationPolicy(line, "procurement_policy") != "none"
	})
	if len(purchaseLineCodes) > 0 {
		suggestions["purchase_demands"] = append(suggestions["purchase_demands"].([]map[string]any), map[string]any{
			"plan_key":   "purchase-demand-deferred",
			"action":     "defer_to_p2",
			"line_codes": purchaseLineCodes,
		})
		warnings = append(warnings, map[string]any{"code": "purchase_deferred_to_p2", "message": "采购合同最小闭环依赖 Finance/Assets 新接口，按方案后置到 P2。"})
	}

	stepMaps := make([]map[string]any, 0, len(steps))
	for _, step := range steps {
		stepMaps = append(stepMaps, activationStepPlanMap(step, contract))
	}
	return map[string]any{
		"contract":    activationContractSummary(contract),
		"warnings":    warnings,
		"suggestions": suggestions,
		"steps":       stepMaps,
	}
}

func (a *Adapter) contractForActivationTx(ctx context.Context, tx *sql.Tx, identifier string) (map[string]any, error) {
	where, args := altocIdentityWhere("ct", identifier)
	contract, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  ct.*,
		  cu.code AS customer_code,
		  cu.name AS customer_name,
		  op.code AS opportunity_code,
		  op.name AS opportunity_name
		FROM contract ct
		LEFT JOIN customer cu ON cu.id = ct.customer_id
		LEFT JOIN opportunity op ON op.id = ct.opportunity_id
		WHERE `+where+`
		  AND ct.deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, args...)
	if err != nil {
		return nil, err
	}
	if contract == nil {
		return nil, httperror.New(http.StatusNotFound, "record_not_found", "contract not found")
	}
	contract["status"] = altocNormalizeContractStatus(contract["status"])
	return contract, nil
}

func (a *Adapter) lockContractActivationJobTx(ctx context.Context, tx *sql.Tx, contractIdentifier string, jobIdentifier string) (map[string]any, map[string]any, error) {
	contract, err := a.contractForActivationTx(ctx, tx, contractIdentifier)
	if err != nil {
		return nil, nil, err
	}
	job, err := a.contractActivationJobDetailTx(ctx, tx, contract["id"], jobIdentifier)
	if err != nil {
		return nil, nil, err
	}
	locked, err := altocQueryOneMap(ctx, tx, `
		SELECT *
		FROM contract_orchestration_job
		WHERE id = ?
		  AND contract_id = ?
		  AND deleted_at IS NULL
		LIMIT 1
		FOR UPDATE
	`, job["id"], contract["id"])
	return contract, locked, err
}

func (a *Adapter) contractActivationJobByIdempotencyTx(ctx context.Context, tx *sql.Tx, contractID any, idempotencyKey string) (map[string]any, error) {
	job, err := altocQueryOneMap(ctx, tx, `
		SELECT id
		FROM contract_orchestration_job
		WHERE contract_id = ?
		  AND idempotency_key = ?
		  AND deleted_at IS NULL
		LIMIT 1
	`, contractID, idempotencyKey)
	if err != nil || job == nil {
		return nil, err
	}
	return a.contractActivationJobDetailTx(ctx, tx, contractID, job["id"])
}

func (a *Adapter) latestContractActivationJob(ctx context.Context, conn altocQueryer, contractID any) (map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "contract_orchestration_job")
	if err != nil || !exists {
		return nil, err
	}
	job, err := altocQueryOneMap(ctx, conn, `
		SELECT id
		FROM contract_orchestration_job
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, contractID)
	if err != nil || job == nil {
		return nil, err
	}
	return a.contractActivationJobDetail(ctx, conn, contractID, job["id"])
}

func (a *Adapter) contractActivationJobDetail(ctx context.Context, conn altocQueryer, contractID any, jobIdentifier any) (map[string]any, error) {
	return a.contractActivationJobDetailTx(ctx, conn, contractID, jobIdentifier)
}

func (a *Adapter) contractActivationJobDetailTx(ctx context.Context, conn altocQueryer, contractID any, jobIdentifier any) (map[string]any, error) {
	where := "id = ?"
	arg := jobIdentifier
	if text := strings.TrimSpace(fmt.Sprint(jobIdentifier)); text != "" {
		if _, args := altocIdentityWhere("coj", text); len(args) > 0 {
			if !activationLooksNumeric(text) {
				where = "code = ?"
				arg = text
			}
		}
	}
	job, err := altocQueryOneMap(ctx, conn, `
		SELECT *
		FROM contract_orchestration_job coj
		WHERE coj.contract_id = ?
		  AND coj.`+where+`
		  AND coj.deleted_at IS NULL
		LIMIT 1
	`, contractID, arg)
	if err != nil {
		return nil, err
	}
	if job == nil {
		return nil, httperror.New(http.StatusNotFound, "activation_job_not_found", "activation job not found")
	}
	steps, err := altocQueryMaps(ctx, conn, `
		SELECT *
		FROM contract_orchestration_step
		WHERE job_id = ?
		  AND deleted_at IS NULL
		ORDER BY sort_no ASC, id ASC
	`, job["id"])
	if err != nil {
		return nil, err
	}
	job["steps"] = steps
	return job, nil
}

func activationLooksNumeric(value string) bool {
	if strings.TrimSpace(value) == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func (a *Adapter) refreshContractActivationJobStatusTx(ctx context.Context, tx *sql.Tx, jobID any, contractID any, operator string) (string, error) {
	row, err := altocQueryOneMap(ctx, tx, `
		SELECT
		  COUNT(*) AS total_count,
		  COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_count,
		  COALESCE(SUM(CASE WHEN status IN ('failed', 'needs_manual_action') THEN 1 ELSE 0 END), 0) AS failed_count,
		  COALESCE(SUM(CASE WHEN status IN ('planned', 'running') THEN 1 ELSE 0 END), 0) AS running_count,
		  COALESCE(SUM(CASE WHEN status IN ('succeeded', 'skipped') THEN 1 ELSE 0 END), 0) AS done_count
		FROM contract_orchestration_step
		WHERE job_id = ?
		  AND deleted_at IS NULL
	`, jobID)
	if err != nil {
		return "", err
	}
	total := numberValue(row["total_count"], 0)
	status := "completed"
	switch {
	case total == 0:
		status = "completed"
	case numberValue(row["cancelled_count"], 0) == total:
		status = "cancelled"
	case numberValue(row["failed_count"], 0) > 0:
		status = "partially_failed"
	case numberValue(row["running_count"], 0) > 0:
		status = "running"
	default:
		status = "completed"
	}
	finishedExpr := "NULL"
	if status == "completed" || status == "partially_failed" || status == "cancelled" {
		finishedExpr = "COALESCE(finished_at, CURRENT_TIMESTAMP)"
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE contract_orchestration_job
		SET status = ?,
		    finished_at = `+finishedExpr+`,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, nullableText(operator), jobID); err != nil {
		return "", err
	}
	return status, a.updateContractActivationStatusTx(ctx, tx, contractID, status, operator)
}

func (a *Adapter) updateContractActivationStatusTx(ctx context.Context, tx *sql.Tx, contractID any, status string, operator string) error {
	columns, err := altocTableColumns(ctx, tx, "contract")
	if err != nil {
		return err
	}
	if !columns["activation_status"] {
		return nil
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE contract
		SET activation_status = ?,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, status, nullableText(operator), contractID)
	return err
}

func (a *Adapter) upsertContractProjectLinkFromActivationTx(ctx context.Context, tx *sql.Tx, contract map[string]any, job map[string]any, result map[string]any, operator string) error {
	items := activationMapSlice(result["projects"])
	if len(items) == 0 && activationProjectCode(result) != "" {
		items = []map[string]any{result}
	}
	if len(items) == 0 {
		return nil
	}
	columns, err := altocTableColumns(ctx, tx, "contract_project_link")
	if err != nil {
		return err
	}
	for _, item := range items {
		if err := a.upsertContractProjectLinkItemFromActivationTx(ctx, tx, contract, job, item, operator, columns); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) upsertContractProjectLinkItemFromActivationTx(ctx context.Context, tx *sql.Tx, contract map[string]any, job map[string]any, result map[string]any, operator string, columns map[string]bool) error {
	projectCode := activationProjectCode(result)
	if projectCode == "" {
		return nil
	}
	plan := nestedMap(result, "plan", "projectPlan", "project_plan")
	projectName := firstNonEmptyText(
		firstBodyText(result, "projectName", "project_name"),
		firstBodyText(nestedMap(result, "project"), "projectName", "project_name", "name"),
	)
	projectRole := firstNonEmptyText(
		firstBodyText(result, "projectRole", "project_role"),
		firstBodyText(plan, "projectRole", "project_role"),
		"delivery",
	)
	linkMode := firstNonEmptyText(firstBodyText(result, "linkMode", "link_mode"), "created_from_contract")
	planKey := firstNonEmptyText(firstBodyText(result, "planKey", "plan_key"), firstBodyText(plan, "planKey", "plan_key"))
	lineCodes := activationStringSlice(firstNonNil(result["lineCodes"], result["line_codes"], plan["lineCodes"], plan["line_codes"]))
	obligationCodes := activationStringSlice(firstNonNil(result["obligationCodes"], result["obligation_codes"], plan["obligationCodes"], plan["obligation_codes"]))

	if columns["plan_key"] && columns["line_codes_json"] && columns["obligation_codes_json"] {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO contract_project_link (
			  contract_id, project_code, project_name_snapshot, project_role, link_mode, status,
			  source_job_id, plan_key, line_codes_json, obligation_codes_json, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
			  project_name_snapshot = COALESCE(VALUES(project_name_snapshot), project_name_snapshot),
			  link_mode = VALUES(link_mode),
			  source_job_id = VALUES(source_job_id),
			  plan_key = COALESCE(VALUES(plan_key), plan_key),
			  line_codes_json = COALESCE(VALUES(line_codes_json), line_codes_json),
			  obligation_codes_json = COALESCE(VALUES(obligation_codes_json), obligation_codes_json),
			  status = 'active',
			  updated_by = VALUES(updated_by),
			  updated_at = CURRENT_TIMESTAMP,
			  deleted_at = NULL
		`, contract["id"], projectCode, nullableText(projectName), projectRole, linkMode, job["id"],
			nullableText(planKey), nullableJSONStringArray(lineCodes), nullableJSONStringArray(obligationCodes),
			nullableText(operator), nullableText(operator))
		if err != nil {
			return err
		}
		link, err := contractProjectLinkByKeyTx(ctx, tx, altocPositiveID(contract["id"]), projectCode, projectRole)
		if err != nil {
			return err
		}
		return a.syncContractProjectStructuredRelationsTx(ctx, tx, contract["id"], link, projectRole, contractProjectRelationInput{
			lineCodes:       uniqueStrings(lineCodes),
			obligationCodes: uniqueStrings(obligationCodes),
			explicit:        len(lineCodes) > 0 || len(obligationCodes) > 0,
		}, true, map[string]any{"operatorUid": operator})
	}

	_, err := tx.ExecContext(ctx, `
		INSERT INTO contract_project_link (
		  contract_id, project_code, project_name_snapshot, project_role, link_mode, status, source_job_id, created_by, updated_by
		) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
		ON DUPLICATE KEY UPDATE
		  project_name_snapshot = COALESCE(VALUES(project_name_snapshot), project_name_snapshot),
		  link_mode = VALUES(link_mode),
		  status = 'active',
		  source_job_id = VALUES(source_job_id),
		  updated_by = VALUES(updated_by),
		  updated_at = CURRENT_TIMESTAMP,
		  deleted_at = NULL
	`, contract["id"], projectCode, nullableText(projectName), projectRole, linkMode, job["id"], nullableText(operator), nullableText(operator))
	if err != nil {
		return err
	}
	link, err := contractProjectLinkByKeyTx(ctx, tx, altocPositiveID(contract["id"]), projectCode, projectRole)
	if err != nil {
		return err
	}
	return a.syncContractProjectStructuredRelationsTx(ctx, tx, contract["id"], link, projectRole, contractProjectRelationInput{
		lineCodes:       uniqueStrings(lineCodes),
		obligationCodes: uniqueStrings(obligationCodes),
		explicit:        len(lineCodes) > 0 || len(obligationCodes) > 0,
	}, true, map[string]any{"operatorUid": operator})
}

func (a *Adapter) syncContractDeliveryAssetsFromActivationTx(ctx context.Context, tx *sql.Tx, contract map[string]any, result map[string]any, operator string) error {
	for _, item := range activationMapSlice(result["items"]) {
		deliveryAssetCode := firstNonEmptyText(altocMapText(item, "delivery_asset_code"), altocMapText(item, "deliveryAssetCode"), altocMapText(item, "code"))
		sourcePlanCode := firstNonEmptyText(altocMapText(item, "source_plan_code"), altocMapText(item, "sourcePlanCode"))
		status := firstNonEmptyText(altocMapText(item, "status"), "planned")
		if deliveryAssetCode == "" {
			continue
		}
		if sourcePlanCode != "" {
			if _, err := tx.ExecContext(ctx, `
				UPDATE contract_delivery_asset_plan
				SET external_asset_code = ?,
				    status = COALESCE(NULLIF(?, ''), status),
				    updated_by = ?,
				    updated_at = CURRENT_TIMESTAMP
				WHERE contract_id = ?
				  AND code = ?
				  AND deleted_at IS NULL
			`, deliveryAssetCode, status, nullableText(operator), contract["id"], sourcePlanCode); err != nil {
				return err
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE contract_delivery_asset_plan
			SET external_asset_code = ?,
			    status = COALESCE(NULLIF(?, ''), status),
			    updated_by = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE contract_id = ?
			  AND (code = ? OR external_asset_code = ?)
			  AND deleted_at IS NULL
		`, deliveryAssetCode, status, nullableText(operator), contract["id"], deliveryAssetCode, deliveryAssetCode); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) ensureContractDeliveryAssetPlansTx(ctx context.Context, tx *sql.Tx, contract map[string]any, jobID any, operator string) (int64, error) {
	var changed int64
	for _, line := range activationMapSlice(contract["lines"]) {
		if activationPolicy(line, "asset_policy") == "none" {
			continue
		}
		lineID := altocPositiveID(line["id"])
		if lineID <= 0 {
			continue
		}
		code := fmt.Sprintf("CDAP-CL-%d", lineID)
		result, err := tx.ExecContext(ctx, `
			INSERT INTO contract_delivery_asset_plan (
			  code, contract_id, contract_line_id, customer_code, name,
			  product_code, product_version, catalog_item_code, product_origin,
			  source_contract_code, source_contract_line_code, planned_delivery_at,
			  license_quantity, unit, status, source_job_id, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?)
			ON DUPLICATE KEY UPDATE
			  name = VALUES(name),
			  product_code = VALUES(product_code),
			  product_version = VALUES(product_version),
			  catalog_item_code = VALUES(catalog_item_code),
			  product_origin = VALUES(product_origin),
			  planned_delivery_at = COALESCE(VALUES(planned_delivery_at), planned_delivery_at),
			  license_quantity = COALESCE(VALUES(license_quantity), license_quantity),
			  unit = COALESCE(VALUES(unit), unit),
			  source_job_id = VALUES(source_job_id),
			  updated_by = VALUES(updated_by),
			  updated_at = CURRENT_TIMESTAMP,
			  deleted_at = NULL
		`, code, contract["id"], lineID, nullableText(altocMapText(contract, "customer_code")),
			firstNonEmptyText(altocMapText(line, "name"), "计划交付资产"),
			nullableText(altocMapText(line, "product_code")),
			nullableText(altocMapText(line, "product_version")),
			nullableText(altocMapText(line, "catalog_item_code")),
			nullableText(altocMapText(line, "product_origin")),
			altocMapText(contract, "code"),
			nullableText(altocMapText(line, "code")),
			nullableText(firstNonEmptyText(altocMapText(line, "service_start_date"), altocMapText(contract, "effective_date"))),
			nullableText(altocMapText(line, "quantity")),
			nullableText(altocMapText(line, "unit")),
			jobID,
			nullableText(operator),
			nullableText(operator),
		)
		if err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		changed += affected
	}
	return changed, nil
}

func (a *Adapter) ensureContractServiceAgreementPlansTx(ctx context.Context, tx *sql.Tx, contract map[string]any, jobID any, operator string) (int64, error) {
	var changed int64
	for _, line := range activationMapSlice(contract["lines"]) {
		if activationPolicy(line, "service_policy") == "none" {
			continue
		}
		lineID := altocPositiveID(line["id"])
		if lineID <= 0 {
			continue
		}
		code := fmt.Sprintf("SA-CL-%d", lineID)
		result, err := tx.ExecContext(ctx, `
			INSERT INTO service_agreement (
			  code, contract_id, contract_line_id, customer_code, name,
			  service_level, service_start_date, service_end_date, service_window,
			  billing_mode, renewal_policy, status, owner_user_id, source_job_id, created_by, updated_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
			  name = VALUES(name),
			  service_level = COALESCE(VALUES(service_level), service_level),
			  service_start_date = COALESCE(VALUES(service_start_date), service_start_date),
			  service_end_date = COALESCE(VALUES(service_end_date), service_end_date),
			  billing_mode = COALESCE(VALUES(billing_mode), billing_mode),
			  owner_user_id = COALESCE(VALUES(owner_user_id), owner_user_id),
			  source_job_id = VALUES(source_job_id),
			  updated_by = VALUES(updated_by),
			  updated_at = CURRENT_TIMESTAMP,
			  deleted_at = NULL
		`, code, contract["id"], lineID, nullableText(altocMapText(contract, "customer_code")),
			firstNonEmptyText(altocMapText(line, "name"), "服务协议"),
			nullableText(activationPolicy(line, "service_policy")),
			nullableText(firstNonEmptyText(altocMapText(line, "service_start_date"), altocMapText(contract, "effective_date"))),
			nullableText(firstNonEmptyText(altocMapText(line, "service_end_date"), altocMapText(contract, "end_date"))),
			nil,
			nullableText(altocMapText(line, "billing_method")),
			nil,
			nullableText(altocMapText(contract, "owner_user_id")),
			jobID,
			nullableText(operator),
			nullableText(operator),
		)
		if err != nil {
			return 0, err
		}
		affected, _ := result.RowsAffected()
		changed += affected
		agreement, err := altocQueryOneMap(ctx, tx, `
			SELECT id, service_start_date, service_end_date
			FROM service_agreement
			WHERE code = ?
			  AND deleted_at IS NULL
			LIMIT 1
		`, code)
		if err != nil || agreement == nil {
			return changed, err
		}
		if err := a.ensureServiceAgreementAssetCoverageTx(ctx, tx, contract["id"], agreement, operator); err != nil {
			return 0, err
		}
	}
	return changed, nil
}

func (a *Adapter) ensureServiceAgreementAssetCoverageTx(ctx context.Context, tx *sql.Tx, contractID any, agreement map[string]any, operator string) error {
	assets, err := a.contractDeliveryAssetPlans(ctx, tx, contractID)
	if err != nil {
		return err
	}
	for _, asset := range assets {
		code := altocMapText(asset, "code")
		if code == "" {
			continue
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO service_agreement_asset (
			  service_agreement_id, delivery_asset_code, coverage_type,
			  coverage_start_date, coverage_end_date, included, created_by, updated_by
			) VALUES (?, ?, 'planned_asset', ?, ?, 1, ?, ?)
			ON DUPLICATE KEY UPDATE
			  coverage_start_date = COALESCE(VALUES(coverage_start_date), coverage_start_date),
			  coverage_end_date = COALESCE(VALUES(coverage_end_date), coverage_end_date),
			  included = 1,
			  updated_by = VALUES(updated_by),
			  updated_at = CURRENT_TIMESTAMP,
			  deleted_at = NULL
		`, agreement["id"], code,
			nullableText(altocMapText(agreement, "service_start_date")),
			nullableText(altocMapText(agreement, "service_end_date")),
			nullableText(operator),
			nullableText(operator),
		)
		if err != nil {
			return err
		}
		if err := ensureServiceAgreementCoverageForAssetTx(ctx, tx, agreement, asset, operator); err != nil {
			return err
		}
	}
	return nil
}

func (a *Adapter) markActivationLocalPlanStepSucceededTx(ctx context.Context, tx *sql.Tx, jobID any, stepKey string, operator string, result map[string]any) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE contract_orchestration_step
		SET status = 'succeeded',
		    result_snapshot = ?,
		    last_error = NULL,
		    updated_by = ?,
		    updated_at = CURRENT_TIMESTAMP
		WHERE job_id = ?
		  AND step_key = ?
		  AND deleted_at IS NULL
	`, jsonColumnText(result), nullableText(operator), jobID, stepKey)
	return err
}

func activationProjectCode(result map[string]any) string {
	return firstNonEmptyText(
		firstBodyText(result, "projectCode", "project_code"),
		firstBodyText(nestedMap(result, "project"), "projectCode", "project_code", "code"),
	)
}

func normalizeActivationStepResultStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "success", "succeed", "succeeded", "completed":
		return "succeeded"
	case "fail", "failed", "error":
		return "failed"
	case "manual", "needs_manual_action", "blocked":
		return "needs_manual_action"
	case "skip", "skipped":
		return "skipped"
	case "running", "planned", "cancelled":
		return strings.TrimSpace(status)
	default:
		return ""
	}
}

func activationNextRetryAt(status string, step map[string]any) any {
	if status != "failed" {
		return nil
	}
	retryCount := numberValue(step["retry_count"], 0) + 1
	if retryCount > numberValue(step["max_retries"], 3) {
		return nil
	}
	delay := time.Duration(1<<minInt(retryCount, 5)) * time.Minute
	return time.Now().UTC().Add(delay).Format("2006-01-02 15:04:05")
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}

func contractActivationStepsFromPlan(plan map[string]any) []contractActivationStepPlan {
	items := make([]contractActivationStepPlan, 0)
	for _, item := range activationMapSlice(plan["steps"]) {
		items = append(items, contractActivationStepPlan{
			Key:                altocMapText(item, "step_key"),
			Name:               altocMapText(item, "name"),
			TargetApp:          altocMapText(item, "target_app"),
			TargetAction:       altocMapText(item, "target_action"),
			DependsOn:          activationStringSlice(item["depends_on_step_keys"]),
			Request:            nestedMap(item, "request_snapshot"),
			Required:           altocBool(item["required"]),
			SortNo:             numberValue(item["sort_no"], 0),
			BlockingDependency: altocBool(item["blocking_dependency"]),
			BlockedReason:      altocMapText(item, "blocked_reason"),
		})
	}
	return items
}

func activationStepPlanMap(step contractActivationStepPlan, contract map[string]any) map[string]any {
	status := "planned"
	if step.BlockingDependency {
		status = "needs_manual_action"
	}
	return map[string]any{
		"step_key":             step.Key,
		"name":                 step.Name,
		"target_app":           step.TargetApp,
		"target_action":        step.TargetAction,
		"depends_on_step_keys": step.DependsOn,
		"idempotency_key":      contractActivationStepIdempotencyKey(contract, step),
		"request_snapshot":     step.Request,
		"required":             step.Required,
		"sort_no":              step.SortNo,
		"status":               status,
		"blocking_dependency":  step.BlockingDependency,
		"blocked_reason":       step.BlockedReason,
	}
}

func contractActivationIdempotencyKey(contract map[string]any, body map[string]any) string {
	if key := firstBodyText(body, "idempotencyKey", "idempotency_key"); key != "" {
		return key
	}
	return fmt.Sprintf("altoc:contract:%s:activation:v1", altocMapText(contract, "code"))
}

func contractActivationStepIdempotencyKey(contract map[string]any, step contractActivationStepPlan) string {
	return fmt.Sprintf("altoc:contract:%s:activation:%s:v1", altocMapText(contract, "code"), step.Key)
}

func activationContractSummary(contract map[string]any) map[string]any {
	return map[string]any{
		"id":                contract["id"],
		"code":              contract["code"],
		"name":              contract["name"],
		"status":            contract["status"],
		"activation_status": contract["activation_status"],
		"primary_type":      contract["primary_type"],
		"template_code":     contract["template_code"],
		"effective_date":    contract["effective_date"],
		"customer_code":     contract["customer_code"],
		"customer_name":     contract["customer_name"],
	}
}

func activationPolicy(line map[string]any, key string) string {
	value := strings.TrimSpace(strings.ToLower(altocMapText(line, key)))
	if value == "" {
		return "none"
	}
	return value
}

func activationProjectPlans(contract map[string]any, lines []map[string]any, obligations []map[string]any, projectLinks []map[string]any) []map[string]any {
	type projectGroup struct {
		key             string
		role            string
		template        string
		required        bool
		lineCodes       []string
		lineIDs         []string
		lineNames       []string
		obligationCodes []string
		obligations     []map[string]any
	}

	groups := make([]*projectGroup, 0)
	byKey := make(map[string]*projectGroup)
	obligationsByLine := activationObligationsByLineID(obligations)
	for _, line := range lines {
		status := strings.TrimSpace(altocMapText(line, "status"))
		if status == "cancelled" || status == "deleted" || activationPolicy(line, "project_policy") == "none" {
			continue
		}
		role := activationProjectRole(line)
		template := altocMapText(line, "project_template_code")
		key := role + "|" + template
		group := byKey[key]
		if group == nil {
			group = &projectGroup{key: key, role: role, template: template}
			byKey[key] = group
			groups = append(groups, group)
		}
		if activationPolicy(line, "project_policy") == "required" {
			group.required = true
		}
		if code := altocMapText(line, "code"); code != "" {
			group.lineCodes = append(group.lineCodes, code)
		}
		if lineID := altocPositiveID(line["id"]); lineID > 0 {
			lineIDText := fmt.Sprint(lineID)
			group.lineIDs = append(group.lineIDs, lineIDText)
			for _, obligation := range obligationsByLine[lineIDText] {
				if code := altocMapText(obligation, "code"); code != "" {
					group.obligationCodes = append(group.obligationCodes, code)
				}
				group.obligations = append(group.obligations, activationObligationRef(obligation, line))
			}
		}
		if name := altocMapText(line, "name"); name != "" {
			group.lineNames = append(group.lineNames, name)
		}
	}

	plans := make([]map[string]any, 0, len(groups))
	for index, group := range groups {
		planKey := activationProjectPlanKey(group.role, group.template, index)
		existingProjectCode := activationExistingProjectCode(projectLinks, group.role, group.lineCodes, planKey)
		action := "create_or_link"
		if existingProjectCode != "" {
			action = "link_existing"
		}
		plans = append(plans, map[string]any{
			"plan_key":           planKey,
			"action":             action,
			"required":           group.required,
			"project_role":       group.role,
			"project_code":       existingProjectCode,
			"project_name":       activationProjectName(contract, group.role, group.lineNames),
			"line_codes":         uniqueStrings(group.lineCodes),
			"line_ids":           uniqueStrings(group.lineIDs),
			"obligation_codes":   uniqueStrings(group.obligationCodes),
			"obligations":        group.obligations,
			"suggested_template": group.template,
			"existing_links":     len(projectLinks),
		})
	}
	return plans
}

func activationProjectLineCodes(projectPlans []map[string]any) []string {
	values := make([]string, 0)
	for _, plan := range projectPlans {
		values = append(values, activationStringSlice(plan["line_codes"])...)
	}
	return uniqueStrings(values)
}

func activationObligationsByLineID(obligations []map[string]any) map[string][]map[string]any {
	result := make(map[string][]map[string]any)
	for _, obligation := range obligations {
		lineID := altocPositiveID(obligation["contract_line_id"])
		if lineID <= 0 {
			continue
		}
		key := fmt.Sprint(lineID)
		result[key] = append(result[key], obligation)
	}
	return result
}

func activationObligationRef(obligation map[string]any, line map[string]any) map[string]any {
	return map[string]any{
		"id":                  obligation["id"],
		"code":                obligation["code"],
		"name":                obligation["name"],
		"obligation_type":     obligation["obligation_type"],
		"status":              obligation["status"],
		"contract_line_code":  line["code"],
		"acceptance_required": obligation["acceptance_required"],
		"planned_due_at":      obligation["planned_due_at"],
	}
}

func activationProjectRole(line map[string]any) string {
	lineType := strings.ToLower(altocMapText(line, "line_type"))
	switch {
	case strings.Contains(lineType, "maintenance") || strings.Contains(lineType, "support") || strings.Contains(lineType, "managed") || activationPolicy(line, "service_policy") != "none":
		return "maintenance"
	case strings.Contains(lineType, "development") || strings.Contains(lineType, "custom"):
		return "development"
	case strings.Contains(lineType, "implementation") || strings.Contains(lineType, "integration"):
		return "implementation"
	default:
		return "delivery"
	}
}

func activationProjectPlanKey(role string, template string, index int) string {
	template = activationKeySegment(template)
	if template != "" {
		return "project-" + role + "-" + template
	}
	if role == "delivery" && index == 0 {
		return "delivery-main"
	}
	return "project-" + role
}

func activationProjectName(contract map[string]any, role string, lineNames []string) string {
	base := firstNonEmptyText(altocMapText(contract, "name"), altocMapText(contract, "code"), "合同项目")
	if len(lineNames) == 1 && lineNames[0] != "" {
		return base + " - " + lineNames[0]
	}
	switch role {
	case "development":
		return base + " - 定制开发"
	case "implementation":
		return base + " - 实施交付"
	case "maintenance":
		return base + " - 运维服务"
	default:
		return base + " - 交付"
	}
}

func activationExistingProjectCode(projectLinks []map[string]any, role string, lineCodes []string, planKey string) string {
	lineSet := make(map[string]bool, len(lineCodes))
	for _, code := range lineCodes {
		lineSet[code] = true
	}
	for _, link := range projectLinks {
		if strings.TrimSpace(altocMapText(link, "status")) == "cancelled" {
			continue
		}
		if planKey != "" && firstBodyText(link, "plan_key") == planKey {
			if code := altocMapText(link, "project_code"); code != "" {
				return code
			}
		}
		if altocMapText(link, "project_role") != role {
			continue
		}
		if code := altocMapText(link, "project_code"); code != "" {
			return code
		}
		for _, lineCode := range activationStringSlice(link["line_codes_json"]) {
			if lineSet[lineCode] {
				if code := altocMapText(link, "project_code"); code != "" {
					return code
				}
			}
		}
	}
	return ""
}

func activationKeySegment(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	lastDash := false
	for _, char := range value {
		valid := (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')
		if valid {
			builder.WriteRune(char)
			lastDash = false
			continue
		}
		if !lastDash {
			builder.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func activationLineCodes(lines []map[string]any, include func(map[string]any) bool) []string {
	values := make([]string, 0)
	for _, line := range lines {
		status := strings.TrimSpace(altocMapText(line, "status"))
		if status == "cancelled" || status == "deleted" || !include(line) {
			continue
		}
		if code := altocMapText(line, "code"); code != "" {
			values = append(values, code)
		}
	}
	return values
}

func activationAnyProjectRequired(lines []map[string]any) bool {
	for _, line := range lines {
		if activationPolicy(line, "project_policy") == "required" {
			return true
		}
	}
	return false
}

func activationDependsOnProject(projectLineCodes []string) []string {
	if len(projectLineCodes) > 0 {
		return []string{"aims_project_link"}
	}
	return []string{"altoc_activate_contract"}
}

func activationDependsOnAssets(assetLineCodes []string) []string {
	if len(assetLineCodes) > 0 {
		return []string{"assets_delivery_assets_plan"}
	}
	return []string{"altoc_activate_contract"}
}

func activationMapSlice(value any) []map[string]any {
	switch typed := value.(type) {
	case nil:
		return nil
	case []map[string]any:
		return typed
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if mapped, ok := item.(map[string]any); ok {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return nil
	}
}

func activationStringSlice(value any) []string {
	switch typed := value.(type) {
	case nil:
		return nil
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := strings.TrimSpace(fmt.Sprint(item)); text != "" && text != "<nil>" {
				result = append(result, text)
			}
		}
		return result
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		var decoded []string
		if err := json.Unmarshal([]byte(text), &decoded); err == nil {
			return decoded
		}
		return []string{text}
	default:
		return nil
	}
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == "<nil>" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func nullableJSONStringArray(values []string) any {
	values = uniqueStrings(values)
	if len(values) == 0 {
		return nil
	}
	encoded, err := json.Marshal(values)
	if err != nil {
		return nil
	}
	return string(encoded)
}

func (a *Adapter) contractProjectLinks(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "contract_project_link")
	if err != nil || !exists {
		return nil, err
	}
	links, err := altocQueryMaps(ctx, conn, `
		SELECT *
		FROM contract_project_link
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY project_role ASC, id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	for _, link := range links {
		if err := a.enrichContractProjectLink(ctx, conn, link); err != nil {
			return nil, err
		}
	}
	return links, nil
}

func (a *Adapter) contractDeliveryAssetPlans(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "contract_delivery_asset_plan")
	if err != nil || !exists {
		return nil, err
	}
	return altocQueryMaps(ctx, conn, `
		SELECT *
		FROM contract_delivery_asset_plan
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY status ASC, id ASC
	`, contractID)
}

func (a *Adapter) contractServiceAgreements(ctx context.Context, conn altocQueryer, contractID any) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "service_agreement")
	if err != nil || !exists {
		return nil, err
	}
	agreements, err := altocQueryMaps(ctx, conn, `
		SELECT *
		FROM service_agreement
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY service_end_date ASC, id ASC
	`, contractID)
	if err != nil {
		return nil, err
	}
	for _, agreement := range agreements {
		coverages, err := serviceAgreementCoverageRows(ctx, conn, agreement["id"])
		if err != nil {
			return nil, err
		}
		coverageSource := "coverage"
		if len(coverages) == 0 {
			coverages, err = legacyServiceAgreementAssetCoverageRows(ctx, conn, agreement["id"])
			if err != nil {
				return nil, err
			}
			coverageSource = "legacy_service_agreement_asset"
		}
		agreement["coverages"] = coverages
		agreement["coverage_source"] = coverageSource
		agreement["assets"] = coverages
		projectRelations, err := a.serviceAgreementProjectRelations(ctx, conn, agreement["id"])
		if err != nil {
			return nil, err
		}
		agreement["project_relations"] = projectRelations
	}
	return agreements, nil
}

func (a *Adapter) contractActivationJobs(ctx context.Context, conn altocQueryer, contractID any, limit int) ([]map[string]any, error) {
	exists, err := altocTableExists(ctx, conn, "contract_orchestration_job")
	if err != nil || !exists {
		return nil, err
	}
	if limit <= 0 {
		limit = 5
	}
	jobs, err := altocQueryMaps(ctx, conn, `
		SELECT *
		FROM contract_orchestration_job
		WHERE contract_id = ?
		  AND deleted_at IS NULL
		ORDER BY created_at DESC, id DESC
		LIMIT ?
	`, contractID, limit)
	if err != nil {
		return nil, err
	}
	for _, job := range jobs {
		steps, err := altocQueryMaps(ctx, conn, `
			SELECT *
			FROM contract_orchestration_step
			WHERE job_id = ?
			  AND deleted_at IS NULL
			ORDER BY sort_no ASC, id ASC
		`, job["id"])
		if err != nil {
			return nil, err
		}
		job["steps"] = steps
	}
	return jobs, nil
}
