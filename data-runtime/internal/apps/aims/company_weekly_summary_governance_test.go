package aims

import (
	"database/sql"
	"strings"
	"testing"
)

func TestCompanyWeeklySummaryPath(t *testing.T) {
	tests := []struct {
		path      string
		periodKey string
		action    string
		ok        bool
	}{
		{"/v1/aims/company-weekly-summaries/2026-W30", "2026-W30", "", true},
		{"/v1/aims/company-weekly-summaries/2026-W30:generate", "2026-W30", "generate", true},
		{"/v1/aims/company-weekly-summaries/2026-W30/draft", "2026-W30", "draft", true},
		{"/v1/aims/company-weekly-summaries/2026-W30:publish", "2026-W30", "publish", true},
		{"/v1/aims/company-weekly-summaries/2026-W30:open-correction", "2026-W30", "open-correction", true},
		{"/v1/aims/company-weekly-summaries/2026-W30/versions", "2026-W30", "versions", true},
		{"/v1/aims/company-weekly-summaries/", "", "", false},
	}
	for _, test := range tests {
		periodKey, action, ok := companyWeeklySummaryPath(test.path)
		if periodKey != test.periodKey || action != test.action || ok != test.ok {
			t.Fatalf("%s => (%q, %q, %v), want (%q, %q, %v)", test.path, periodKey, action, ok, test.periodKey, test.action, test.ok)
		}
	}
}

func TestValidateResolvedCompanySummaryRecipientsUsesFrozenCoverage(t *testing.T) {
	selections := map[string]int64{"user:u1": 1, "department:d1": 2}
	recipients := []companySummaryResolvedRecipient{
		{SubjectType: "user", SubjectCode: "u1", UID: "u1", DisplayName: "User 1"},
		{SubjectType: "department", SubjectCode: "d1", UID: "u2", DisplayName: "User 2"},
	}
	if err := validateResolvedCompanySummaryRecipients(
		selections,
		recipients,
		[]string{"user:u1", "department:d1"},
	); err != nil {
		t.Fatalf("expected valid recipient coverage: %v", err)
	}
	if err := validateResolvedCompanySummaryRecipients(
		selections,
		recipients,
		[]string{"user:u1"},
	); err == nil {
		t.Fatal("expected incomplete department coverage to fail")
	}
}

func TestRenderCompanySummaryMarkdownClassifiesProjects(t *testing.T) {
	markdown := renderCompanySummaryMarkdown(
		"2026-W30",
		companySummaryDraft{Title: "公司项目周报", Opening: "开篇", Closing: "结语"},
		[]companySummaryObligation{
			{
				ProjectCode: "P1", ProjectName: "项目一", ResponsibleUID: "pm1",
				InclusionStatus: "included", SelectedRAG: sql.NullString{String: "green", Valid: true},
				ManagerContent: []byte(`{"mainWork":"完成一期","majorRisks":"无"}`),
			},
			{ProjectCode: "P2", ProjectName: "项目二", InclusionStatus: "missing"},
			{ProjectCode: "P3", ProjectName: "项目三", InclusionStatus: "late_unincluded"},
		},
		2,
		true,
	)
	for _, expected := range []string{
		"# 公司项目周报",
		"版本：R2（更正版）",
		"已纳入：1 个项目",
		"缺报：1 个项目",
		"已审阅但未纳入：1 个项目",
		"完成一期",
		"项目二（P2）",
		"结语",
	} {
		if !strings.Contains(markdown, expected) {
			t.Fatalf("expected markdown to contain %q:\n%s", expected, markdown)
		}
	}
}
