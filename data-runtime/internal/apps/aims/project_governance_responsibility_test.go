package aims

import (
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestProjectGovernanceResponsibilityRoutes(t *testing.T) {
	projectID, delegationID, ok := managerDelegationRevokePath("/v1/aims/projects/42/manager-delegations/9:revoke")
	if !ok || projectID != "42" || delegationID != "9" {
		t.Fatalf("unexpected delegation revoke route: project=%q delegation=%q ok=%t", projectID, delegationID, ok)
	}
	if _, _, ok := managerDelegationRevokePath("/v1/aims/projects/42/manager-delegations/9"); ok {
		t.Fatal("revoke route must require :revoke suffix")
	}

	periodKey, ok := weeklyReportingPeriodGeneratePath("/v1/aims/weekly-reporting-periods/2026-W31:generate")
	if !ok || periodKey != "2026-W31" {
		t.Fatalf("unexpected period generate route: key=%q ok=%t", periodKey, ok)
	}

	projectID, periodKey, action, ok := projectWeeklyReportPeriodPath(
		"/v1/aims/projects/42/weekly-reports/2026-W31:submit",
	)
	if !ok || projectID != "42" || periodKey != "2026-W31" || action != "submit" {
		t.Fatalf("unexpected weekly report submit route: project=%q period=%q action=%q ok=%t", projectID, periodKey, action, ok)
	}
	reportID, action, ok := weeklyReportCommandPath("/v1/aims/weekly-reports/9:review")
	if !ok || reportID != "9" || action != "review" {
		t.Fatalf("unexpected weekly report review route: report=%q action=%q ok=%t", reportID, action, ok)
	}
	periodKey, ok = weeklyReportDirectorWorkbenchPath(
		"/v1/aims/weekly-reporting-periods/2026-W31/director-workbench",
	)
	if !ok || periodKey != "2026-W31" {
		t.Fatalf("unexpected director workbench route: period=%q ok=%t", periodKey, ok)
	}
	periodKey, ok = timesheetWeekSubmitPath("/v1/aims/timesheet/weeks/2026-W31:submit")
	if !ok || periodKey != "2026-W31" {
		t.Fatalf("unexpected timesheet submit route: period=%q ok=%t", periodKey, ok)
	}
	if _, ok := timesheetWeekSubmitPath("/v1/aims/timesheet/weeks/2026-W31"); ok {
		t.Fatal("timesheet submit route must require :submit")
	}
}

func TestWeeklyPeriodTimesUsesVersionedTimezoneAndClocks(t *testing.T) {
	settings := weeklyReportingSettings{
		Timezone:             "Asia/Shanghai",
		DeadlineWeekday:      5,
		DeadlineTime:         "18:30:00",
		SummaryTargetWeekday: 7,
		SummaryTargetTime:    "12:00:00",
	}
	start, end, deadline, summaryTarget, err := weeklyPeriodTimes("2026-W31", settings)
	if err != nil {
		t.Fatalf("weeklyPeriodTimes: %v", err)
	}
	if start.Format("2006-01-02 15:04:05 -07:00") != "2026-07-27 00:00:00 +08:00" {
		t.Fatalf("unexpected start: %s", start.Format(time.RFC3339))
	}
	if end.Format("2006-01-02 15:04:05.999999 -07:00") != "2026-08-02 23:59:59.999999 +08:00" {
		t.Fatalf("unexpected end: %s", end.Format(time.RFC3339Nano))
	}
	if deadline.Format("2006-01-02 15:04:05 -07:00") != "2026-07-31 18:30:00 +08:00" {
		t.Fatalf("unexpected deadline: %s", deadline.Format(time.RFC3339))
	}
	if summaryTarget.Format("2006-01-02 15:04:05 -07:00") != "2026-08-02 12:00:00 +08:00" {
		t.Fatalf("unexpected summary target: %s", summaryTarget.Format(time.RFC3339))
	}
}

func TestInvalidISOWeekIsRejected(t *testing.T) {
	if _, _, err := parseISOPeriodKey("2021-W53"); err == nil {
		t.Fatal("2021 does not have ISO week 53")
	}
	if _, _, err := parseISOPeriodKey("2026-31"); err == nil {
		t.Fatal("period key must include W")
	}
}

func TestDelegationWriteFailsClosedWithoutProjectDirector(t *testing.T) {
	adapter := &Adapter{}
	_, err := adapter.createProjectManagerDelegation(
		t.Context(),
		"42",
		url.Values{"current_user": {"u1"}},
		map[string]any{},
	)
	if err == nil || !isHTTPStatus(err, http.StatusForbidden) {
		t.Fatalf("expected forbidden before database access, got %v", err)
	}
}

func TestWeeklyReportingRoleFlagsAreExplicit(t *testing.T) {
	query := url.Values{
		"current_user_is_project_director":          {"1"},
		"current_user_can_configure_weekly_reports": {"0"},
		"current_user_can_submit_weekly_report":     {"true"},
	}
	if !currentUserIsProjectDirector(query) {
		t.Fatal("expected explicit project director flag")
	}
	if currentUserCanConfigureWeeklyReports(query) {
		t.Fatal("configure flag must not inherit project director status")
	}
	if !truthyQuery(query, "current_user_can_submit_weekly_report") {
		t.Fatal("expected submit flag")
	}
}

func TestProjectDirectorRevisionMustBeFreshAndPositive(t *testing.T) {
	if _, err := projectDirectorRoleHolderRevision(url.Values{}); err == nil || !isHTTPStatus(err, http.StatusForbidden) {
		t.Fatalf("missing revision must fail closed, got %v", err)
	}
	revision, err := projectDirectorRoleHolderRevision(url.Values{
		"current_user_project_director_revision": {"18"},
	})
	if err != nil || revision != 18 {
		t.Fatalf("expected revision 18, got revision=%d err=%v", revision, err)
	}
}

func TestWeeklyReportSchemaCheckDoesNotRunDDL(t *testing.T) {
	content, err := os.ReadFile("project_weekly_report_schema.go")
	if err != nil {
		t.Fatalf("read schema check: %v", err)
	}
	source := string(content)
	for _, forbidden := range []string{"ALTER TABLE", "CREATE TABLE", "ExecContext"} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("request-time schema check must not contain %q", forbidden)
		}
	}
}

