package aims

import (
	"errors"
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"testing"
)

func TestMilestoneUpdateEmptyDatesFailBeforeDatabase(t *testing.T) {
	for _, key := range []string{"startDate", "start_date", "endDate", "end_date"} {
		for _, value := range []string{"", "  "} {
			_, err := (&Adapter{}).updateDirectMilestoneBody(t.Context(), "1", nil, map[string]any{key: value})
			var denied httperror.Error
			if !errors.As(err, &denied) || denied.Status != 400 || denied.Code != "invalid_milestone_date" || denied.Message != "里程碑日期无效" {
				t.Fatalf("%s: %v", key, err)
			}
		}
	}
	for _, body := range []map[string]any{{}, {"endDate": nil}, {"startDate": "2026-09-27", "endDate": "2026-09-28"}} {
		if err := validateMilestoneUpdateDates(body); err != nil {
			t.Fatal(err)
		}
	}
}
