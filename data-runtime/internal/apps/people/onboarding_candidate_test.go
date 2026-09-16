package people

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestOnboardingCodeIsStablePerProviderSubject(t *testing.T) {
	first := onboardingCodeFor("dingtalk", "ding-new-hire")
	if first != onboardingCodeFor("dingtalk", " ding-new-hire ") {
		t.Fatal("onboarding code must be whitespace stable so DingTalk replays do not create a second case")
	}
	if first == onboardingCodeFor("dingtalk", "ding-other") {
		t.Fatal("different DingTalk subjects must not collide onto one onboarding case")
	}
	if !strings.HasPrefix(first, "ONB-") {
		t.Fatalf("onboarding code=%q", first)
	}
}

func TestCandidateSourceHashOnlyTracksDingTalkManagedFields(t *testing.T) {
	base := map[string]any{
		"candidate_name": "新员工", "mobile": "13800000000",
		"source_onboard_date": "2026-07-01", "manager_provider_subject": "ding-manager",
	}
	hash := candidateSourceHash(base)

	// HR 确认的 canonical 事实不属于钉钉管辖，其变化不应把入职单打回待完善。
	withHRFields := map[string]any{}
	for key, value := range base {
		withHRFields[key] = value
	}
	withHRFields["dept_code"] = "RD"
	withHRFields["position_code"] = "engineer"
	withHRFields["employee_no"] = "999"
	if candidateSourceHash(withHRFields) != hash {
		t.Fatal("HR confirmed fields must not participate in the DingTalk source hash")
	}

	// 关键事实变化必须改变摘要。
	changed := map[string]any{}
	for key, value := range base {
		changed[key] = value
	}
	changed["source_onboard_date"] = "2026-08-01"
	if candidateSourceHash(changed) == hash {
		t.Fatal("a changed onboard date must change the source hash")
	}
}

func TestUpsertOnboardingCandidatesNeverWritesEmployeesOrSyntheticUIDs(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	mock.ExpectExec(`INSERT INTO people_onboarding_cases`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	applied, err := adapter.upsertOnboardingCandidates(context.Background(), []map[string]any{{
		"provider_code": "dingtalk", "provider_subject": "ding-new-hire",
		"candidate_name": "新员工", "employee_no": "E100", "mobile": "13800000000",
		"source_onboard_date": "2026-07-01", "manager_provider_subject": "ding-manager",
	}}, "snapshot-1")
	if err != nil || applied != 1 {
		t.Fatalf("applied=%d err=%v", applied, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestUpsertOnboardingCandidatesSkipsIncompleteRows(t *testing.T) {
	adapter, mock, closeDB := newPeopleSQLMockAdapter(t)
	defer closeDB()

	// 缺 providerSubject 或姓名的条目无法构成稳定候选键，必须跳过而不是建一张残单。
	applied, err := adapter.upsertOnboardingCandidates(context.Background(), []map[string]any{
		{"provider_subject": "", "candidate_name": "新员工"},
		{"provider_subject": "ding-x", "candidate_name": ""},
	}, "snapshot-1")
	if err != nil || applied != 0 {
		t.Fatalf("applied=%d err=%v", applied, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDingTalkSyncNoLongerSynthesizesDTSubjects(t *testing.T) {
	// dt-* 合成是员工业务主键、登录身份和授权主体三者分叉的根因。
	// 该能力已移除，这条守卫防止它以任何形式被重新引入。
	source, err := os.ReadFile("../directory/adapter.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	if strings.Contains(text, "stableDingTalkCode") {
		t.Fatal("the dt-* subject synthesizer must not come back")
	}
	if strings.Contains(text, `"dt"`) || strings.Contains(text, `"dt-"`) {
		t.Fatal("DingTalk resolution must not build a synthetic dt-* identifier")
	}
	if !strings.Contains(text, "dingTalkOnboardingCandidate") {
		t.Fatal("unmatched DingTalk employees must become onboarding candidates")
	}
}

func readPeopleSource(t *testing.T, name string) string {
	t.Helper()
	content, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return string(content)
}
