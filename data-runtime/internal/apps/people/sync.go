package people

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

const maxContributionSnapshotItems = 2000

func (a *Adapter) syncDirectoryUsers(ctx context.Context, body map[string]any) (map[string]any, error) {
	items, ok := itemsFromBody(body)
	if !ok || len(items) == 0 {
		return nil, httperror.New(http.StatusBadRequest, "empty_directory_user_items", "Directory user items cannot be empty")
	}

	sourceApp := cleanBodyString(body, "source_app", "sourceApp")
	if sourceApp == "" {
		sourceApp = "console"
	}
	sourceBizType := cleanBodyString(body, "source_biz_type", "sourceBizType")
	if sourceBizType == "" {
		sourceBizType = "directory_user"
	}
	dingTalkEmployeeSync := sourceApp == "connector-runtime" && sourceBizType == "dingtalk_hr_employee"

	defaultEffectiveFrom := normalizeDirectoryDate(cleanBodyString(body, "effective_from", "effectiveFrom"))
	if defaultEffectiveFrom == "" {
		defaultEffectiveFrom = time.Now().UTC().Format("2006-01-02")
	}
	createAssignments := !isExplicitFalse(firstNonNil(body["create_assignments"], body["createAssignments"]))
	freezeLifecycle := isExplicitTrue(firstNonNil(body["freeze_directory_lifecycle"], body["freezeDirectoryLifecycle"]))
	var trusted integrationoperation.TrustedContext
	if freezeLifecycle {
		var err error
		trusted, err = integrationoperation.TrustedContextFromMap(body, "people")
		if err != nil {
			return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People lifecycle context is required")
		}
	}

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}

	synced := 0
	assignmentsSynced := 0
	lifecycleFrozen := 0
	// HR 事实源字段级来源统计。缺字段是需要 HR 看见并处理的正常状态，
	// 只统计整条用户级 skipped 无法区分“provider 没下发”和“我们中途丢了”。
	fieldStatus := newDirectoryFieldStatusCounter()
	for _, item := range items {
		employeeUID := cleanBodyString(item, "employee_uid", "employeeUid", "uid")
		if employeeUID == "" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_directory_user_item", "Each directory user item requires uid")
		}

		var employeeNo string
		if dingTalkEmployeeSync {
			// 工号是 People 自主管理的事实。即使旧 Connector 任务重放时仍
			// 携带 jobNumber，也必须忽略，避免钉钉工号重新污染已重排数据。
			employeeNo, err = employeeNumberForDingTalkSyncTx(ctx, tx, employeeUID)
			if err != nil {
				_ = tx.Rollback()
				return nil, err
			}
		} else {
			employeeNo = cleanBodyString(item, "employee_no", "employeeNo", "jobNumber", "employeeNumber")
			if employeeNo == "" {
				employeeNo = employeeUID
			}
		}
		displayName := cleanBodyString(item, "display_name", "displayName", "real_name", "realName", "nickname", "username")
		if displayName == "" {
			displayName = employeeUID
		}
		initials := cleanBodyString(item, "initials")
		if initials == "" {
			initials = initialsFromName(displayName)
		}

		loginName := cleanBodyString(item, "login_name", "loginName", "username")
		deptCode := cleanBodyString(item, "dept_code", "deptCode")
		deptName := cleanBodyString(item, "dept_name", "deptName")
		positionCode := cleanBodyString(item, "position_code", "positionCode")
		positionName := cleanBodyString(item, "position_name", "positionName", "position_title", "positionTitle")
		rankCode := cleanBodyString(item, "rank_code", "rankCode")
		rankName := cleanBodyString(item, "rank_name", "rankName")
		managerUID := cleanBodyString(item, "manager_uid", "managerUid", "managerUID")
		mobile := cleanBodyString(item, "mobile", "mobileNumber", "telephoneNumber")
		mobileKeys := []string{"mobile", "mobileNumber", "telephoneNumber"}
		mobilePresent := sourceTextFieldWritable(item, mobileKeys)
		fieldStatus.observe("mobile", item, mobile, mobileKeys)

		onboardDateKeys := []string{"onboard_date", "onboardDate", "hire_date", "hireDate"}
		rawOnboardDate := cleanBodyString(item, onboardDateKeys...)
		onboardDate := normalizeDirectoryDate(rawOnboardDate)
		fieldStatus.observeDate("onboard_date", item, rawOnboardDate, onboardDate,
			onboardDateKeys)
		// 只有钉钉明确下发有效日期时才接管；字段缺失、显式空值或无效值都保留
		// OA/People 的补录。这样权限暂时缺失不会误清空已有入职日期。
		onboardDateProvided := onboardDate != "" && sourceDateFieldWritable(item, rawOnboardDate, onboardDate, onboardDateKeys)
		fieldStatus.observe("email", item, cleanBodyString(item, "email"), []string{"email"})
		if !dingTalkEmployeeSync {
			fieldStatus.observe("employee_no", item,
				cleanBodyString(item, "employee_no", "employeeNo", "jobNumber", "employeeNumber"),
				[]string{"employee_no", "employeeNo", "jobNumber", "employeeNumber"})
		}
		leaveDate := normalizeDirectoryDate(cleanBodyString(item, "leave_date", "leaveDate"))
		effectiveFrom := normalizeDirectoryDate(cleanBodyString(item, "effective_from", "effectiveFrom"))
		if effectiveFrom == "" {
			effectiveFrom = onboardDate
		}
		if effectiveFrom == "" {
			effectiveFrom = defaultEffectiveFrom
		}

		employmentStatus := normalizeDirectoryEmploymentStatus(firstNonNil(item["employment_status"], item["employmentStatus"], item["status"]))
		employmentType := normalizeDirectoryEmploymentType(firstNonNil(item["employment_type"], item["employmentType"], item["user_type"], item["userType"]))
		sourceBizID := cleanBodyString(item, "source_biz_id", "sourceBizId", "uid")
		if sourceBizID == "" {
			sourceBizID = employeeUID
		}

		metadata := map[string]any{
			"source_app":      sourceApp,
			"source_biz_type": sourceBizType,
			"directory_user":  publicDirectoryEmployeeSnapshot(item),
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO people_employees (
				employee_uid,
				employee_no,
				display_name,
				initials,
				login_name,
				mobile,
				employment_status,
				employment_type,
				dept_code,
				dept_name,
				position_code,
				position_name,
				rank_code,
				rank_name,
				manager_uid,
				onboard_date,
				onboard_date_source,
				leave_date,
				monthly_standard_cost,
				metadata,
				created_by,
				updated_by,
				archived_at
			)
			VALUES (?, ?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), CASE WHEN NULLIF(?, '') IS NULL THEN NULL ELSE 'dingtalk' END, NULLIF(?, ''), 0, ?, ?, ?, NULL)
			ON DUPLICATE KEY UPDATE
				employee_no = CASE
					WHEN people_employees.employee_no = people_employees.employee_uid THEN VALUES(employee_no)
					ELSE people_employees.employee_no
				END,
				display_name = VALUES(display_name),
				initials = COALESCE(VALUES(initials), people_employees.initials),
				login_name = COALESCE(VALUES(login_name), people_employees.login_name),
				mobile = CASE WHEN ? THEN VALUES(mobile) ELSE people_employees.mobile END,
				employment_status = VALUES(employment_status),
				employment_type = VALUES(employment_type),
				dept_code = COALESCE(VALUES(dept_code), people_employees.dept_code),
				dept_name = COALESCE(VALUES(dept_name), people_employees.dept_name),
				position_code = COALESCE(VALUES(position_code), people_employees.position_code),
				position_name = COALESCE(VALUES(position_name), people_employees.position_name),
				rank_code = COALESCE(VALUES(rank_code), people_employees.rank_code),
				rank_name = COALESCE(VALUES(rank_name), people_employees.rank_name),
				manager_uid = COALESCE(VALUES(manager_uid), people_employees.manager_uid),
				onboard_date = CASE WHEN ? THEN VALUES(onboard_date) ELSE people_employees.onboard_date END,
				onboard_date_source = CASE WHEN ? THEN 'dingtalk' ELSE people_employees.onboard_date_source END,
				leave_date = VALUES(leave_date),
				metadata = VALUES(metadata),
				updated_by = VALUES(updated_by),
				archived_at = NULL,
				updated_at = NOW()
		`,
			employeeUID,
			employeeNo,
			displayName,
			nullableString(initials),
			nullableString(loginName),
			mobile,
			employmentStatus,
			employmentType,
			nullableString(deptCode),
			nullableString(deptName),
			nullableString(positionCode),
			nullableString(positionName),
			nullableString(rankCode),
			nullableString(rankName),
			nullableString(managerUID),
			onboardDate,
			onboardDate,
			leaveDate,
			jsonColumnValue(metadata),
			sourceApp,
			sourceApp,
			mobilePresent,
			onboardDateProvided,
			onboardDateProvided,
		); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		if err := a.syncDingTalkPrivateFacts(ctx, tx, employeeUID, sourceBizID, item, fieldStatus); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		synced++

		assignmentCode := cleanBodyString(item, "assignment_code", "assignmentCode")
		if assignmentCode == "" {
			assignmentCode = stableDirectoryCode("ASN-DIR", employeeUID)
		}

		if createAssignments && employmentStatus == "active" {
			var latestAssignmentCode, latestChangeType, latestSourceApp sql.NullString
			latestErr := tx.QueryRowContext(ctx, `SELECT assignment_code,change_type,COALESCE(source_app,'') FROM people_assignments WHERE employee_uid=? AND approval_status IN ('none','approved') ORDER BY effective_from DESC,id DESC LIMIT 1 FOR UPDATE`, employeeUID).Scan(&latestAssignmentCode, &latestChangeType, &latestSourceApp)
			if latestErr != nil && latestErr != sql.ErrNoRows {
				_ = tx.Rollback()
				return nil, latestErr
			}
			if latestErr == nil && latestChangeType.String == "leave" {
				assignmentCode = stableDirectoryCode("ASN-DT-ONB", employeeUID+"-"+effectiveFrom)
			} else if latestErr == nil && latestSourceApp.String == sourceApp && latestChangeType.String != "leave" {
				assignmentCode = latestAssignmentCode.String
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO people_assignments (
					assignment_code,
					employee_uid,
					change_type,
					effective_from,
					effective_to,
					dept_code,
					dept_name,
					position_code,
					position_name,
					rank_code,
					rank_name,
					manager_uid,
					approval_status,
					source_app,
					source_biz_type,
					source_biz_id,
					remarks,
					created_by,
					updated_by
				)
				VALUES (?, ?, 'onboard', ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, 'DingTalk HR employment sync', ?, ?)
				ON DUPLICATE KEY UPDATE
					effective_to = NULL,
					dept_code = VALUES(dept_code),
					dept_name = VALUES(dept_name),
					position_code = VALUES(position_code),
					position_name = VALUES(position_name),
					rank_code = VALUES(rank_code),
					rank_name = VALUES(rank_name),
					manager_uid = VALUES(manager_uid),
					approval_status = VALUES(approval_status),
					source_app = VALUES(source_app),
					source_biz_type = VALUES(source_biz_type),
					source_biz_id = VALUES(source_biz_id),
					updated_by = VALUES(updated_by),
					updated_at = NOW()
			`,
				assignmentCode,
				employeeUID,
				effectiveFrom,
				nullableString(deptCode),
				nullableString(deptName),
				nullableString(positionCode),
				nullableString(positionName),
				nullableString(rankCode),
				nullableString(rankName),
				nullableString(managerUID),
				sourceApp,
				sourceBizType,
				sourceBizID,
				sourceApp,
				sourceApp,
			); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
			// onboard 任职的起始日期就是入职日期。ON DUPLICATE KEY UPDATE 不含
			// effective_from —— 任职区间是历史事实，不该被同步随意改写。但 onboard
			// 这一条是例外：它的起始日期在定义上等于入职日期，入职日期被修正后
			// 必须跟着走，否则会永远停在首次建档那天。
			// 只在员工已有可用入职日期时对齐；1970-01-01 是上游解析失败的产物。
			if _, err := tx.ExecContext(ctx, `
				UPDATE people_assignments a
				INNER JOIN people_employees e ON e.employee_uid = a.employee_uid
				SET a.effective_from = e.onboard_date, a.updated_at = NOW()
				WHERE a.assignment_code = ?
				  AND a.change_type = 'onboard'
				  AND e.onboard_date IS NOT NULL
				  AND e.onboard_date <> '1970-01-01'
				  AND a.effective_from <> e.onboard_date
			`, assignmentCode); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
			assignmentsSynced++
		} else if createAssignments && (employmentStatus == "leaving" || employmentStatus == "left") {
			if _, err := tx.ExecContext(ctx, `
				UPDATE people_assignments
				SET effective_to = DATE_SUB(?, INTERVAL 1 DAY),
				    updated_by = ?,
				    updated_at = NOW()
				WHERE employee_uid = ?
				  AND is_primary = 1
				  AND change_type <> 'leave'
				  AND approval_status IN ('none','approved')
				  AND effective_from < ?
				  AND (effective_to IS NULL OR effective_to >= ?)
			`, effectiveFrom, sourceApp, employeeUID, effectiveFrom, effectiveFrom); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
			leaveAssignmentCode := stableDirectoryCode("ASN-DT-LEAVE", employeeUID+"-"+effectiveFrom)
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO people_assignments (
					assignment_code,employee_uid,change_type,effective_from,effective_to,
					dept_code,dept_name,position_code,position_name,rank_code,rank_name,manager_uid,
					approval_status,source_app,source_biz_type,source_biz_id,remarks,created_by,updated_by
				)
				VALUES (?,?,'leave',?,NULL,?,?,?,?,?,?,?,'approved',?,'dingtalk_hr_leave',?,
					'DingTalk HR resignation sync',?,?)
				ON DUPLICATE KEY UPDATE
					effective_from=VALUES(effective_from),effective_to=NULL,
					dept_code=VALUES(dept_code),dept_name=VALUES(dept_name),
					position_code=VALUES(position_code),position_name=VALUES(position_name),
					rank_code=VALUES(rank_code),rank_name=VALUES(rank_name),
					manager_uid=VALUES(manager_uid),approval_status='approved',
					source_app=VALUES(source_app),source_biz_type=VALUES(source_biz_type),
					source_biz_id=VALUES(source_biz_id),updated_by=VALUES(updated_by),updated_at=NOW()
			`,
				leaveAssignmentCode, employeeUID, effectiveFrom,
				nullableString(deptCode), nullableString(deptName),
				nullableString(positionCode), nullableString(positionName),
				nullableString(rankCode), nullableString(rankName), nullableString(managerUID),
				sourceApp, sourceBizID+"|"+effectiveFrom, sourceApp, sourceApp,
			); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
			assignmentsSynced++
		} else if createAssignments {
			if _, err := tx.ExecContext(ctx, `
				UPDATE people_assignments
				SET effective_to = COALESCE(effective_to, ?),
				    updated_by = ?,
				    updated_at = NOW()
				WHERE assignment_code = ?
			`, effectiveFrom, sourceApp, assignmentCode); err != nil {
				_ = tx.Rollback()
				return nil, err
			}
		}

		if freezeLifecycle {
			effectiveDate, parseErr := time.Parse("2006-01-02", effectiveFrom)
			if parseErr != nil {
				_ = tx.Rollback()
				return nil, httperror.New(http.StatusBadRequest, "directory_lifecycle_effective_date_invalid", "DingTalk employment effective date is invalid")
			}
			if !effectiveDate.After(time.Now().UTC()) {
				if _, err := a.freezeDirectoryLifecycleOperationAtTx(ctx, tx, employeeUID, trusted, "", trusted.ServiceClientID, time.Now().UTC()); err != nil {
					_ = tx.Rollback()
					return nil, err
				}
				lifecycleFrozen++
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return map[string]any{
		"synced":                     synced,
		"assignments_synced":         assignmentsSynced,
		"source_app":                 sourceApp,
		"source_biz_type":            sourceBizType,
		"create_assignments":         createAssignments,
		"default_effective_from":     defaultEffectiveFrom,
		"directory_lifecycle_frozen": lifecycleFrozen,
		"field_status":               fieldStatus.summary(),
	}, nil
}

func (a *Adapter) syncContributions(ctx context.Context, body map[string]any) (map[string]any, error) {
	if err := validateContributionSyncBeforeTransaction(body); err != nil {
		return nil, err
	}
	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	result, err := a.syncContributionsTx(ctx, tx, body)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func validateContributionSyncBeforeTransaction(body map[string]any) error {
	rawItems, ok := body["items"].([]any)
	if !ok {
		return httperror.New(http.StatusBadRequest, "invalid_contribution_items", "Contribution items must be an array")
	}
	for _, raw := range rawItems {
		if _, ok := raw.(map[string]any); !ok {
			return httperror.New(http.StatusBadRequest, "invalid_contribution_item", "Each contribution item must be an object")
		}
	}
	mode := cleanBodyString(body, "sync_mode", "syncMode")
	if mode == "replace_scope" && !isExplicitTrue(firstNonNil(body["snapshot_complete"], body["snapshotComplete"])) {
		return httperror.New(http.StatusBadRequest, "incomplete_contribution_snapshot", "replace_scope requires snapshot_complete=true")
	}
	return nil
}

func (a *Adapter) syncContributionsTx(ctx context.Context, tx *sql.Tx, body map[string]any) (map[string]any, error) {
	rawItems, ok := body["items"].([]any)
	if !ok {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_items", "Contribution items must be an array")
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, rawItem := range rawItems {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_item", "Each contribution item must be an object")
		}
		items = append(items, item)
	}
	if len(items) > maxContributionSnapshotItems {
		return nil, httperror.New(http.StatusBadRequest, "contribution_snapshot_too_large", "Contribution snapshot exceeds the 2000 item limit")
	}

	syncMode := cleanBodyString(body, "sync_mode", "syncMode")
	if syncMode == "" {
		syncMode = "upsert"
	}
	if syncMode != "upsert" && syncMode != "replace_scope" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_sync_mode", "sync_mode must be upsert or replace_scope")
	}
	if len(items) == 0 && syncMode != "replace_scope" {
		return nil, httperror.New(http.StatusBadRequest, "empty_contribution_items", "Contribution items cannot be empty")
	}

	defaultCycleCode := cleanBodyString(body, "cycle_code", "cycleCode")
	periodStart := cleanBodyString(body, "period_start", "periodStart")
	periodEnd := cleanBodyString(body, "period_end", "periodEnd")
	if defaultCycleCode == "" || periodStart == "" || periodEnd == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_cycle_scope", "Contribution sync requires cycle_code, period_start and period_end")
	}
	scopeSourceApp := cleanBodyString(body, "source_app", "sourceApp")
	if syncMode == "replace_scope" && scopeSourceApp == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_replace_scope", "replace_scope requires source_app")
	}
	if scopeSourceApp == "" {
		scopeSourceApp = "aims"
	}
	scopeSourceBizType := cleanBodyString(body, "source_biz_type", "sourceBizType")
	if syncMode == "replace_scope" && scopeSourceBizType == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_replace_scope", "replace_scope requires source_biz_type")
	}
	if syncMode == "replace_scope" && !isExplicitTrue(firstNonNil(body["snapshot_complete"], body["snapshotComplete"])) {
		return nil, httperror.New(http.StatusBadRequest, "incomplete_contribution_snapshot", "replace_scope requires snapshot_complete=true")
	}
	if utf8.RuneCountInString(defaultCycleCode) > 64 || utf8.RuneCountInString(scopeSourceApp) > 64 || utf8.RuneCountInString(scopeSourceBizType) > 64 {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_scope_length", "Contribution cycle and source scope exceed schema limits")
	}
	requestedProjectCode := cleanBodyString(body, "project_code", "projectCode")
	if syncMode == "replace_scope" && requestedProjectCode == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_replace_scope", "replace_scope requires project_code")
	}
	var cycleStatus string
	var err error
	var cycleProjectCode sql.NullString
	var cyclePeriodStart string
	var cyclePeriodEnd string
	err = tx.QueryRowContext(ctx, `
		SELECT
			status,
			project_code,
			DATE_FORMAT(period_start, '%Y-%m-%d'),
			DATE_FORMAT(period_end, '%Y-%m-%d')
		FROM people_performance_cycles
		WHERE cycle_code = ?
		FOR UPDATE
	`, defaultCycleCode).Scan(&cycleStatus, &cycleProjectCode, &cyclePeriodStart, &cyclePeriodEnd)
	if err == sql.ErrNoRows {
		return nil, httperror.New(http.StatusNotFound, "performance_cycle_not_found", "Performance cycle not found")
	}
	if err != nil {
		return nil, err
	}
	if cycleStatus != "collecting" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_not_collecting", "Only a collecting performance cycle accepts contribution sync")
	}
	if cyclePeriodStart != periodStart || cyclePeriodEnd != periodEnd {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_period_mismatch", "Contribution sync period must match the performance cycle")
	}
	if !cycleProjectCode.Valid || strings.TrimSpace(cycleProjectCode.String) == "" {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_project_required", "Contribution replacement requires a project-scoped performance cycle")
	}
	if requestedProjectCode != "" && requestedProjectCode != cycleProjectCode.String {
		return nil, httperror.New(http.StatusConflict, "performance_cycle_project_mismatch", "Contribution project must match the performance cycle")
	}
	sourceRevisionText := cleanBodyString(body, "source_revision", "sourceRevision")
	snapshotHash := cleanBodyString(body, "snapshot_hash", "snapshotHash")
	var sourceRevision uint64
	var advanceContributionWatermark bool
	if sourceRevisionText != "" || snapshotHash != "" {
		sourceRevision, err = strconv.ParseUint(sourceRevisionText, 10, 64)
		if err != nil || sourceRevision == 0 || len(snapshotHash) != 64 {
			return nil, httperror.New(http.StatusBadRequest, "contribution_source_version_invalid", "valid source revision and snapshot hash are required")
		}
		contentHash, err := contributionSnapshotContentHash(body)
		if err != nil {
			return nil, err
		}
		if contentHash != snapshotHash {
			return nil, httperror.New(http.StatusConflict, "contribution_snapshot_hash_mismatch", "contribution snapshot content does not match the declared hash")
		}
		var appliedRevision uint64
		var appliedHash string
		err = tx.QueryRowContext(ctx, `SELECT applied_revision,snapshot_hash FROM people_contribution_scope_versions WHERE cycle_code=? AND project_code=? AND source_app=? AND source_biz_type=? FOR UPDATE`, defaultCycleCode, cycleProjectCode.String, scopeSourceApp, scopeSourceBizType).Scan(&appliedRevision, &appliedHash)
		if err != nil && err != sql.ErrNoRows {
			return nil, err
		}
		switch contributionRevisionDisposition(sourceRevision, snapshotHash, appliedRevision, appliedHash, err == nil) {
		case contributionRevisionStale:
			return map[string]any{"synced": 0, "removed": 0, "sync_mode": syncMode, "staleSkipped": true, "sourceRevision": sourceRevision, "appliedRevision": appliedRevision}, nil
		case contributionRevisionMismatch:
			return nil, httperror.New(http.StatusConflict, "contribution_source_version_hash_mismatch", "same source revision has a different snapshot hash")
		case contributionRevisionSame:
			return map[string]any{"synced": 0, "removed": 0, "sync_mode": syncMode, "idempotent": true, "sourceRevision": sourceRevision, "appliedRevision": appliedRevision}, nil
		}
		advanceContributionWatermark = true
	}

	synced := 0
	identities := make([]contributionSourceIdentity, 0, len(items))
	seenIdentities := make(map[string]struct{}, len(items))
	for _, item := range items {
		cycleCode := cleanBodyString(item, "cycle_code", "cycleCode")
		if cycleCode == "" {
			cycleCode = defaultCycleCode
		}
		employeeUID := cleanBodyString(item, "employee_uid", "employeeUid", "uid")
		if cycleCode == "" || employeeUID == "" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_item", "Each contribution item requires cycle_code and employee_uid")
		}
		if cycleCode != defaultCycleCode {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusConflict, "performance_cycle_item_mismatch", "Each contribution item must match the locked performance cycle")
		}
		if utf8.RuneCountInString(employeeUID) > 64 {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_employee_uid", "Contribution employee_uid exceeds 64 characters")
		}

		contributionCode := cleanBodyString(item, "contribution_code", "contributionCode")
		if syncMode == "replace_scope" && contributionCode != "" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "managed_contribution_code", "replace_scope contribution codes are managed by People runtime")
		}
		if contributionCode == "" {
			contributionCode = generatedCode("CONTR")
		}
		projectCode := cleanBodyString(item, "project_code", "projectCode")
		if !cycleProjectCode.Valid || projectCode == "" || projectCode != cycleProjectCode.String {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusConflict, "performance_cycle_project_mismatch", "Contribution project must match the performance cycle")
		}
		roleCode := cleanBodyString(item, "role_code", "roleCode")
		sourceApp := cleanBodyString(item, "source_app", "sourceApp")
		if sourceApp == "" {
			sourceApp = scopeSourceApp
		}
		sourceBizType := cleanBodyString(item, "source_biz_type", "sourceBizType")
		sourceBizID := cleanBodyString(item, "source_biz_id", "sourceBizId", "source_biz_id")
		if sourceBizType == "" || sourceBizID == "" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_source_identity", "Each contribution item requires source_biz_type and source_biz_id")
		}
		if utf8.RuneCountInString(sourceApp) > 64 || utf8.RuneCountInString(sourceBizType) > 64 || utf8.RuneCountInString(sourceBizID) > 128 {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_source_length", "Contribution source identity exceeds schema limits")
		}
		if syncMode == "replace_scope" && (sourceApp != scopeSourceApp || sourceBizType != scopeSourceBizType) {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "contribution_replace_scope_mismatch", "Each contribution item must match the replacement source scope")
		}
		if syncMode == "replace_scope" {
			identityKey := employeeUID + "\x00" + sourceBizID
			if _, exists := seenIdentities[identityKey]; exists {
				_ = tx.Rollback()
				return nil, httperror.New(http.StatusBadRequest, "duplicate_contribution_source_identity", "Contribution replacement contains a duplicate employee source identity")
			}
			seenIdentities[identityKey] = struct{}{}
			identities = append(identities, contributionSourceIdentity{EmployeeUID: employeeUID, SourceBizID: sourceBizID})
		}
		capturedAt := cleanBodyString(item, "captured_at", "capturedAt")
		if capturedAt == "" {
			capturedAt = cleanBodyString(body, "captured_at", "capturedAt")
		}
		scoreStatus := cleanBodyString(item, "score_status", "scoreStatus")
		rawContributionScore, hasContributionScore := item["contribution_score"]
		if !hasContributionScore {
			rawContributionScore, hasContributionScore = item["contributionScore"]
		}
		var contributionScore any
		if hasContributionScore && rawContributionScore != nil && strings.TrimSpace(cleanAnyString(rawContributionScore)) != "" {
			contributionScore = float64FromAny(rawContributionScore)
			if scoreStatus == "" {
				scoreStatus = "scored"
			}
		} else {
			if scoreStatus == "" {
				scoreStatus = "unscored"
			}
		}
		if scoreStatus != "unscored" && scoreStatus != "scored" {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "invalid_contribution_score_status", "Contribution score_status must be unscored or scored")
		}
		if scoreStatus == "scored" && contributionScore == nil {
			_ = tx.Rollback()
			return nil, httperror.New(http.StatusBadRequest, "missing_contribution_score", "A scored contribution requires contribution_score")
		}
		if scoreStatus == "unscored" {
			contributionScore = nil
		}

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO people_contribution_snapshots (
				contribution_code,
				cycle_code,
				employee_uid,
				project_code,
				role_code,
				work_hours,
				contribution_score,
				score_status,
				source_app,
				source_biz_type,
				source_biz_id,
				source_refs,
				captured_at
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(NULLIF(?, ''), NOW()))
			ON DUPLICATE KEY UPDATE
				project_code = VALUES(project_code),
				role_code = VALUES(role_code),
				work_hours = VALUES(work_hours),
				contribution_score = VALUES(contribution_score),
				score_status = VALUES(score_status),
				source_refs = VALUES(source_refs),
				captured_at = VALUES(captured_at),
				updated_at = NOW()
		`,
			contributionCode,
			cycleCode,
			employeeUID,
			nullableString(projectCode),
			nullableString(roleCode),
			float64FromAny(item["work_hours"]),
			contributionScore,
			scoreStatus,
			sourceApp,
			sourceBizType,
			sourceBizID,
			jsonColumnValue(firstNonNil(item["source_refs"], item["sourceRefs"], body["source_refs"], body["sourceRefs"])),
			capturedAt,
		); err != nil {
			_ = tx.Rollback()
			return nil, err
		}
		synced++
	}

	removed := int64(0)
	if syncMode == "replace_scope" {
		removed, err = deleteMissingContributionSnapshots(
			ctx,
			tx,
			defaultCycleCode,
			cycleProjectCode.String,
			scopeSourceApp,
			scopeSourceBizType,
			identities,
		)
		if err != nil {
			_ = tx.Rollback()
			return nil, err
		}
	}
	if advanceContributionWatermark {
		_, err = tx.ExecContext(ctx, `INSERT INTO people_contribution_scope_versions (cycle_code,project_code,source_app,source_biz_type,applied_revision,snapshot_hash) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE applied_revision=VALUES(applied_revision),snapshot_hash=VALUES(snapshot_hash),updated_at=CURRENT_TIMESTAMP`, defaultCycleCode, cycleProjectCode.String, scopeSourceApp, scopeSourceBizType, sourceRevision, snapshotHash)
		if err != nil {
			return nil, err
		}
	}

	return map[string]any{
		"synced":    synced,
		"removed":   removed,
		"sync_mode": syncMode,
	}, nil
}

