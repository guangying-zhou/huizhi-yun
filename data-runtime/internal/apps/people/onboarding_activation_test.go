package people

import (
	"context"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

func TestActivationRequiresAVerifiedProvisionOperation(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	// 设计明确禁止相信浏览器声称「账号已创建」：没有已验真的建号 operation
	// 就不允许把候选升格为正式员工。
	if _, err := adapter.ActivateOnboardingEmployee(context.Background(), "ONB-1", "", "hr001",
		integrationoperation.TrustedContext{}); err == nil ||
		!strings.Contains(err.Error(), "provision operation") {
		t.Fatalf("err=%v", err)
	}
	if _, err := adapter.ActivateOnboardingEmployee(context.Background(), "", "op-1", "hr001",
		integrationoperation.TrustedContext{}); err == nil {
		t.Fatal("an empty onboarding code must be rejected")
	}
	if _, err := adapter.ActivateOnboardingEmployee(context.Background(), "ONB-1", "op-1", "",
		integrationoperation.TrustedContext{}); err == nil {
		t.Fatal("an unverified actor must be rejected")
	}
	// 以上都必须在开事务之前失败。
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMarkOnboardingProvisioningRequiresBothReferences(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	// 建号 operation 未记录时后续无法验真回执属于哪一张入职单。
	if _, err := adapter.MarkOnboardingProvisioning(context.Background(), "ONB-1", "res-1", "", 3, "hr001"); err == nil {
		t.Fatal("a missing provision operation must be rejected")
	}
	if _, err := adapter.MarkOnboardingProvisioning(context.Background(), "", "res-1", "op-1", 3, "hr001"); err == nil {
		t.Fatal("an empty onboarding code must be rejected")
	}
	if _, err := adapter.MarkOnboardingProvisioning(context.Background(), "ONB-1", "res-1", "op-1", 3, ""); err == nil {
		t.Fatal("an unverified actor must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOnboardingProvisioningPersistsEachRecoveryCheckpoint(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectExec(`UPDATE people_onboarding_cases\s+SET status='reserving_identity'`).
		WithArgs("hr001", "ONB-1", int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	begun, err := adapter.BeginOnboardingProvisioning(context.Background(), "ONB-1", 3, "hr001")
	if err != nil || begun["status"] != "reserving_identity" || begun["objectVersion"] != int64(4) {
		t.Fatalf("begun=%#v err=%v", begun, err)
	}

	mock.ExpectExec(`UPDATE people_onboarding_cases\s+SET reservation_id=\?`).
		WithArgs("res-1", "hr001", "ONB-1", int64(4), "res-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	reserved, err := adapter.RecordOnboardingReservation(context.Background(), "ONB-1", "res-1", 4, "hr001")
	if err != nil || reserved["reservationId"] != "res-1" || reserved["objectVersion"] != int64(5) {
		t.Fatalf("reserved=%#v err=%v", reserved, err)
	}

	mock.ExpectExec(`UPDATE people_onboarding_cases\s+SET provision_operation_id=\?, status='provisioning_account'`).
		WithArgs("op-1", "hr001", "ONB-1", int64(5), "res-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	provisioning, err := adapter.MarkOnboardingProvisioning(context.Background(), "ONB-1", "res-1", "op-1", 5, "hr001")
	if err != nil || provisioning["status"] != "provisioning_account" || provisioning["objectVersion"] != int64(6) {
		t.Fatalf("provisioning=%#v err=%v", provisioning, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOnboardingFailureAndCancellationHaveExplicitStateTransitions(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectExec(`UPDATE people_onboarding_cases\s+SET status=\?,last_error_code=\?,reservation_id=NULL`).
		WithArgs("identity_conflict", "directory_reservation_identity_mapped", "hr001", "ONB-1", int64(5)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	failed, err := adapter.MarkOnboardingFailure(context.Background(), "ONB-1", "identity_conflict", "directory_reservation_identity_mapped", 5, "hr001")
	if err != nil || failed["status"] != "identity_conflict" || failed["objectVersion"] != int64(6) {
		t.Fatalf("failed=%#v err=%v", failed, err)
	}

	mock.ExpectExec(`UPDATE people_onboarding_cases\s+SET status='cancelled'`).
		WithArgs("hr001", "候选人撤回入职", "hr001", "ONB-1", int64(6)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	cancelled, err := adapter.CancelOnboarding(context.Background(), "ONB-1", "候选人撤回入职", 6, "hr001")
	if err != nil || cancelled["status"] != "cancelled" || cancelled["objectVersion"] != int64(7) {
		t.Fatalf("cancelled=%#v err=%v", cancelled, err)
	}

	if _, err = adapter.MarkOnboardingFailure(context.Background(), "ONB-1", "made_up", "error", 7, "hr001"); err == nil {
		t.Fatal("unsupported failure states must fail before touching the database")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOnboardingActivationSourceKeepsCriticalInvariants(t *testing.T) {
	source := readPeopleSource(t, "onboarding_activation.go")

	// 员工、任职与生命周期冻结必须在同一事务内完成：任何一步失败都不能
	// 留下一个没有任职事实、却已进入跨应用链路的员工。
	for _, fragment := range []string{
		"INSERT INTO people_employees",
		"INSERT INTO people_assignments",
		"freezeDirectoryLifecycleOperationTx",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("activation must perform: %s", fragment)
		}
	}
	// 只看激活函数体：同文件的状态聚合有自己的事务，文件级计数会误判。
	start := strings.Index(source, "func (a *Adapter) ActivateOnboardingEmployee")
	end := strings.Index(source, "// onboardingAggregationStatuses")
	if start < 0 || end <= start {
		t.Fatal("ActivateOnboardingEmployee body must be locatable")
	}
	activation := source[start:end]
	if strings.Count(activation, "BeginTx") != 1 {
		t.Fatal("activation must use a single transaction")
	}
	for _, fragment := range []string{"INSERT INTO people_employees", "INSERT INTO people_assignments", "freezeDirectoryLifecycleOperationTx"} {
		if !strings.Contains(activation, fragment) {
			t.Fatalf("%s must happen inside the activation transaction", fragment)
		}
	}
	// 回执必须属于这张入职单自己发起的操作。
	if !strings.Contains(source, "onboarding_operation_mismatch") {
		t.Fatal("activation must reject a provision operation from another onboarding case")
	}
	// 合成主体不得被激活为正式员工。
	if !strings.Contains(source, `strings.HasPrefix(strings.ToLower(uid), "dt-")`) {
		t.Fatal("activation must refuse synthetic dt-* subjects")
	}
	// 受控入职保留钉钉外部主体，后续 employment lifecycle 才能把既有
	// provider subject 绑定到 HR 确认的 canonical UID。
	if !strings.Contains(activation, `'directory_user',JSON_OBJECT('provider_code',?,'provider_subject',?,'email',?,'mobile',?)`) {
		t.Fatal("activation must persist the reserved external identity in employee metadata")
	}
	// 入职日期缺失不得激活：任职事实会从第一天就是错的。
	if !strings.Contains(source, "onboarding_onboard_date_required") {
		t.Fatal("activation must require an onboard date")
	}
}

func TestStatusAggregationOnlyAdvancesInFlightCases(t *testing.T) {
	// 终态与开通前的状态都不受下游影响。
	for _, status := range []string{"completed", "cancelled", "awaiting_profile", "ready_for_provisioning", "provisioning_account"} {
		if onboardingAggregationStatuses[status] {
			t.Fatalf("status %q must not be advanced by downstream reporting", status)
		}
	}
	// 在途与授权失败必须可被下游状态推进，否则失败后永远无法自愈。
	for _, status := range []string{"activating_employee", "projecting_authorization", "authorization_failed"} {
		if !onboardingAggregationStatuses[status] {
			t.Fatalf("status %q must be advanceable", status)
		}
	}
}

func TestStatusAggregationSourceEncodesTheCompletionRule(t *testing.T) {
	source := readPeopleSource(t, "onboarding_activation.go")
	start := strings.Index(source, "func (a *Adapter) AggregateOnboardingStatus")
	if start < 0 {
		t.Fatal("AggregateOnboardingStatus must exist")
	}
	body := source[start:]

	// completed 只认 Platform 成功回执；目录生效只能推进到待授权。
	if !strings.Contains(body, `strings.EqualFold(platformStatus, "succeeded")`) {
		t.Fatal("completion must require a succeeded platform receipt")
	}
	if !strings.Contains(body, `next = "projecting_authorization"`) {
		t.Fatal("a directory-applied case must rest in projecting_authorization")
	}
	if !strings.Contains(body, `strings.EqualFold(platformStatus, "dead_letter")`) {
		t.Fatal("a dead-lettered platform operation must surface as authorization_failed")
	}
	// 收口必须已经持有 canonical UID，否则等于把候选当成正式员工收口。
	if !strings.Contains(body, "canonical_uid IS NOT NULL") {
		t.Fatal("completion must require a canonical uid")
	}
	// 已取消的入职单不得被下游状态复活。
	if !strings.Contains(body, "status<>'cancelled'") {
		t.Fatal("a cancelled case must never be revived by downstream reporting")
	}
}
