package capabilities

// RegistrySchemaVersion is the stable schema returned by /runtime/capabilities.
const RegistrySchemaVersion = "hzy.connector-capabilities.v1"

type Provider struct {
	Code                 string   `json:"code"`
	Capabilities         []string `json:"capabilities"`
	AllowedOrigins       []string `json:"allowedOrigins"`
	DynamicTargetAllowed bool     `json:"dynamicTargetAllowed"`
	CredentialSource     string   `json:"credentialSource"`
}

type Capability struct {
	Code          string   `json:"code"`
	Version       string   `json:"version"`
	Mode          string   `json:"mode"`
	Method        string   `json:"method"`
	Path          string   `json:"path"`
	Providers     []string `json:"providers,omitempty"`
	RequiredScope string   `json:"requiredScope"`
	TargetScope   string   `json:"targetScope"`
}

type Registry struct {
	SchemaVersion      string       `json:"schemaVersion"`
	RuntimeProduct     string       `json:"runtimeProduct"`
	MigrationTarget    string       `json:"migrationTarget"`
	ArbitraryHTTPProxy bool         `json:"arbitraryHttpProxy"`
	Providers          []Provider   `json:"providers"`
	Capabilities       []Capability `json:"capabilities"`
}

// Current returns the active Notification Runtime capabilities plus their
// explicitly approved Connector Runtime scope mappings. Planned identity and
// sync capabilities are intentionally not advertised before implementation.
func Current() Registry {
	return registry(false)
}

// Connector returns the active Connector Runtime registry. Planned adapters
// are intentionally absent until their typed endpoint is implemented.
func Connector() Registry {
	return registry(true)
}