type contributionRevisionDecision string

const (
	contributionRevisionApply    contributionRevisionDecision = "apply"
	contributionRevisionStale    contributionRevisionDecision = "stale"
	contributionRevisionSame     contributionRevisionDecision = "same"
	contributionRevisionMismatch contributionRevisionDecision = "mismatch"
)

func contributionRevisionDisposition(incoming uint64, incomingHash string, applied uint64, appliedHash string, exists bool) contributionRevisionDecision {
	if !exists || incoming > applied {
		return contributionRevisionApply
	}
	if incoming < applied {
		return contributionRevisionStale
	}
	if incomingHash != appliedHash {
		return contributionRevisionMismatch
	}
	return contributionRevisionSame
}

func contributionSnapshotContentHash(body map[string]any) (string, error) {
	content := make(map[string]any, len(body))
	for key, value := range body {
		content[key] = value
	}
	for _, key := range []string{
		"source_revision", "sourceRevision", "snapshot_hash", "snapshotHash",
		"current_user", "operator_uid", "current_user_scopes",
		integrationoperation.TrustedTenantCodeKey,
		integrationoperation.TrustedDeploymentCodeKey,
		integrationoperation.TrustedSourceAppKey,
		integrationoperation.TrustedServiceClientIDKey,
		integrationoperation.TrustedRequestIDKey,
		integrationoperation.TrustedServiceCommandTenantKey,
		integrationoperation.TrustedServiceCommandSourceDeploymentKey,
		integrationoperation.TrustedServiceCommandTargetDeploymentKey,
		integrationoperation.TrustedServiceCommandSourceAppKey,
		integrationoperation.TrustedServiceCommandTargetAppKey,
		integrationoperation.TrustedServiceCommandSourceClientKey,
	} {
		delete(content, key)
	}
	return integrationoperation.ValidateAndDigestCommand(content)
}

