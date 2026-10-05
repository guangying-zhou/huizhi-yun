package people

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// 入职单资料完善。
//
// HR 在这里确认的是 canonical 事实：部门、岗位、职级、企业邮箱和建议 UID。
// 工号由 People 序列自动分配；钉钉只管理候选侧字段，不参与本路径。

// onboardingEditableStatuses 列出允许 HR 编辑资料的状态。
// 开通已经在途（预留、建号、激活、授权）时改资料会让冻结的 command 与
// 入职单事实不一致，必须先走异常出口回到可编辑状态。
var onboardingEditableStatuses = map[string]bool{
	"awaiting_profile":       true,
	"ready_for_provisioning": true,
	"profile_conflict":       true,
	"identity_conflict":      true,
	"reservation_expired":    true,
	"provisioning_failed":    true,
}

// onboardingRequiredProfileFields 是进入 ready_for_provisioning 前必须齐备的
// 字段。入职日期缺失也不放行：以空日期完成入职会让任职事实从第一天就是错的。
var onboardingRequiredProfileFields = []string{
	"dept_code", "position_code", "rank_code",
	"canonical_uid", "corporate_email", "planned_onboard_date",
}

type onboardingProfileRow struct {
	ID            int64
	Code          string
	Status        string
	ObjectVersion int64
	Values        map[string]string
}

// missingOnboardingProfileFields 返回仍然缺失的必填字段，稳定排序便于 UI 展示
// 和契约测试断言。
func missingOnboardingProfileFields(values map[string]string) []string {
	missing := make([]string, 0, len(onboardingRequiredProfileFields))
	for _, field := range onboardingRequiredProfileFields {
		if strings.TrimSpace(values[field]) == "" {
			missing = append(missing, field)
		}
	}
	sort.Strings(missing)
	return missing
}

