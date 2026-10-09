package audit

import (
	"encoding/json"
	"log"
	"time"

	"github.com/huizhi-yun/data-runtime/internal/auth"
	"github.com/huizhi-yun/data-runtime/internal/config"
)

type Record struct {
	Timestamp  string `json:"ts"`
	RequestID  string `json:"requestId"`
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	AppCode    string `json:"appCode"`
	Subject    string `json:"subject"`
	Operation  string `json:"operation"`
	Resource   string `json:"resource"`
	DurationMS int64  `json:"durationMs"`
	Result     string `json:"result"`
	Status     int    `json:"status"`
	ErrorCode  string `json:"errorCode,omitempty"`
}

func Log(cfg config.Config, authCtx *auth.Context, requestID string, operation string, resource string, status int, duration time.Duration, errorCode string) {
	record := Record{
		Timestamp:  time.Now().UTC().Format(time.RFC3339Nano),
		RequestID:  requestID,
		Tenant:     cfg.Tenant,
		Deployment: cfg.Deployment,
		Operation:  operation,
		Resource:   resource,
		DurationMS: duration.Milliseconds(),
		Result:     "ok",
		Status:     status,
		ErrorCode:  errorCode,
	}
	if status >= 400 {
		record.Result = "error"
	}
	if authCtx != nil {
		record.Tenant = firstNonEmpty(authCtx.Tenant, record.Tenant)
		record.Deployment = firstNonEmpty(authCtx.Deployment, record.Deployment)
		record.AppCode = authCtx.AppCode
		record.Subject = authCtx.Subject
	}

	content, err := json.Marshal(record)
	if err != nil {
		log.Printf(`{"result":"error","errorCode":"audit_marshal_failed"}`)
		return
	}
	log.Print(string(content))
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
