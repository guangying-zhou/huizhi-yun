package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
)

func TestWriteErrorUsesSafeStandardEnvelope(t *testing.T) {
	recorder := httptest.NewRecorder()
	status, code := writeError(
		recorder,
		"req-1",
		errors.New("dial tcp 10.0.0.2:3306 with password secret failed"),
	)
	if status != http.StatusInternalServerError || code != "internal_error" {
		t.Fatalf("status=%d code=%q", status, code)
	}

	var body errorBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Message != "Internal server error" || !body.Error.Retryable || body.Error.RequestID != "req-1" {
		t.Fatalf("unexpected envelope: %#v", body)
	}
	encoded := recorder.Body.String()
	for _, forbidden := range []string{"10.0.0.2", "3306", "password", "secret"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("error envelope leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestWriteErrorPreservesSafeBusinessErrorAndRetryability(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeError(
		recorder,
		"req-2",
		httperror.New(http.StatusForbidden, "insufficient_scope", "Missing required capability"),
	)

	var body errorBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "insufficient_scope" || body.Error.Message != "Missing required capability" || body.Error.Retryable {
		t.Fatalf("unexpected envelope: %#v", body)
	}
}

func TestReadJSONBodyRejectsPayloadOverOneMiB(t *testing.T) {
	request := httptest.NewRequest(
		http.MethodPost,
		"/v1/console/profile",
		strings.NewReader(`{"value":"`+strings.Repeat("a", (1<<20))+`"}`),
	)
	_, _, err := readJSONBodyWithRaw(request)
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) || httpErr.Status != http.StatusRequestEntityTooLarge || httpErr.Code != "request_body_too_large" {
		t.Fatalf("unexpected error: %T %v", err, err)
	}
}
