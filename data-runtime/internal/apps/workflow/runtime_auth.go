package workflow

import "net/url"

var workflowRuntimeAuthKeys = map[string]bool{
	"current_user": true,
	"currentUser":  true,
	"operator_uid": true,
	"operatorUid":  true,
	"actor_uid":    true,
	"actorUid":     true,
}

func workflowRuntimeBodyFromRequest(query url.Values, body map[string]any) map[string]any {
	actor := workflowRuntimeActorFromQuery(query)
	if actor == "" {
		return body
	}

	result := map[string]any{}
	for key, value := range body {
		if workflowRuntimeAuthKeys[key] {
			continue
		}
		result[key] = value
	}
	result["current_user"] = actor
	result["operator_uid"] = actor
	return result
}

func workflowRuntimeActorFromQuery(query url.Values) string {
	if query == nil {
		return ""
	}
	return firstNonEmptyString(
		query.Get("current_user"),
		query.Get("currentUser"),
		query.Get("operator_uid"),
		query.Get("operatorUid"),
		query.Get("actor_uid"),
		query.Get("actorUid"),
	)
}
