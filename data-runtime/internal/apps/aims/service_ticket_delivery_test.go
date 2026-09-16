package aims

import (
	"testing"
)

func TestServiceTicketDeliveryStage(t *testing.T) {
	tests := []struct {
		status     string
		delivery   string
		response   int
		resolution int
	}{
		{"todo", "accepted", 0, 0},
		{"in_progress", "processing", 1, 0},
		{"in_review", "resolved", 1, 1},
		{"completed", "closed", 1, 1},
		{"cancelled", "", 0, 0},
	}
	for _, tt := range tests {
		delivery, response, resolution := serviceTicketDeliveryStage(tt.status)
		if delivery != tt.delivery || response != tt.response || resolution != tt.resolution {
			t.Fatalf("stage(%q) = (%q,%d,%d), want (%q,%d,%d)", tt.status, delivery, response, resolution, tt.delivery, tt.response, tt.resolution)
		}
	}
}
