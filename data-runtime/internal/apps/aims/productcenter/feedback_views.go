package productcenter

// FeedbackViewNames is the closed compatibility family used by caller-Tx feedback creation.
func FeedbackViewNames() []string {
	return []string{"product_workspaces", "product_members", "product_requests", "product_request_sources", "product_feedback_bindings", "product_activity_logs"}
}
