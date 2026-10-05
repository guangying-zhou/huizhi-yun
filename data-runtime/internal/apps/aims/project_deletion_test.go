package aims

import "testing"

func TestProjectDeletionStepsRespectGovernanceForeignKeys(t *testing.T) {
	positions := make(map[string]int, len(projectDeletionSteps))
	for index, step := range projectDeletionSteps {
		positions[step.key] = index
	}

	required := []string{
		"milestoneCompletionLocks",
		"deliverableCurrentSubmissions",
		"weeklyReportPointers",
		"timeEntryCorrectionPointers",
		"timeEntryLockedReportPointers",
		"weeklyReportVersionCorrectionPointers",
		"projectManagementFactCorrectionPointers",
		"weeklySummaryItems",
		"weeklyCorrectiveActionLinks",
		"timeEntryReviewEvents",
		"weeklyReportReviews",
		"weeklyReportCorrectionRequests",
		"weeklyReportVersions",
		"weeklyReportObligations",
		"deliverableQualityReviews",
		"deliverableSubmissions",
		"deliverableWaivers",
		"projectLifecycleEvents",
		"projectManagerDelegations",
		"projectManagementFacts",
	}
	for _, key := range required {
		if _, ok := positions[key]; !ok {
			t.Errorf("project deletion is missing governance cleanup step %q", key)
		}
	}

	mustRunBefore := [][2]string{
		{"milestoneCompletionLocks", "approvals"},
		{"deliverableCurrentSubmissions", "deliverableSubmissions"},
		{"weeklyReportPointers", "weeklyReportVersions"},
		{"timeEntryCorrectionPointers", "timeEntries"},
		{"timeEntryLockedReportPointers", "weeklyReportVersions"},
		{"weeklyReportVersionCorrectionPointers", "weeklyReportVersions"},
		{"projectManagementFactCorrectionPointers", "projectManagementFacts"},
		{"weeklySummaryItems", "weeklyReportObligations"},
		{"weeklyCorrectiveActionLinks", "workItems"},
		{"timeEntryReviewEvents", "timeEntries"},
		{"weeklyReportReviews", "weeklyReportVersions"},
		{"weeklyReportCorrectionRequests", "weeklyReportVersions"},
		{"weeklyReportVersions", "weeklyReports"},
		{"deliverableQualityReviews", "deliverableSubmissions"},
		{"deliverableSubmissions", "deliverables"},
		{"deliverableWaivers", "deliverables"},
		{"projectLifecycleEvents", "projects"},
		{"projectManagerDelegations", "projects"},
		{"projectManagementFacts", "projects"},
	}
	for _, pair := range mustRunBefore {
		before, beforeOK := positions[pair[0]]
		after, afterOK := positions[pair[1]]
		if beforeOK && afterOK && before >= after {
			t.Errorf("project deletion step %q must run before %q", pair[0], pair[1])
		}
	}
}
