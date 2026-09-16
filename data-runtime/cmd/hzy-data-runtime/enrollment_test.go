package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunEnrollmentWritesOnlyRedeemedRuntimeConfiguration(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/runtime/enroll" || r.Method != http.MethodPost {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["code"] != "hzy_enr_once" || body["runtimeCode"] != "tenant-prod-runtime" || body["runtimeVersion"] != "0.3.96" || body["releaseSigningKeyId"] != "key-id" {
			t.Fatalf("body = %#v", body)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{
			"runtimeCode":         "tenant-prod-runtime",
			"tenantCode":          "tenant",
			"environment":         "prod",
			"desiredVersion":      "0.3.96",
			"releaseSigningKeyId": "key-id",
			"runtimeToken":        "hzy_dr_runtime",
			"controlToken":        "hzy_ctl_control",
			"deploymentBindings":  map[string]string{"altoc": "tenant-altoc-prod"},
		}})
	}))
	defer server.Close()

	output := filepath.Join(t.TempDir(), "enrollment.env")
	err := runEnrollment([]string{
		"--platform-url", server.URL,
		"--code", "hzy_enr_once",
		"--runtime-code", "tenant-prod-runtime",
		"--expected-version", "0.3.96",
		"--release-signing-key-id", "key-id",
		"--output-env", output,
	})
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, expected := range []string{"HZY_DATA_RUNTIME_STATIC_TOKEN=\"hzy_dr_runtime\"", "HZY_DATA_RUNTIME_CONTROL_TOKEN=\"hzy_ctl_control\"", "HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64="} {
		if !strings.Contains(text, expected) {
			t.Fatalf("output missing %q: %s", expected, text)
		}
	}
	if strings.Contains(text, "hzy_enr_once") {
		t.Fatalf("single-use enrollment code was persisted: %s", text)
	}
}
