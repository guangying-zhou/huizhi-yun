package directoryconnector

import "encoding/base64"

type LDAPConfiguration struct {
	DirectoryType           string `json:"directoryType"`
	Host                    string `json:"host"`
	Port                    int    `json:"port"`
	Transport               string `json:"transport"`
	BaseDN                  string `json:"baseDN"`
	UserBase                string `json:"userBase"`
	UserFilter              string `json:"userFilter"`
	UserDnTemplate          string `json:"userDnTemplate"`
	UserPrincipalNameSuffix string `json:"userPrincipalNameSuffix"`
	CAPem                   string `json:"caPem"`
	ServerName              string `json:"serverName"`
	SyncIntervalSeconds     int    `json:"syncIntervalSeconds"`
	PageSize                int    `json:"pageSize"`
	BindDN                  string `json:"bindDN"`
	BindPasswordCiphertext  string `json:"bindPasswordCiphertext"`
}

type LeasedCommand struct {
	OperationID          string         `json:"operationId"`
	OperationCode        string         `json:"operationCode"`
	CommandSchemaVersion string         `json:"commandSchemaVersion"`
	CommandSHA256        string         `json:"commandSha256"`
	FencingToken         uint64         `json:"fencingToken"`
	Command              map[string]any `json:"command"`
}

func decodeBase64(value string) ([]byte, error) {
	return base64.StdEncoding.DecodeString(value)
}
