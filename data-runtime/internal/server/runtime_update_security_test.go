package server

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	runtimeversion "github.com/huizhi-yun/data-runtime/internal/version"
)

const officialDataRuntimePackageOrigin = "https://downloads.huizhi.yun/packages/hzy-data-runtime"

func TestResolveRuntimeUpdateRequestAcceptsOnlyAllowlistedHTTPSPackageOrigins(t *testing.T) {
	t.Run("official origin", func(t *testing.T) {
		configureRuntimeUpdatePolicy(t)
		t.Setenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL", officialDataRuntimePackageOrigin+"/")

		request, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": "0.3.95"})
		if err != nil {
			t.Fatalf("resolveRuntimeUpdateRequest: %v", err)
		}
		if request.BaseURL != officialDataRuntimePackageOrigin {
			t.Fatalf("BaseURL = %q, want %q", request.BaseURL, officialDataRuntimePackageOrigin)
		}
		if len(request.PackageSourceFingerprint) != 64 {
			t.Fatalf("PackageSourceFingerprint = %q, want SHA-256 hex", request.PackageSourceFingerprint)
		}
	})

	t.Run("explicit operator allowlist", func(t *testing.T) {
		configureRuntimeUpdatePolicy(t)
		const mirror = "https://packages.huizhi.yun/data-runtime"
		t.Setenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL", mirror)
		t.Setenv("HZY_DATA_RUNTIME_ALLOWED_UPDATE_BASE_URLS", mirror)

		request, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": "0.3.95"})
		if err != nil {
			t.Fatalf("resolveRuntimeUpdateRequest: %v", err)
		}
		if request.BaseURL != mirror {
			t.Fatalf("BaseURL = %q, want %q", request.BaseURL, mirror)
		}
	})

	invalidOrigins := []struct {
		name string
		url  string
		code string
	}{
		{name: "http", url: "http://downloads.huizhi.yun/packages/hzy-data-runtime", code: "runtime_update_source_invalid"},
		{name: "userinfo", url: "https://user:password@downloads.huizhi.yun/packages/hzy-data-runtime", code: "runtime_update_source_invalid"},
		{name: "query", url: "https://downloads.huizhi.yun/packages/hzy-data-runtime?channel=latest", code: "runtime_update_source_invalid"},
		{name: "fragment", url: "https://downloads.huizhi.yun/packages/hzy-data-runtime#latest", code: "runtime_update_source_invalid"},
		{name: "arbitrary host", url: "https://attacker.example/packages/hzy-data-runtime", code: "runtime_update_source_not_allowed"},
		{name: "host suffix confusion", url: "https://downloads.huizhi.yun.attacker.example/packages/hzy-data-runtime", code: "runtime_update_source_not_allowed"},
		{name: "arbitrary path", url: "https://downloads.huizhi.yun/packages/other-runtime", code: "runtime_update_source_not_allowed"},
	}
	for _, testCase := range invalidOrigins {
		t.Run(testCase.name, func(t *testing.T) {
			configureRuntimeUpdatePolicy(t)
			t.Setenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL", testCase.url)

			_, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": "0.3.95"})
			assertRuntimeUpdateHTTPError(t, err, http.StatusServiceUnavailable, testCase.code)
		})
	}
}

func TestResolveRuntimeUpdateRequestRejectsPrivilegedHTTPFields(t *testing.T) {
	for _, field := range []string{
		"baseUrl",
		"installDir",
		"serviceName",
		"force",
		"noRestart",
		"unknown",
	} {
		t.Run(field, func(t *testing.T) {
			configureRuntimeUpdatePolicy(t)
			_, err := resolveRuntimeUpdateRequest(map[string]any{
				"targetVersion": "0.3.95",
				field:           "http-controlled",
			})
			assertRuntimeUpdateHTTPError(t, err, http.StatusBadRequest, "runtime_update_field_not_allowed")
		})
	}

	t.Run("install and service come only from trusted process configuration", func(t *testing.T) {
		configureRuntimeUpdatePolicy(t)
		t.Setenv("HZY_DATA_RUNTIME_INSTALL_DIR", "/srv/hzy-data-runtime")
		t.Setenv("HZY_DATA_RUNTIME_SERVICE_NAME", "hzy-data-runtime-prod.service")

		request, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": "0.3.95"})
		if err != nil {
			t.Fatalf("resolveRuntimeUpdateRequest: %v", err)
		}
		if request.InstallDir != "/srv/hzy-data-runtime" {
			t.Fatalf("InstallDir = %q, want trusted process configuration", request.InstallDir)
		}
		if request.ServiceName != "hzy-data-runtime-prod" {
			t.Fatalf("ServiceName = %q, want normalized trusted process configuration", request.ServiceName)
		}
	})
}

func TestResolveRuntimeUpdateRequestRequiresExactVersion(t *testing.T) {
	previousVersion := runtimeversion.Version
	runtimeversion.Version = "dev"
	t.Cleanup(func() { runtimeversion.Version = previousVersion })
	for _, version := range []string{"0.3.95", "0.3.95-rc.1"} {
		t.Run("valid_"+version, func(t *testing.T) {
			configureRuntimeUpdatePolicy(t)
			request, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": version})
			if err != nil {
				t.Fatalf("resolveRuntimeUpdateRequest(%q): %v", version, err)
			}
			if request.TargetVersion != version {
				t.Fatalf("TargetVersion = %q, want %q", request.TargetVersion, version)
			}
		})
	}

	invalidVersions := []any{
		nil,
		123,
		"",
		"latest",
		"v0.3.95",
		"0.3",
		"0.3.95.1",
		"0.3.95?force=1",
		"../0.3.95",
		"0.3.95\nHZY_DATA_RUNTIME_FORCE=1",
	}
	for index, version := range invalidVersions {
		t.Run("invalid_"+strconv.Itoa(index), func(t *testing.T) {
			configureRuntimeUpdatePolicy(t)
			_, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": version})
			assertRuntimeUpdateHTTPError(t, err, http.StatusBadRequest, "runtime_update_version_invalid")
		})
	}

	t.Run("conflicting aliases", func(t *testing.T) {
		configureRuntimeUpdatePolicy(t)
		_, err := resolveRuntimeUpdateRequest(map[string]any{
			"targetVersion": "0.3.95",
			"version":       "0.3.94",
		})
		assertRuntimeUpdateHTTPError(t, err, http.StatusBadRequest, "runtime_update_version_conflict")
	})
}

