#!/usr/bin/env python3
"""S4 B10: build the compatibility-view binding candidate from the reviewed K2 final plan (final.json).
Usage: mk-binding-candidate.py --final final.json --out runtime-candidate.json [--profile profile.json]
The candidate feeds `hzy-enterprise-compatibility-rehearsal --binding-candidate` (which prunes the exclusive system_parameters
mapping itself). Domains: aims unified read/write/scheduler; assets unified read/write, scheduler disabled (as in R3)."""
import argparse, collections, json, os

ap = argparse.ArgumentParser()
ap.add_argument("--final", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--profile", default="/root/.hzy-s4/profile/S4-PROD-cutover-profile.json")
args = ap.parse_args()
os.umask(0o077)
plan = json.load(open(args.final))
profile = json.load(open(args.profile))
domains = collections.defaultdict(dict)
for table in plan["Tables"]:
    if table["Name"] == "enterprise_source_fence":
        continue
    domains[table["Domain"]][table["Name"]] = table["Target"]
owner = profile["enterpriseDeployment"]
candidate = {"enterprise": {"enabled": False, "schemaVersion": profile["schemaVersion"], "generation": profile["generation"], "instanceId": profile["instanceId"],
    "db": {"database": profile["target"]},
    "domains": {
        "aims": {"ownerDeployment": owner, "read": "unified", "write": "unified", "scheduler": "unified", "tables": domains["aims"]},
        "assets": {"ownerDeployment": owner, "read": "unified", "write": "unified", "scheduler": "disabled", "tables": domains["assets"]}}}}
fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as fh:
    json.dump(candidate, fh, indent=1)
print(json.dumps({"out": args.out, "aims": len(domains["aims"]), "assets": len(domains["assets"])}))