type contributionSourceIdentity struct {
	EmployeeUID string
	SourceBizID string
}

func deleteMissingContributionSnapshots(
	ctx context.Context,
	tx *sql.Tx,
	cycleCode string,
	projectCode string,
	sourceApp string,
	sourceBizType string,
	identities []contributionSourceIdentity,
) (int64, error) {
	query := `
		DELETE FROM people_contribution_snapshots
		WHERE cycle_code = ?
		  AND project_code = ?
		  AND source_app = ?
		  AND source_biz_type = ?
		  AND confirmed_at IS NULL`
	args := []any{cycleCode, projectCode, sourceApp, sourceBizType}
	if len(identities) > 0 {
		clauses := make([]string, 0, len(identities))
		for _, identity := range identities {
			clauses = append(clauses, "(employee_uid = ? AND source_biz_id = ?)")
			args = append(args, identity.EmployeeUID, identity.SourceBizID)
		}
		query += " AND NOT (" + strings.Join(clauses, " OR ") + ")"
	}
	result, err := tx.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (a *Adapter) workflowCallback(ctx context.Context, body map[string]any) (map[string]any, error) {
	bizType := cleanBodyString(body, "biz_type", "bizType", "resourceCode")
	bizID := cleanBodyString(body, "biz_id", "bizId", "businessKey")
	status := normalizeWorkflowStatus(cleanBodyString(body, "status", "approval_status", "approvalStatus", "result"))
	workflowInstanceID := cleanBodyString(body, "workflow_instance_id", "workflowInstanceId", "instanceId")

	if bizType == "" || bizID == "" || status == "" {
		return nil, httperror.New(http.StatusBadRequest, "invalid_workflow_callback", "Workflow callback requires biz_type, biz_id and status")
	}

	affected := int64(0)
	switch strings.ToLower(bizType) {
	case "assignment", "assignments", "people_assignment":
		if status == "approved" {
			if err := a.ensureWorkflowApprovalPrimaryAssignmentConflictFree(ctx, bizID); err != nil {
				return nil, err
			}
		}
		trusted, err := integrationoperation.TrustedContextFromMap(body, "people")
		if err != nil {
			return nil, httperror.New(http.StatusForbidden, "integration_operation_context_invalid", "trusted People workflow lifecycle context is required")
		}
		tx, err := a.DB().BeginTx(ctx, nil)
		if err != nil {
			return nil, err
		}
		defer tx.Rollback()
		result, err := tx.ExecContext(ctx, `
			UPDATE people_assignments
			SET approval_status = ?,
			    workflow_instance_id = COALESCE(NULLIF(?, ''), workflow_instance_id),
			    updated_at = NOW()
			WHERE assignment_code = ? OR source_biz_id = ?
		`, status, workflowInstanceID, bizID, bizID)
		if err != nil {
			return nil, err
		}
		affected, _ = result.RowsAffected()
		if affected > 0 {
			var employeeUID string
			if err := tx.QueryRowContext(ctx, `SELECT employee_uid FROM people_assignments WHERE assignment_code=? OR source_biz_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE`, bizID, bizID).Scan(&employeeUID); err != nil {
				return nil, err
			}
			metadata, err := a.freezeDirectoryLifecycleOperationTx(ctx, tx, employeeUID, trusted, cleanBodyString(body, "operator_uid", "operatorUid"), trusted.ServiceClientID)
			if err != nil {
				return nil, err
			}
			if lifecycle, ok := metadata["directoryLifecycle"]; ok {
				body["directoryLifecycle"] = lifecycle
			}
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
	case "performance_cycle", "performance_cycles", "cycle":
		if status == "approved" {
			confirmation, err := a.confirmPerformanceCycle(ctx, bizID, nil, map[string]any{
				"workflow_instance_id": workflowInstanceID,
			})
			if err != nil {
				return nil, err
			}
			if changed, _ := confirmation["changed"].(bool); changed {
				affected = 1
			}
		} else {
			changed, err := a.cancelPerformanceCycleFromWorkflow(ctx, bizID, workflowInstanceID)
			if err != nil {
				return nil, err
			}
			if changed {
				affected = 1
			}
		}
	default:
		return nil, httperror.New(http.StatusBadRequest, "unsupported_workflow_biz_type", "Unsupported workflow callback biz_type")
	}

	response := map[string]any{
		"updated":               affected,
		"biz_type":              bizType,
		"biz_id":                bizID,
		"status":                status,
		"workflow_instance_id":  workflowInstanceID,
		"callback_acknowledged": true,
	}
	if lifecycle, ok := body["directoryLifecycle"]; ok {
		response["directoryLifecycle"] = lifecycle
	}
	return response, nil
}

func normalizeWorkflowStatus(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "pass", "passed", "approve", "approved", "success":
		return "approved"
	case "reject", "rejected", "failed":
		return "rejected"
	case "cancel", "cancelled", "canceled":
		return "cancelled"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func normalizeDirectoryDate(value string) string {
	normalized := strings.TrimSpace(value)
	if len(normalized) >= len("2006-01-02") {
		normalized = normalized[:len("2006-01-02")]
	}
	if normalized == "0000-00-00" || normalized == "1970-01-01" {
		return ""
	}
	return normalized
}

func normalizeDirectoryEmploymentStatus(value any) string {
	status := strings.ToLower(strings.TrimSpace(cleanAnyString(value)))
	if status == "" {
		return "active"
	}
	switch status {
	case "1", "active", "enabled", "normal":
		return "active"
	case "leaving":
		return "leaving"
	case "left", "resigned":
		return "left"
	default:
		return "inactive"
	}
}

func normalizeDirectoryEmploymentType(value any) string {
	switch strings.ToLower(strings.TrimSpace(cleanAnyString(value))) {
	case "part_time", "part-time", "parttime":
		return "part_time"
	case "outsourced", "contractor", "external":
		return "outsourced"
	case "intern":
		return "intern"
	case "agent", "bot", "ai_agent":
		return "agent"
	default:
		return "full_time"
	}
}

func isExplicitFalse(value any) bool {
	switch strings.ToLower(strings.TrimSpace(cleanAnyString(value))) {
	case "false", "0", "no", "n", "off":
		return true
	default:
		return false
	}
}

func isExplicitTrue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "1", "true", "yes", "on":
			return true
		}
	case int:
		return typed == 1
	case int64:
		return typed == 1
	case float64:
		return typed == 1
	}
	return false
}

func initialsFromName(value string) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= 2 {
		return string(runes)
	}
	return string(runes[:2])
}

func stableDirectoryCode(prefix string, value string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(value) {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r - 'a' + 'A')
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}
	code := strings.Trim(builder.String(), "-")
	if code == "" {
		return generatedCode(prefix)
	}
	limit := 64 - len(prefix) - 1
	if limit > 0 && len(code) > limit {
		code = code[:limit]
	}
	return prefix + "-" + code
}