func TestResolveRuntimeUpdateRequestRejectsHTTPDowngrade(t *testing.T) {
	configureRuntimeUpdatePolicy(t)
	previousVersion := runtimeversion.Version
	runtimeversion.Version = "0.3.95"
	t.Cleanup(func() { runtimeversion.Version = previousVersion })
	_, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": "0.3.94"})
	assertRuntimeUpdateHTTPError(t, err, http.StatusConflict, "runtime_update_downgrade_not_allowed")
	if _, err := resolveRuntimeUpdateRequest(map[string]any{"targetVersion": "0.3.96"}); err != nil {
		t.Fatalf("forward update rejected: %v", err)
	}
}

func TestWriteSystemdUpdateRequestAtomicallyWritesOneAllowlistedFieldAt0600(t *testing.T) {
	configureRuntimeUpdatePolicy(t)
	requestPath := updateRequestPath()
	if err := os.WriteFile(requestPath, []byte("STALE_FIELD=true\n"), 0644); err != nil {
		t.Fatalf("prepare stale request file: %v", err)
	}
	if err := os.Chmod(requestPath, 0644); err != nil {
		t.Fatalf("prepare stale request mode: %v", err)
	}
	oldInfo, err := os.Stat(requestPath)
	if err != nil {
		t.Fatalf("stat stale request file: %v", err)
	}

	if err := writeSystemdUpdateRequest("0.3.95"); err != nil {
		t.Fatalf("writeSystemdUpdateRequest: %v", err)
	}

	content, err := os.ReadFile(requestPath)
	if err != nil {
		t.Fatalf("read update request: %v", err)
	}
	values := parseRuntimeUpdateRequestEnv(t, string(content))
	want := map[string]string{"HZY_DATA_RUNTIME_UPDATE_VERSION": "0.3.95"}
	if len(values) != len(want) || values["HZY_DATA_RUNTIME_UPDATE_VERSION"] != "0.3.95" {
		t.Fatalf("request env = %#v, want %#v", values, want)
	}

	newInfo, err := os.Stat(requestPath)
	if err != nil {
		t.Fatalf("stat update request: %v", err)
	}
	if got := newInfo.Mode().Perm(); got != 0600 {
		t.Errorf("update request mode = %#o, want 0600", got)
	}
	if os.SameFile(oldInfo, newInfo) {
		t.Error("update request must replace the old file atomically, not truncate it in place")
	}
	leftovers, err := filepath.Glob(filepath.Join(filepath.Dir(requestPath), ".update-request-*"))
	if err != nil {
		t.Fatalf("glob temporary request files: %v", err)
	}
	if len(leftovers) != 0 {
		t.Fatalf("temporary update request files were not cleaned up: %#v", leftovers)
	}
}

func configureRuntimeUpdatePolicy(t *testing.T) {
	t.Helper()
	configDir := t.TempDir()
	t.Setenv("HZY_DATA_RUNTIME_CONFIG_DIR", configDir)
	t.Setenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL", officialDataRuntimePackageOrigin)
	t.Setenv("HZY_DATA_RUNTIME_ALLOWED_UPDATE_BASE_URLS", "")
	t.Setenv("HZY_DATA_RUNTIME_INSTALL_DIR", "/opt/hzy-data-runtime")
	t.Setenv("HZY_DATA_RUNTIME_SERVICE_NAME", "hzy-data-runtime")
	if got, want := updateRequestPath(), filepath.Join(configDir, "update-request.env"); got != want {
		t.Fatalf("updateRequestPath() = %q, want %q", got, want)
	}
}

func assertRuntimeUpdateHTTPError(t *testing.T, err error, status int, code string) {
	t.Helper()
	if err == nil {
		t.Fatalf("error = nil, want %d/%s", status, code)
	}
	var httpErr httperror.Error
	if !errors.As(err, &httpErr) {
		t.Fatalf("error = %T, want httperror.Error", err)
	}
	if httpErr.Status != status || httpErr.Code != code {
		t.Fatalf("error = %d/%s, want %d/%s", httpErr.Status, httpErr.Code, status, code)
	}
}

func parseRuntimeUpdateRequestEnv(t *testing.T, content string) map[string]string {
	t.Helper()
	values := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(content), "\n") {
		if line == "" {
			continue
		}
		key, raw, ok := strings.Cut(line, "=")
		if !ok || key == "" {
			t.Fatalf("invalid request env line %q", line)
		}
		value := raw
		if strings.HasPrefix(raw, `"`) {
			unquoted, err := strconv.Unquote(raw)
			if err != nil {
				t.Fatalf("invalid quoted request env line %q: %v", line, err)
			}
			value = unquoted
		}
		if _, duplicate := values[key]; duplicate {
			t.Fatalf("duplicate request env key %q", key)
		}
		values[key] = value
	}
	return values
}