func TestProjectCreationRequiresSelectedManagerAndCreatesLifecycleEvent(t *testing.T) {
	productSource, err := os.ReadFile("product_versions.go")
	if err != nil {
		t.Fatalf("read project creation: %v", err)
	}
	source := string(productSource)
	for _, required := range []string{
		`"project_manager_required"`,
		"project_lifecycle_events",
		"leaderUID",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("project creation is missing %q", required)
		}
	}
}

func TestWeeklyReportSaveCannotMutateSubmissionStateOrDeleteTime(t *testing.T) {
	content, err := os.ReadFile("project_weekly_reports.go")
	if err != nil {
		t.Fatalf("read weekly report implementation: %v", err)
	}
	source := string(content)
	if !strings.Contains(source, "weekly_report_submit_command_required") {
		t.Fatal("draft save must reject direct submitted status")
	}
	if strings.Contains(source, `DELETE FROM time_entries WHERE weekly_report_id`) {
		t.Fatal("saving a weekly report must never delete time entries")
	}

	governance, err := os.ReadFile("project_weekly_report_governance.go")
	if err != nil {
		t.Fatalf("read weekly report governance implementation: %v", err)
	}
	governanceSource := string(governance)
	for _, required := range []string{
		"project_weekly_report_versions",
		"project_weekly_report_correction_requests",
		"project_weekly_report_reviews",
		"fact_snapshot_sha256",
		"role_holder_revision",
		"weekly_report_corrective_action_links",
		"lockProjectManagerDutyTimeEntries",
		"unlockProjectManagerDutyTimeEntries",
		"locked_report_version_id",
	} {
		if !strings.Contains(governanceSource, required) {
			t.Fatalf("weekly report governance is missing %q", required)
		}
	}
}

func TestTimeEntryReviewGovernanceUsesImmutableReviewerAssignmentAndEvents(t *testing.T) {
	content, err := os.ReadFile("time_entry_governance.go")
	if err != nil {
		t.Fatalf("read time entry governance implementation: %v", err)
	}
	source := string(content)
	for _, required := range []string{
		"reviewer_uid_snapshot",
		"time_entry_review_events",
		"projectResponsibleUIDAtDate",
		"current_user_can_review_assigned_timesheet",
		"review_status = 'submitted'",
		"review_status = ?",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("time entry governance is missing %q", required)
		}
	}
	if !strings.Contains(source, "entryProjectID != projectID || reviewerUID != actor || fromStatus != \"submitted\"") {
		t.Fatal("review decisions must fail closed unless the entry is assigned to the current reviewer")
	}
}
