package enterprise

// ResolveDomains freezes all participating domains under one Registry mutex.
// It returns no partial result; it does not confer domain business authority.
func (r *Registry) ResolveDomains(requests ...ResolveRequest) ([]Resolved, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(requests) == 0 {
		return nil, ErrBindingMismatch
	}
	seen := map[string]bool{}
	out := make([]Resolved, 0, len(requests))
	for _, req := range requests {
		if seen[req.Domain] || req.Operation != requests[0].Operation {
			return nil, ErrBindingMismatch
		}
		seen[req.Domain] = true
		item, err := r.resolveLocked(req)
		if err != nil {
			return nil, err
		}
		if len(out) > 0 {
			first := out[0]
			if item.DB != first.DB || item.Key != first.Key || item.SchemaVersion != first.SchemaVersion || item.Generation != first.Generation {
				return nil, ErrBindingMismatch
			}
		}
		out = append(out, item)
	}
	return out, nil
}
