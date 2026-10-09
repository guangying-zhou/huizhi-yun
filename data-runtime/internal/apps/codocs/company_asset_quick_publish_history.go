package codocs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

const quickPublishHistoryTrustedQueryKey = "codocs_trusted_company_publish_history"

// This is a publication provenance projection, not a synthetic approval record.
// The BFF only adds its request-target signed marker after administrator authorization.
func (a *Adapter) quickPublishHistoryByPath(ctx context.Context, query url.Values, ossPath, documentUUID string) (map[string]any, error) {
	if _, err := requireTrustedReviewActor(query); err != nil {
		return nil, err
	}
	if query.Get(quickPublishHistoryTrustedQueryKey) != "1" || strings.TrimSuffix(strings.TrimSpace(query.Get("hzy_runtime_source_app")), ".runtime") != "codocs" || !strings.HasPrefix(ossPath, "codocs/company/") {
		return nil, httperror.New(http.StatusForbidden, "company_publish_history_admin_required", "Trusted administrator publication history scope is required")
	}
	operation, err := a.firstRow(ctx, `
  SELECT operation_id,actor_uid,plan_json,created_at,completed_at
  FROM company_asset_quick_publish_operations
  WHERE completed_at IS NOT NULL AND result_json IS NOT NULL
    AND JSON_CONTAINS(JSON_EXTRACT(result_json,'$.imported'),JSON_OBJECT('newUuid',?,'ossPath',?))
  ORDER BY completed_at DESC LIMIT 1`, documentUUID, ossPath)
	if err != nil || operation == nil {
		return nil, err
	}
	var plan quickPublishPlan
	if err = json.Unmarshal([]byte(stringValue(operation["plan_json"])), &plan); err != nil {
		return nil, err
	}
	for _, item := range plan.Items {
		if item.NewUUID != documentUUID || item.OSSPath != ossPath {
			continue
		}
		actor := stringValue(operation["actor_uid"])
		return map[string]any{
			"id":           "quick-publish:" + stringValue(operation["operation_id"]),
			"operation_id": operation["operation_id"], "quick_publish_record": true,
			"source_title": item.Title, "document_uuid": item.SourceUUID, "published_document_uuid": item.NewUUID,
			"review_type": "管理员直接发布", "status": "published", "execution_status": "direct_published",
			"initiator_uid": actor, "created_at": operation["created_at"], "updated_at": operation["completed_at"],
			"flow_snapshot": []any{},
			"actions":       []map[string]any{{"actor_uid": actor, "action": "quick_publish", "comment": "直接发布为组织资产，未经过审批，未发送通知", "created_at": operation["completed_at"]}},
			"seal_records":  []any{}, "send_records": []any{},
		}, nil
	}
	return nil, nil
}