func registry(connector bool) Registry {
	runtimeProduct := "hzy-notification-runtime"
	migrationTarget := "hzy-connector-runtime"
	sendScope := "notification-runtime:send"
	readScope := "notification-runtime:deliveries:read"
	reconcileScope := "notification-runtime:deliveries:reconcile"
	if connector {
		runtimeProduct = "hzy-connector-runtime"
		migrationTarget = ""
		sendScope = "connector-runtime:notifications:send"
		readScope = "connector-runtime:deliveries:read"
		reconcileScope = "connector-runtime:deliveries:reconcile"
	}
	providerCapabilities := []string{"notifications.send"}
	notificationProviders := []string{"wecom"}
	registeredCapabilities := []Capability{
		{
			Code:          "notifications.send",
			Version:       "v1",
			Mode:          "synchronous",
			Method:        "POST",
			Path:          "/v1/notifications/send",
			Providers:     notificationProviders,
			RequiredScope: sendScope,
			TargetScope:   "connector-runtime:notifications:send",
		},
		{
			Code:          "deliveries.read",
			Version:       "v1",
			Mode:          "synchronous",
			Method:        "GET",
			Path:          "/v1/deliveries",
			RequiredScope: readScope,
			TargetScope:   "connector-runtime:deliveries:read",
		},
		{
			Code:          "deliveries.reconcile",
			Version:       "v1",
			Mode:          "synchronous",
			Method:        "POST",
			Path:          "/v1/deliveries/{deliveryId}/reconcile",
			RequiredScope: reconcileScope,
			TargetScope:   "connector-runtime:deliveries:reconcile",
		},
	}
	providers := []Provider{
		{
			Code:                 "wecom",
			Capabilities:         providerCapabilities,
			AllowedOrigins:       []string{"https://qyapi.weixin.qq.com"},
			DynamicTargetAllowed: false,
			CredentialSource:     "console-vault",
		},
	}
	if connector {
		notificationProviders = []string{"wecom", "dingtalk"}
		registeredCapabilities[0].Providers = notificationProviders
		providerCapabilities = append(providerCapabilities, "identity.wecom.exchange", "identity.wecom.browser-login")
		registeredCapabilities = append(registeredCapabilities, Capability{
			Code:          "identity.wecom.exchange",
			Version:       "v1",
			Mode:          "synchronous",
			Method:        "POST",
			Path:          "/v1/identity/wecom/exchange",
			Providers:     []string{"wecom"},
			RequiredScope: "connector-runtime:identity:exchange",
			TargetScope:   "connector-runtime:identity:exchange",
		})
		registeredCapabilities = append(registeredCapabilities, Capability{
			Code:          "identity.wecom.browser-login",
			Version:       "v1",
			Mode:          "browser-callback",
			Method:        "POST",
			Path:          "/v1/identity/wecom/authorizations",
			Providers:     []string{"wecom"},
			RequiredScope: "connector-runtime:identity:exchange",
			TargetScope:   "connector-runtime:identity:exchange",
		})
		registeredCapabilities = append(registeredCapabilities,
			Capability{Code: "people.dingtalk.sync", Version: "v1", Mode: "asynchronous", Method: "POST", Path: "/v1/people-sync-jobs", Providers: []string{"dingtalk"}, RequiredScope: "connector-runtime:people:sync", TargetScope: "connector-runtime:people:sync"},
			Capability{Code: "directory.dingtalk.profile-sync", Version: "v1", Mode: "asynchronous", Method: "POST", Path: "/v1/directory-profile-sync-jobs", Providers: []string{"dingtalk"}, RequiredScope: "connector-runtime:directory:sync", TargetScope: "connector-runtime:directory:sync"},
			Capability{Code: "people.sync.jobs.read", Version: "v1", Mode: "synchronous", Method: "GET", Path: "/v1/people-sync-jobs/{jobId}", Providers: []string{"dingtalk"}, RequiredScope: "connector-runtime:jobs:view", TargetScope: "connector-runtime:jobs:view"},
			Capability{Code: "people.sync.jobs.cancel", Version: "v1", Mode: "synchronous", Method: "POST", Path: "/v1/people-sync-jobs/{jobId}/cancel", Providers: []string{"dingtalk"}, RequiredScope: "connector-runtime:jobs:cancel", TargetScope: "connector-runtime:jobs:cancel"},
			Capability{Code: "people.sync.jobs.retry", Version: "v1", Mode: "asynchronous", Method: "POST", Path: "/v1/people-sync-jobs/{jobId}/retry", Providers: []string{"dingtalk"}, RequiredScope: "connector-runtime:people:sync", TargetScope: "connector-runtime:people:sync"},
			Capability{Code: "runtime.diagnostics.read", Version: "v1", Mode: "synchronous", Method: "GET", Path: "/v1/diagnostics", RequiredScope: "connector-runtime:diagnostics:view", TargetScope: "connector-runtime:diagnostics:view"},
		)
		registeredCapabilities = append(registeredCapabilities, Capability{
			Code:          "identity.dingtalk.exchange",
			Version:       "v1",
			Mode:          "synchronous",
			Method:        "POST",
			Path:          "/v1/identity/dingtalk/exchange",
			Providers:     []string{"dingtalk"},
			RequiredScope: "connector-runtime:identity:dingtalk:exchange",
			TargetScope:   "connector-runtime:identity:dingtalk:exchange",
		})
		providers[0].Capabilities = providerCapabilities
		providers = append(providers, Provider{
			Code:                 "dingtalk",
			Capabilities:         []string{"notifications.send", "identity.dingtalk.exchange", "people.dingtalk.sync", "directory.dingtalk.profile-sync"},
			AllowedOrigins:       []string{"https://api.dingtalk.com", "https://oapi.dingtalk.com"},
			DynamicTargetAllowed: false,
			CredentialSource:     "console-vault",
		})
	}
	return Registry{
		SchemaVersion:      RegistrySchemaVersion,
		RuntimeProduct:     runtimeProduct,
		MigrationTarget:    migrationTarget,
		ArbitraryHTTPProxy: false,
		Providers:          providers,
		Capabilities:       registeredCapabilities,
	}
}