// UpdateOnboardingProfile 以 CAS 方式写入 HR 确认的资料。
//
// submit 为 true 时要求必填齐备并推进到 ready_for_provisioning；否则保持
// 可编辑状态，允许 HR 分次填写。
func (a *Adapter) UpdateOnboardingProfile(
	ctx context.Context,
	onboardingCode string,
	body map[string]any,
	actor string,
) (map[string]any, error) {
	code := strings.TrimSpace(onboardingCode)
	if code == "" {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_code_required", "Onboarding code is required")
	}
	if strings.TrimSpace(actor) == "" {
		return nil, httperror.New(http.StatusForbidden, "onboarding_actor_required", "A verified actor is required")
	}
	expected, ok := body["object_version"]
	if !ok {
		expected = body["objectVersion"]
	}
	expectedVersion := int64(intValue(expected))
	if expectedVersion <= 0 {
		return nil, httperror.New(http.StatusBadRequest, "onboarding_version_required",
			"The expected object version is required to update an onboarding case")
	}
	submit := isExplicitTrue(firstNonNil(body["submit"], body["ready"]))

	tx, err := a.DB().BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	row := onboardingProfileRow{Values: map[string]string{}}
	var employeeNo, deptCode, positionCode, rankCode sql.NullString
	var canonicalUID, corporateEmail, plannedOnboardDate, managerUID, employmentType sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT id,onboarding_code,status,object_version,
		employee_no,dept_code,position_code,rank_code,canonical_uid,corporate_email,
		DATE_FORMAT(planned_onboard_date,'%Y-%m-%d'),manager_uid,employment_type
		FROM people_onboarding_cases WHERE onboarding_code=? FOR UPDATE`, code).
		Scan(&row.ID, &row.Code, &row.Status, &row.ObjectVersion,
			&employeeNo, &deptCode, &positionCode, &rankCode, &canonicalUID, &corporateEmail,
			&plannedOnboardDate, &managerUID, &employmentType)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, httperror.New(http.StatusNotFound, "onboarding_case_not_found", "Onboarding case was not found")
	}
	if err != nil {
		return nil, err
	}
	if !onboardingEditableStatuses[row.Status] {
		return nil, httperror.New(http.StatusConflict, "onboarding_status_not_editable",
			"This onboarding case cannot be edited in its current state")
	}
	if row.ObjectVersion != expectedVersion {
		return nil, httperror.New(http.StatusConflict, "onboarding_version_conflict",
			"This onboarding case was changed by someone else; reload and retry")
	}

	row.Values = map[string]string{
		"employee_no": employeeNo.String, "dept_code": deptCode.String,
		"position_code": positionCode.String, "rank_code": rankCode.String,
		"canonical_uid": canonicalUID.String, "corporate_email": corporateEmail.String,
		"planned_onboard_date": plannedOnboardDate.String, "manager_uid": managerUID.String,
		"employment_type": employmentType.String,
	}
	// 只接受白名单字段。钉钉候选侧字段与状态机字段不在其中，HR 不能经由
	// 资料编辑改写来源事实或跳过状态流转。
	for _, field := range []string{
		"dept_code", "position_code", "rank_code",
		"canonical_uid", "corporate_email", "manager_uid", "employment_type",
	} {
		if value, present := body[field]; present {
			row.Values[field] = strings.TrimSpace(cleanAnyString(value))
		}
	}
	if value, present := body["planned_onboard_date"]; present {
		row.Values["planned_onboard_date"] = normalizeDirectoryDate(cleanAnyString(value))
	}
	if strings.TrimSpace(row.Values["employment_type"]) == "" {
		row.Values["employment_type"] = "full_time"
	}
	// dt-* 在候选阶段就被 schema CHECK 拒绝；这里提前给出可读错误，
	// 而不是让调用方收到一条数据库约束报错。
	for _, field := range []string{"canonical_uid", "manager_uid"} {
		if strings.HasPrefix(strings.ToLower(row.Values[field]), "dt-") {
			return nil, httperror.New(http.StatusBadRequest, "onboarding_uid_synthetic",
				"A synthetic dt-* identifier cannot be used as a canonical UID")
		}
	}
	if strings.TrimSpace(row.Values["employee_no"]) == "" {
		row.Values["employee_no"], err = allocateEmployeeNumberTx(ctx, tx)
		if err != nil {
			return nil, err
		}
	}

	missing := missingOnboardingProfileFields(row.Values)
	status := row.Status
	if submit {
		if len(missing) > 0 {
			return nil, httperror.New(http.StatusBadRequest, "onboarding_profile_incomplete",
				"Required onboarding fields are missing: "+strings.Join(missing, ", "))
		}
		status = "ready_for_provisioning"
	} else if status == "ready_for_provisioning" {
		// 已确认的入职单被再次编辑即失效，必须由 HR 重新提交确认。
		status = "awaiting_profile"
	}

	result, err := tx.ExecContext(ctx, `UPDATE people_onboarding_cases SET
			employee_no=NULLIF(?,''), dept_code=NULLIF(?,''), position_code=NULLIF(?,''),
			rank_code=NULLIF(?,''), canonical_uid=NULLIF(?,''), corporate_email=NULLIF(?,''),
			planned_onboard_date=NULLIF(?,''), manager_uid=NULLIF(?,''), employment_type=?,
			status=?, last_error_code=NULL, reservation_id=NULL, provision_operation_id=NULL,
			object_version=object_version+1,
			updated_by=?, updated_at=NOW()
		WHERE id=? AND object_version=?`,
		row.Values["employee_no"], row.Values["dept_code"], row.Values["position_code"],
		row.Values["rank_code"], row.Values["canonical_uid"], row.Values["corporate_email"],
		row.Values["planned_onboard_date"], row.Values["manager_uid"], row.Values["employment_type"],
		status, strings.TrimSpace(actor), row.ID, expectedVersion)
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
		"onboardingCode":   code,
		"status":           status,
		"objectVersion":    expectedVersion + 1,
		"missingFields":    missing,
		"readyToProvision": len(missing) == 0,
	}, nil
}
