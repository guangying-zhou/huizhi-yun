package aims

import (
	"strings"
)

func serviceTicketDeliveryStage(status string) (deliveryStatus string, captureResponse int, captureResolution int) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "planning", "todo":
		return "accepted", 0, 0
	case "in_progress":
		return "processing", 1, 0
	case "in_review":
		return "resolved", 1, 1
	case "completed":
		return "closed", 1, 1
	default:
		return "", 0, 0
	}
}
