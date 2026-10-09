package directory

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"github.com/huizhi-yun/data-runtime/internal/integrationoperation"
)

// Called only after Runtime verifies the Console-signed command context. Never
// select an application's identity from the browser or command's sourceApp.
func ConsoleOnboardingCommandSource(body map[string]any) (string, error) {
	c, e := integrationoperation.TrustedServiceCommandContextFromMap(body)
	if e != nil || c.TargetApp != "console" || !((c.SourceApp == "people" && c.SourceClientID == "people.runtime") || (c.SourceApp == "enterprise" && c.SourceClientID == "enterprise.runtime")) {
		return "", httperror.New(403, "directory_command_source_forbidden", "Verified People or Enterprise source required")
	}
	envelope, ok := body["serviceCommand"].(map[string]any)
	if !ok {
		return "", httperror.New(403, "directory_command_source_forbidden", "Frozen command required")
	}
	command, ok := envelope["command"].(map[string]any)
	if !ok || text(command["sourceApp"]) != c.SourceApp {
		return "", httperror.New(403, "directory_command_source_forbidden", "Frozen source mismatch")
	}
	return c.SourceApp, nil
}
func onboardingSource(s []string) (string, error) {
	source := "people"
	if len(s) == 1 {
		source = s[0]
	}
	if len(s) > 1 || source != "people" && source != "enterprise" {
		return "", httperror.New(403, "directory_command_source_forbidden", "Unsupported onboarding source")
	}
	return source, nil
}
