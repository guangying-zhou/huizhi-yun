package assets

import "sort"

// Input must already be filtered by current product, asset and environment scope.
// Deleted/ended records are excluded by the reader before aggregation.
type ProductAdoptionRelation struct {
	DeliveryAssetCode string
	EnvironmentCode   string
	CustomerCode      string
	Role              string
	DeploymentStatus  string
	DeployedVersion   string
}

type ProductAdoptionInstance struct {
	DeliveryAssetCode  string   `json:"deliveryAssetCode"`
	EnvironmentCode    string   `json:"environmentCode"`
	CustomerCode       string   `json:"customerCode"`
	Roles              []string `json:"roles"`
	DeploymentStatuses []string `json:"deploymentStatuses"`
	Versions           []string `json:"versions"`
	VersionUnknown     bool     `json:"versionUnknown"`
	VersionConflict    bool     `json:"versionConflict"`
	Adopted            bool     `json:"adopted"`
	Production         bool     `json:"production"`
}

type ProductAdoptionSummary struct {
	Instances                   int `json:"instances"`
	Environments                int `json:"environments"`
	Customers                   int `json:"customers"`
	ProductionInstances         int `json:"productionInstances"`
	UnknownVersionInstances     int `json:"unknownVersionInstances"`
	ConflictingVersionInstances int `json:"conflictingVersionInstances"`
}

// Summarize the complete authorized relation set, before paginating instances.
// Missing customer identifiers are not counted as a synthetic customer.
func summarizeProductAdoption(relations []ProductAdoptionRelation) ProductAdoptionSummary {
	result := ProductAdoptionSummary{}
	environments, customers := map[string]bool{}, map[string]bool{}
	for _, instance := range aggregateProductAdoption(relations) {
		if !instance.Adopted {
			continue
		}
		result.Instances++
		environments[instance.EnvironmentCode] = true
		if instance.CustomerCode != "" {
			customers[instance.CustomerCode] = true
		}
		if instance.Production {
			result.ProductionInstances++
		}
		if instance.VersionUnknown {
			result.UnknownVersionInstances++
		}
		if instance.VersionConflict {
			result.ConflictingVersionInstances++
		}
	}
	result.Environments, result.Customers = len(environments), len(customers)
	return result
}

// A pair can carry multiple role rows. Role rows never multiply adoption counts.
func aggregateProductAdoption(relations []ProductAdoptionRelation) []ProductAdoptionInstance {
	type key struct{ asset, environment string }
	type group struct {
		item                    ProductAdoptionInstance
		roles, states, versions map[string]bool
	}
	groups := map[key]*group{}
	for _, relation := range relations {
		pair := key{relation.DeliveryAssetCode, relation.EnvironmentCode}
		current := groups[pair]
		if current == nil {
			current = &group{item: ProductAdoptionInstance{DeliveryAssetCode: pair.asset, EnvironmentCode: pair.environment, CustomerCode: relation.CustomerCode}, roles: map[string]bool{}, states: map[string]bool{}, versions: map[string]bool{}}
			groups[pair] = current
		}
		current.roles[relation.Role] = true
		current.states[relation.DeploymentStatus] = true
		deployed := relation.DeploymentStatus == "deployed" || relation.DeploymentStatus == "online" || relation.DeploymentStatus == "accepted"
		if deployed {
			current.item.Adopted = true
			if relation.Role == "production" {
				current.item.Production = true
			}
			if relation.DeployedVersion == "" {
				current.item.VersionUnknown = true
			} else {
				current.versions[relation.DeployedVersion] = true
			}
		}
	}
	keys := func(values map[string]bool) []string {
		out := make([]string, 0, len(values))
		for value := range values {
			out = append(out, value)
		}
		sort.Strings(out)
		return out
	}
	result := make([]ProductAdoptionInstance, 0, len(groups))
	for _, current := range groups {
		current.item.Roles = keys(current.roles)
		current.item.DeploymentStatuses = keys(current.states)
		current.item.Versions = keys(current.versions)
		current.item.VersionConflict = len(current.versions) > 1
		result = append(result, current.item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DeliveryAssetCode != result[j].DeliveryAssetCode {
			return result[i].DeliveryAssetCode < result[j].DeliveryAssetCode
		}
		return result[i].EnvironmentCode < result[j].EnvironmentCode
	})
	return result
}
