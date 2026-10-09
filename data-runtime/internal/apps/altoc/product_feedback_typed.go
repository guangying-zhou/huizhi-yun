package altoc

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

// Closed names: no request can select an arbitrary SQL table.
type ProductFeedbackTables struct{ Ticket, Submission, Status, Progress string }

func LegacyProductFeedbackTables() ProductFeedbackTables {
	return ProductFeedbackTables{"service_ticket", "service_ticket_product_feedback", "product_feedback_status_projection", "product_feedback_progress_projection"}
}
func UnifiedProductFeedbackTables() ProductFeedbackTables {
	return ProductFeedbackTables{"altoc_service_ticket", "altoc_service_ticket_product_feedback", "altoc_product_feedback_status_projection", "altoc_product_feedback_progress_projection"}
}
func (t ProductFeedbackTables) Validate() error {
	if t != LegacyProductFeedbackTables() && t != UnifiedProductFeedbackTables() {
		return httperror.New(403, "feedback_table_binding_invalid", "反馈表映射无效")
	}
	return nil
}
func ParseProductFeedbackStatus(raw []byte) (ProductFeedbackStatus, error) {
	return parseProductFeedbackStatus(raw)
}
func ParseProductFeedbackProgress(raw []byte) (ProductFeedbackProgress, error) {
	return parseProductFeedbackProgress(raw)
}
