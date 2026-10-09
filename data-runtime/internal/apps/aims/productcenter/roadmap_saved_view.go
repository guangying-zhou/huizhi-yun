package productcenter

import (
	"strings"
	"unicode/utf8"
)

// A saved view stores presentation and filters only. It never supplies a permit,
// actor, product override or snapshot of accessible data.
type RoadmapSavedViewDefinition struct {
	Title       string `json:"title"`
	Audience    string `json:"audience"`
	Visibility  string `json:"visibility"`
	CycleBizID  string `json:"cycle_biz_id"`
	Year        int    `json:"year"`
	Quarter     int    `json:"quarter"`
	Unscheduled bool   `json:"unscheduled"`
}

func ValidateRoadmapSavedViewDefinition(view RoadmapSavedViewDefinition) error {
	if !utf8.ValidString(view.Title) || strings.TrimSpace(view.Title) == "" || utf8.RuneCountInString(view.Title) > 200 || strings.ContainsRune(view.Title, '\x00') {
		return invalid("roadmap_saved_view_invalid", "视图名称无效")
	}
	switch view.Audience {
	case "planning", "delivery", "stakeholder":
	default:
		return invalid("roadmap_saved_view_invalid", "受众展示方式无效")
	}
	switch view.Visibility {
	case "personal", "product":
	default:
		return invalid("roadmap_saved_view_invalid", "视图可见范围无效")
	}
	return ValidateQuarterRoadmapQuery(view.Query(1, 20))
}

// Pagination is supplied for each read; stored filters cannot request an
// unbounded result or bypass the existing query validation and authorization.
func (view RoadmapSavedViewDefinition) Query(page, pageSize int) QuarterRoadmapQuery {
	return QuarterRoadmapQuery{CycleBizID: view.CycleBizID, Year: view.Year, Quarter: view.Quarter, Unscheduled: view.Unscheduled, Page: page, PageSize: pageSize}
}
