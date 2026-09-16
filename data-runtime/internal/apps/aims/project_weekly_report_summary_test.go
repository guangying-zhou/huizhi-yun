package aims

import (
	"os"
	"strings"
	"testing"
)

func TestProjectWeeklyReportSummaryAppliesProjectVisibilityWhere(t *testing.T) {
	contentBytes, err := os.ReadFile("project_weekly_report_summary.go")
	if err != nil {
		t.Fatal(err)
	}
	content := string(contentBytes)
	visibilityCall := `projectVisibilityWhere(query, "p", currentUser)`
	queryCall := "rows, err := a.DB().QueryContext"

	visibilityIndex := strings.Index(content, visibilityCall)
	if visibilityIndex < 0 {
		t.Fatalf("expected project weekly report summary to call %s", visibilityCall)
	}
	queryIndex := strings.Index(content, queryCall)
	if queryIndex < 0 {
		t.Fatalf("expected project weekly report summary to query runtime data")
	}
	if visibilityIndex > queryIndex {
		t.Fatalf("expected project visibility filter to be built before summary query")
	}
}
