package productcenter

import (
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// FeedbackRequest is the frozen Altoc command, not a browser create payload.
// Authentication and current product authorization remain service responsibilities.
// Customer priority and verified flags are deliberately not command fields.
type FeedbackRequest struct {
	ActorUID     string `json:"actorUid"`
	ProductCode  string `json:"productCode"`
	TicketCode   string `json:"ticketCode"`
	RequestBizID string `json:"requestBizId"`
	Title        string `json:"title"`
	Description  string `json:"description"`
	Action       string `json:"action"`
}

func ParseFeedbackRequest(command map[string]any) (FeedbackRequest, error) {
	var out FeedbackRequest
	if len(command) != 7 {
		return out, invalid("product_feedback_command_invalid", "客户反馈命令字段无效")
	}
	for key, target := range map[string]*string{"actorUid": &out.ActorUID, "productCode": &out.ProductCode, "ticketCode": &out.TicketCode, "requestBizId": &out.RequestBizID, "title": &out.Title, "description": &out.Description, "action": &out.Action} {
		value, ok := command[key].(string)
		if !ok {
			return FeedbackRequest{}, invalid("product_feedback_command_invalid", "客户反馈命令字段类型无效")
		}
		*target = value
	}
	if err := ValidateFeedbackRequest(out); err != nil {
		return FeedbackRequest{}, err
	}
	return out, nil
}

func ValidateFeedbackRequest(input FeedbackRequest) error {
	parsed, err := uuid.Parse(input.RequestBizID)
	if err != nil || parsed == uuid.Nil || parsed.String() != input.RequestBizID || input.Action != "create" {
		return invalid("product_feedback_command_invalid", "客户反馈命令身份无效")
	}
	for _, field := range []struct {
		value string
		limit int
	}{{input.ActorUID, 64}, {input.ProductCode, 64}, {input.TicketCode, 30}, {input.Title, 200}} {
		value, limit := field.value, field.limit
		if value == "" || value != strings.TrimSpace(value) || !utf8.ValidString(value) || utf8.RuneCountInString(value) > limit || strings.ContainsFunc(value, unicode.IsControl) {
			return invalid("product_feedback_command_invalid", "客户反馈命令标识或标题无效")
		}
	}
	if strings.ContainsAny(input.ProductCode+input.TicketCode, "/\\") || !utf8.ValidString(input.Description) || utf8.RuneCountInString(input.Description) > 10000 || strings.ContainsRune(input.Description, '\x00') {
		return invalid("product_feedback_command_invalid", "客户反馈说明或产品标识无效")
	}
	return nil
}
