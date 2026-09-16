package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/updater"
	runtimeversion "github.com/huizhi-yun/data-runtime/internal/version"
)

var exactRuntimeVersionPattern = regexp.MustCompile(`^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$`)
var operationIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:@/-]{1,160}$`)

type runtimeUpdateRequest struct {
	BaseURL                  string
	TargetVersion            string
	InstallDir               string
	ServiceName              string
	PackageSourceFingerprint string
}

func resolveRuntimeUpdateRequest(body map[string]any) (runtimeUpdateRequest, error) {
	for key := range body {
		if key != "targetVersion" && key != "version" {
			return runtimeUpdateRequest{}, httperror.New(
				http.StatusBadRequest,
				"runtime_update_field_not_allowed",
				"Runtime update accepts only an exact targetVersion",
			)
		}
	}

	targetVersion, err := exactUpdateVersion(body)
	if err != nil {
		return runtimeUpdateRequest{}, err
	}
	if comparison, comparable := compareSemanticVersions(targetVersion, runtimeversion.Version); comparable && comparison < 0 {
		return runtimeUpdateRequest{}, httperror.New(
			http.StatusConflict,
			"runtime_update_downgrade_not_allowed",
			"Runtime downgrade requires the guarded manual rollback or update workflow",
		)
	}
	baseURL, err := trustedUpdateBaseURL()
	if err != nil {
		return runtimeUpdateRequest{}, err
	}
	installDir := firstNonEmptyText(os.Getenv("HZY_DATA_RUNTIME_INSTALL_DIR"), "/opt/hzy-data-runtime")
	if !filepath.IsAbs(installDir) || filepath.Clean(installDir) != installDir {
		return runtimeUpdateRequest{}, httperror.New(
			http.StatusServiceUnavailable,
			"runtime_update_install_dir_invalid",
			"Runtime update installation directory is not safely configured",
		)
	}
	serviceName := strings.TrimSuffix(firstNonEmptyText(os.Getenv("HZY_DATA_RUNTIME_SERVICE_NAME"), "hzy-data-runtime"), ".service")
	if serviceName == "" || strings.ContainsAny(serviceName, `/\\`) || strings.ContainsAny(serviceName, " \t\r\n") {
		return runtimeUpdateRequest{}, httperror.New(
			http.StatusServiceUnavailable,
			"runtime_update_service_name_invalid",
			"Runtime update service name is not safely configured",
		)
	}
	fingerprint := sha256.Sum256([]byte(baseURL))
	return runtimeUpdateRequest{
		BaseURL:                  baseURL,
		TargetVersion:            targetVersion,
		InstallDir:               installDir,
		ServiceName:              serviceName,
		PackageSourceFingerprint: hex.EncodeToString(fingerprint[:]),
	}, nil
}

func compareSemanticVersions(left string, right string) (int, bool) {
	parse := func(value string) ([3]int, string, bool) {
		var core [3]int
		parts := strings.SplitN(value, "-", 2)
		numbers := strings.Split(parts[0], ".")
		if len(numbers) != 3 {
			return core, "", false
		}
		for index, number := range numbers {
			parsed, err := strconv.Atoi(number)
			if err != nil {
				return core, "", false
			}
			core[index] = parsed
		}
		preRelease := ""
		if len(parts) == 2 {
			preRelease = parts[1]
		}
		return core, preRelease, true
	}
	leftCore, leftPre, leftOK := parse(left)
	rightCore, rightPre, rightOK := parse(right)
	if !leftOK || !rightOK {
		return 0, false
	}
	for index := range leftCore {
		if leftCore[index] < rightCore[index] {
			return -1, true
		}
		if leftCore[index] > rightCore[index] {
			return 1, true
		}
	}
	if leftPre == rightPre {
		return 0, true
	}
	if leftPre == "" {
		return 1, true
	}
	if rightPre == "" {
		return -1, true
	}
	return strings.Compare(leftPre, rightPre), true
}

func exactUpdateVersion(body map[string]any) (string, error) {
	target, targetOK := body["targetVersion"]
	legacy, legacyOK := body["version"]
	if targetOK && legacyOK && strings.TrimSpace(stringFromAny(target)) != strings.TrimSpace(stringFromAny(legacy)) {
		return "", httperror.New(http.StatusBadRequest, "runtime_update_version_conflict", "Conflicting runtime update versions")
	}
	value := target
	if !targetOK {
		value = legacy
	}
	versionText, ok := value.(string)
	versionText = strings.TrimSpace(versionText)
	if !ok || !exactRuntimeVersionPattern.MatchString(versionText) {
		return "", httperror.New(
			http.StatusBadRequest,
			"runtime_update_version_invalid",
			"Runtime update requires an exact semantic version",
		)
	}
	return versionText, nil
}

func trustedUpdateBaseURL() (string, error) {
	configured := strings.TrimRight(firstNonEmptyText(os.Getenv("HZY_DATA_RUNTIME_DOWNLOAD_BASE_URL"), updater.DefaultBaseURL), "/")
	parsed, err := url.Parse(configured)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", httperror.New(
			http.StatusServiceUnavailable,
			"runtime_update_source_invalid",
			"Runtime update package source is not a safe HTTPS origin",
		)
	}

	allowed := map[string]struct{}{strings.TrimRight(updater.DefaultBaseURL, "/"): {}}
	for _, item := range strings.Split(os.Getenv("HZY_DATA_RUNTIME_ALLOWED_UPDATE_BASE_URLS"), ",") {
		candidate := strings.TrimRight(strings.TrimSpace(item), "/")
		if candidate != "" {
			allowed[candidate] = struct{}{}
		}
	}
	if _, ok := allowed[configured]; !ok {
		return "", httperror.New(
			http.StatusServiceUnavailable,
			"runtime_update_source_not_allowed",
			"Runtime update package source is not allowlisted",
		)
	}
	return configured, nil
}
