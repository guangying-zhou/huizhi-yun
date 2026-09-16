package people

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// 入职单激活为正式员工。
//
// 只有在 Console 已确认 LDAP 账号创建成功之后才允许调用：调用方必须把
// 已验真的建号 operation ID 一并送来，且必须与入职单记录的一致。这里不接受
// 浏览器声称「账号已创建」——那是设计里明确禁止的信任路径。
//
// 员工创建、首次任职和生命周期冻结在同一事务内完成：任何一步失败都不会
// 留下一个没有任职事实、却已经进入跨应用链路的员工。

func (a *Adapter) BeginOnboardingProvisioning(
	ctx context.Context,
	onboardingCode string,
	expectedVersion int64,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	actor = strings.TrimSpace(actor)
	if code == "" || expectedVersion <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_provisioning_reference_required", "Onboarding code and object version are required")
	}
	if actor == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_onboarding_cases
		SET status='reserving_identity',reservation_id=NULL,provision_operation_id=NULL,
			last_error_code=NULL,object_version=object_version+1,
			updated_by=?,updated_at=NOW()
		WHERE onboarding_code=? AND status IN
			('ready_for_provisioning','reservation_expired','provisioning_failed')
			AND object_version=?`,
		actor, code, expectedVersion)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_version_conflict",
			"This onboarding case was changed by someone else; reload and retry")
	}
	return map[string]any{"onboardingCode": code, "status": "reserving_identity", "objectVersion": expectedVersion + 1}, nil
}

// RecordOnboardingReservation persists the receipt before account provisioning.
// If the BFF crashes afterwards, replaying the frozen service command resumes
// from the same reservation rather than reserving another identity.
func (a *Adapter) RecordOnboardingReservation(
	ctx context.Context,
	onboardingCode string,
	reservationID string,
	expectedVersion int64,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	reservationID = strings.TrimSpace(reservationID)
	actor = strings.TrimSpace(actor)
	if code == "" || reservationID == "" || expectedVersion <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_reservation_reference_required", "Onboarding code and reservation are required")
	}
	if actor == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_onboarding_cases
		SET reservation_id=?,last_error_code=NULL,object_version=object_version+1,
			updated_by=?,updated_at=NOW()
		WHERE onboarding_code=? AND status='reserving_identity' AND object_version=?
		  AND (reservation_id IS NULL OR reservation_id=?)`,
		reservationID, actor, code, expectedVersion, reservationID)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_version_conflict",
			"This onboarding reservation was changed by someone else; reload and retry")
	}
	return map[string]any{"onboardingCode": code, "status": "reserving_identity", "reservationId": reservationID, "objectVersion": expectedVersion + 1}, nil
}

// MarkOnboardingProvisioning records the LDAP operation after the reservation
// receipt has already been persisted.
func (a *Adapter) MarkOnboardingProvisioning(
	ctx context.Context,
	onboardingCode string,
	reservationID string,
	operationID string,
	expectedVersion int64,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	reservationID = strings.TrimSpace(reservationID)
	operationID = strings.TrimSpace(operationID)
	actor = strings.TrimSpace(actor)
	if code == "" || reservationID == "" || operationID == "" || expectedVersion <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_provisioning_reference_required",
			"Onboarding code, reservation, provision operation and object version are required")
	}
	if actor == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_onboarding_cases
		SET provision_operation_id=?, status='provisioning_account',
			last_error_code=NULL, object_version=object_version+1, updated_by=?, updated_at=NOW()
		WHERE onboarding_code=? AND status='reserving_identity' AND object_version=? AND reservation_id=?`,
		operationID, actor, code, expectedVersion, reservationID)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_version_conflict",
			"This onboarding case was changed by someone else; reload and retry")
	}
	return map[string]any{
		"onboardingCode": code, "status": "provisioning_account",
		"objectVersion": expectedVersion + 1,
	}, nil
}

var onboardingFailureStatuses = map[string]bool{
	"profile_conflict":     true,
	"identity_conflict":    true,
	"reservation_expired":  true,
	"provisioning_failed":  true,
	"authorization_failed": true,
}

func (a *Adapter) MarkOnboardingFailure(
	ctx context.Context,
	onboardingCode string,
	status string,
	errorCode string,
	expectedVersion int64,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	status = strings.TrimSpace(status)
	errorCode = strings.TrimSpace(errorCode)
	actor = strings.TrimSpace(actor)
	if code == "" || !onboardingFailureStatuses[status] || errorCode == "" || expectedVersion <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_failure_invalid", "A supported onboarding failure status and error code are required")
	}
	if actor == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_onboarding_cases
		SET status=?,last_error_code=?,reservation_id=NULL,
			object_version=object_version+1,updated_by=?,updated_at=NOW()
		WHERE onboarding_code=? AND status IN ('reserving_identity','provisioning_account') AND object_version=?`,
		status, errorCode, actor, code, expectedVersion)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_version_conflict", "Onboarding failure state could not be recorded")
	}
	return map[string]any{"onboardingCode": code, "status": status, "errorCode": errorCode, "objectVersion": expectedVersion + 1}, nil
}

