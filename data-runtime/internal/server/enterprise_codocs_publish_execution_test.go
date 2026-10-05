package server

import (
	"strings"
	"testing"
	"time"
)

func publishExecutionInput(action string) enterpriseDelegatedInput {
	in := enterpriseCodocsReadInput()
	in.Code = "42"
	in.Authorization.Resource = "publish-execution"
	in.Authorization.Action = action
	switch action {
	case "seal":
		in.Payload = map[string]any{"sealTypes": []any{"official"}, "pageCount": float64(2), "remark": nil}
	case "send":
		in.Payload = map[string]any{"senderUid": "person-b", "receiverName": "Receiver", "receiverPhone": "123", "channel": "email", "sentDate": "2026-09-19", "targetAccount": "a@example.test", "remark": nil}
	case "receive":
		in.Payload = map[string]any{"receiveDate": "2026-09-19"}
	}
	return in
}

func TestEnterpriseCodocsPublishExecutionRoutesAndPermits(t *testing.T) {
	if len(enterpriseCodocsPublishExecutionRoutes) != 3 {
		t.Fatalf("routes=%d", len(enterpriseCodocsPublishExecutionRoutes))
	}
	for _, action := range []string{"seal", "send", "receive"} {
		route, ok := enterpriseCodocsPublishExecutionRoutes["/v1/enterprise/codocs/publish-execution:"+action]
		if !ok || route.Spec.Resource != "publish-execution" || route.Spec.Actions[action].PermitAction != action {
			t.Fatalf("%s route=%#v", action, route)
		}
		in := publishExecutionInput(action)
		query, err := enterpriseCodocsPublishExecutionQuery(in, action, "person-a")
		if err != nil || query.Get("current_user") != "person-a" || query.Get("hzy_runtime_actor_delegated") != "1" {
			t.Fatalf("%s query=%v err=%v", action, query, err)
		}
		if err := validateEnterpriseDelegatedPermit(in, enterpriseCodocsReadVerified(), enterpriseCodocsPublishExecutionSpec, route.Spec.Actions[action], time.Now()); err != nil {
			t.Fatal(err)
		}
		for _, wrong := range []string{"read", "seal", "send", "receive"} {
			if wrong == action {
				continue
			}
			changed := in
			changed.Authorization.Action = wrong
			if validateEnterpriseDelegatedPermit(changed, enterpriseCodocsReadVerified(), enterpriseCodocsPublishExecutionSpec, route.Spec.Actions[action], time.Now()) == nil {
				t.Fatalf("%s accepted %s permit", action, wrong)
			}
		}
	}
}

func TestEnterpriseCodocsPublishExecutionRejectsInjection(t *testing.T) {
	for _, action := range []string{"seal", "send", "receive"} {
		in := publishExecutionInput(action)
		in.Payload["current_user"] = "victim"
		if _, err := enterpriseCodocsPublishExecutionQuery(in, action, "person-a"); err == nil {
			t.Fatalf("%s accepted actor injection", action)
		}
		delete(in.Payload, "current_user")
		in.Query = map[string]string{"owner_uid": "victim"}
		if _, err := enterpriseCodocsPublishExecutionQuery(in, action, "person-a"); err == nil {
			t.Fatalf("%s accepted query injection", action)
		}
		in.Query = nil
		in.Code = "../42"
		if _, err := enterpriseCodocsPublishExecutionQuery(in, action, "person-a"); err == nil {
			t.Fatalf("%s accepted bad id", action)
		}
	}
	in := publishExecutionInput("send")
	in.Payload["remark"] = strings.Repeat("x", 501)
	// Shape validation belongs to the existing owning adapter; the delegated
	// boundary deliberately forwards only allowlisted fields and actor facts.
	if _, err := enterpriseCodocsPublishExecutionQuery(in, "send", "person-a"); err != nil {
		t.Fatal(err)
	}
}
