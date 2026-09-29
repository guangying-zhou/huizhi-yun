package console

import (
	"context"
)

// ConsumeOIDCBootstrapJTI records a platform bootstrap envelope as used before
// the Runtime acts on it. A process mutex cannot bound a one-time operation: it
// forgets on restart and never covers a second instance. The shared mutation
// receipt store does both, and it also refuses a replay that reuses a consumed
// jti while carrying different trust values instead of quietly re-running it.
//
// The returned flag reports whether this call replayed an already consumed
// envelope, so the caller can confirm the existing state rather than reapply it.
func (a *Adapter) ConsumeOIDCBootstrapJTI(
	ctx context.Context,
	jti string,
	trust map[string]any,
	meta AuditMutationMeta,
) (bool, error) {
	session, replay, err := a.beginMutationAs(
		ctx, "console.auth.oidc.bootstrap", jti, meta.RequestID,
		meta.ActorType, meta.ActorID, trust,
	)
	if err != nil {
		return false, err
	}
	if replay != nil {
		return true, nil
	}
	defer session.tx.Rollback()
	response := map[string]any{"jti": jti}
	if err := a.finishMutation(
		ctx, session, "console", "auth.oidc.bootstrap", "oidc_trust", jti,
		map[string]any{"issuer": trust["issuer"], "jwksUrl": trust["jwksUrl"]}, response,
	); err != nil {
		return false, err
	}
	return false, nil
}