func (a *Adapter) CancelOnboarding(
	ctx context.Context,
	onboardingCode string,
	reason string,
	expectedVersion int64,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	reason = strings.TrimSpace(reason)
	actor = strings.TrimSpace(actor)
	if code == "" || len([]rune(reason)) < 5 || expectedVersion <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_cancellation_reason_required", "Cancellation reason must contain at least 5 characters")
	}
	if actor == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}
	result, err := a.DB().ExecContext(ctx, `UPDATE people_onboarding_cases
		SET status='cancelled',cancelled_at=NOW(),cancelled_by=?,cancellation_reason=?,
			last_error_code=NULL,object_version=object_version+1,updated_by=?,updated_at=NOW()
		WHERE onboarding_code=? AND object_version=? AND status IN
			('awaiting_profile','ready_for_provisioning','profile_conflict',
			 'identity_conflict','reservation_expired','provisioning_failed')`,
		actor, reason, actor, code, expectedVersion)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_status_not_cancellable", "The account may already be provisioning; use the offboarding flow instead")
	}
	return map[string]any{"onboardingCode": code, "status": "cancelled", "objectVersion": expectedVersion + 1}, nil
}

// ActivateOnboardingEmployee 在单事务内创建员工与首次任职，并冻结既有的
// people.directory.employment-sync.v1，把后续 Console/Platform 生命周期交给
// 现有可靠链路。
func (a *Adapter) ActivateOnboardingEmployee(
	ctx context.Context,
	onboardingCode string,
	verifiedOperationID string,
	actor string,
	trusted integrationoperation.TrustedContext,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	operationID := strings.TrimSpace(verifiedOperationID)
	if code == "" || operationID == "" {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_activation_reference_required",
			"Onboarding code and the verified provision operation are required")
	}
	if strings.TrimSpace(actor) == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var id, objectVersion int64
	var status, candidateName, providerCode, providerSubject string
	var canonicalUID, employeeNo, deptCode, positionCode, rankCode sql.NullString
	var managerUID, employmentType, mobile, corporateEmail, plannedOnboardDate, sourceOnboardDate, storedOperation sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,status,object_version,candidate_name,provider_code,provider_subject,canonical_uid,employee_no,
		dept_code,position_code,rank_code,manager_uid,employment_type,mobile,
		corporate_email,DATE_FORMAT(planned_onboard_date,'%Y-%m-%d'),DATE_FORMAT(source_onboard_date,'%Y-%m-%d'),provision_operation_id
		FROM people_onboarding_cases WHERE onboarding_code=? FOR UPDATE`, code).
		Scan(&id, &status, &objectVersion, &candidateName, &providerCode, &providerSubject, &canonicalUID, &employeeNo,
			&deptCode, &positionCode, &rankCode, &managerUID, &employmentType, &mobile,
			&corporateEmail, &plannedOnboardDate, &sourceOnboardDate, &storedOperation)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "onboarding_case_not_found", "Onboarding case was not found")
	}
	if err != nil {
		return nil, err
	}
	// 回执必须对应这张入职单自己发起的建号操作。
	if strings.TrimSpace(storedOperation.String) != operationID {
		return nil, httperror.New(http.StatusConflict, "onboarding_operation_mismatch",
			"The verified provision operation does not belong to this onboarding case")
	}
	if status == "activating_employee" || status == "projecting_authorization" || status == "completed" {
		// 重放：员工已经创建，直接返回当前状态而不是再建一次。
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{
			"onboardingCode": code, "status": status,
			"employeeUid": canonicalUID.String, "idempotent": true,
		}, nil
	}
	if status != "provisioning_account" {
		return nil, httperror.New(http.StatusConflict, "onboarding_status_not_activatable",
			"This onboarding case is not waiting for account provisioning")
	}
	uid := strings.TrimSpace(canonicalUID.String)
	if uid == "" || strings.HasPrefix(strings.ToLower(uid), "dt-") {
		return nil, httperror.New(http.StatusConflict, "onboarding_uid_unusable",
			"The onboarding case has no usable canonical UID")
	}
	effectiveFrom := strings.TrimSpace(plannedOnboardDate.String)
	if effectiveFrom == "" {
		return nil, httperror.New(http.StatusConflict, "onboarding_onboard_date_required",
			"An onboard date is required before activating the employee")
	}
	employmentTypeValue := strings.TrimSpace(employmentType.String)
	if employmentTypeValue == "" {
		employmentTypeValue = "full_time"
	}
	onboardDateSource := "manual"
	if sourceOnboardDate.Valid && strings.TrimSpace(sourceOnboardDate.String) == effectiveFrom {
		onboardDateSource = "dingtalk"
	}

	if _, err = tx.ExecContext(ctx, `INSERT INTO people_employees
		(employee_uid,employee_no,display_name,initials,login_name,mobile,employment_status,employment_type,
		 dept_code,position_code,rank_code,manager_uid,onboard_date,onboard_date_source,
		 monthly_standard_cost,metadata,created_by,updated_by)
		VALUES (?,?,?,?,?,NULLIF(?,''),'active',?,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),?,?,
			0,JSON_OBJECT('source_app','people','source_biz_type','onboarding_case','onboarding_code',?,
				'directory_user',JSON_OBJECT('provider_code',?,'provider_subject',?,'email',?,'mobile',?)),?,?)
		ON DUPLICATE KEY UPDATE employee_uid=employee_uid`,
		uid, strings.TrimSpace(employeeNo.String), candidateName, initialsFromName(candidateName), uid,
		strings.TrimSpace(mobile.String), employmentTypeValue,
		strings.TrimSpace(deptCode.String), strings.TrimSpace(positionCode.String),
		strings.TrimSpace(rankCode.String), strings.TrimSpace(managerUID.String),
		effectiveFrom, onboardDateSource, code, strings.ToLower(strings.TrimSpace(providerCode)), strings.TrimSpace(providerSubject),
		strings.TrimSpace(corporateEmail.String), strings.TrimSpace(mobile.String),
		strings.TrimSpace(actor), strings.TrimSpace(actor)); err != nil {
		return nil, err
	}

	assignmentCode := stableDirectoryCode("ASN-ONB", code)
	if _, err = tx.ExecContext(ctx, `INSERT INTO people_assignments
		(assignment_code,employee_uid,change_type,effective_from,effective_to,
		 dept_code,position_code,rank_code,manager_uid,is_primary,
		 approval_status,source_app,source_biz_type,source_biz_id,remarks,created_by,updated_by)
		VALUES (?,?,'onboard',?,NULL,NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),NULLIF(?,''),1,
			'approved','people','onboarding_case',?,'Controlled onboarding activation',?,?)
		ON DUPLICATE KEY UPDATE assignment_code=assignment_code`,
		assignmentCode, uid, effectiveFrom,
		strings.TrimSpace(deptCode.String), strings.TrimSpace(positionCode.String),
		strings.TrimSpace(rankCode.String), strings.TrimSpace(managerUID.String),
		code, strings.TrimSpace(actor), strings.TrimSpace(actor)); err != nil {
		return nil, err
	}

	// 冻结既有的 employment-sync operation，把 Console 目录与 Platform 授权
	// 交给现有可靠链路，不在这里另建一条投递路径。
	lifecycle, err := a.freezeDirectoryLifecycleOperationTx(ctx, tx, uid, trusted, strings.TrimSpace(actor), strings.TrimSpace(actor))
	if err != nil {
		return nil, err
	}

	result, err := tx.ExecContext(ctx, `UPDATE people_onboarding_cases
		SET status='activating_employee', last_error_code=NULL,
			object_version=object_version+1, updated_by=?, updated_at=NOW()
		WHERE id=? AND status='provisioning_account'`, strings.TrimSpace(actor), id)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_version_conflict",
			"This onboarding case was changed by someone else; reload and retry")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"onboardingCode": code, "status": "activating_employee",
		"employeeUid": uid, "assignmentCode": assignmentCode,
		"objectVersion": objectVersion + 1, "idempotent": false,
		"directoryLifecycle": lifecycle["directoryLifecycle"],
	}, nil
}

// onboardingAggregationStatuses 是允许状态聚合推进的状态。已完成或已取消的
// 入职单不再受下游状态影响。
var onboardingAggregationStatuses = map[string]bool{
	"activating_employee":      true,
	"projecting_authorization": true,
	"authorization_failed":     true,
}

// AggregateOnboardingStatus 依据已验真的下游状态推进入职单终态。
//
// directoryApplied 表示 Console 目录生命周期已生效；platformStatus 是 Console
// 所有的下一跳授权操作状态。两者都由调用方从 Console 读取后传入——People 不
// 直接访问 Platform。
//
// 按设计与评审结论，completed 只要求 Platform subject 与 baseline 权限成功；
// 岗位角色没有匹配时产生管理员待办，不阻塞入职完成。
func (a *Adapter) AggregateOnboardingStatus(
	ctx context.Context,
	onboardingCode string,
	directoryApplied bool,
	platformStatus string,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	if code == "" {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_code_required", "Onboarding code is required")
	}
	if strings.TrimSpace(actor) == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var id int64
	var status string
	var canonicalUID sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,status,canonical_uid
		FROM people_onboarding_cases WHERE onboarding_code=? FOR UPDATE`, code).
		Scan(&id, &status, &canonicalUID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "onboarding_case_not_found", "Onboarding case was not found")
	}
	if err != nil {
		return nil, err
	}
	if !onboardingAggregationStatuses[status] {
		// 终态与开通前的状态都不受下游影响，直接返回当前状态。
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"onboardingCode": code, "status": status, "changed": false}, nil
	}

	next := status
	errorCode := ""
	switch {
	case strings.EqualFold(platformStatus, "succeeded"):
		next = "completed"
	case strings.EqualFold(platformStatus, "dead_letter"):
		next = "authorization_failed"
		errorCode = "platform_authorization_dead_letter"
	case directoryApplied:
		// 目录已生效但 Platform 尚未收口：这是正常的在途状态，不是失败。
		next = "projecting_authorization"
	}
	if next == status && errorCode == "" {
		if err = tx.Commit(); err != nil {
			return nil, err
		}
		return map[string]any{"onboardingCode": code, "status": status, "changed": false}, nil
	}

	var result sql.Result
	if next == "completed" {
		result, err = tx.ExecContext(ctx, `UPDATE people_onboarding_cases
			SET status='completed', last_error_code=NULL, completed_at=NOW(), completed_by=?,
				object_version=object_version+1, updated_by=?, updated_at=NOW()
			WHERE id=? AND status<>'completed' AND status<>'cancelled' AND canonical_uid IS NOT NULL`,
			strings.TrimSpace(actor), strings.TrimSpace(actor), id)
	} else {
		result, err = tx.ExecContext(ctx, `UPDATE people_onboarding_cases
			SET status=?, last_error_code=NULLIF(?,''),
				object_version=object_version+1, updated_by=?, updated_at=NOW()
			WHERE id=? AND status<>'completed' AND status<>'cancelled'`,
			next, errorCode, strings.TrimSpace(actor), id)
	}
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return nil, httperror.New(http.StatusConflict, "onboarding_status_not_aggregatable",
			"This onboarding case could not be advanced to the reported downstream state")
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"onboardingCode": code, "status": next, "employeeUid": canonicalUID.String, "changed": true,
	}, nil
}
