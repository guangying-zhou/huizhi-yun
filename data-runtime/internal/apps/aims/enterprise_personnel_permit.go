package aims

import (
	"github.com/huizhi-yun/data-runtime/internal/httperror"
	"time"
)

// A short-lived projection from the independent Console Directory hop. It is
// carried only in the authenticated Enterprise command, never public input.
// It proves observation at issuance, not a cross-database transaction lock.
type EnterprisePersonnelPermit struct {
	Tenant     string `json:"tenant"`
	Deployment string `json:"deployment"`
	ActorUID   string `json:"actorUid"`
	Resource   string `json:"resource"`
	ObjectID   string `json:"objectId"`
	Action     string `json:"action"`
	Field      string `json:"field"`
	UID        string `json:"uid"`
	Status     string `json:"status"`
	ExpiresAt  int64  `json:"expiresAt"`
}

func validateEnterprisePersonnel(identity EnterpriseProjectCreateIdentity, required map[string]string, resource, objectID, action string, now time.Time) error {
	if len(required) != len(identity.Personnel) {
		return httperror.New(403, "enterprise_personnel_permit_invalid", "Personnel authorization is missing or invalid")
	}
	seen := map[string]bool{}
	for _, p := range identity.Personnel {
		if required[p.Field] == "" || required[p.Field] != p.UID || seen[p.Field] || p.Status != "active" || p.Tenant != identity.Tenant || p.Deployment != identity.SourceDeployment || p.ActorUID != identity.ActorUID || p.Resource != resource || p.ObjectID != objectID || p.Action != action || p.ExpiresAt <= now.UnixMilli() || p.ExpiresAt > now.Add(15*time.Second).UnixMilli() {
			return httperror.New(403, "enterprise_personnel_permit_invalid", "Personnel authorization is missing or invalid")
		}
		seen[p.Field] = true
	}
	return nil
}
