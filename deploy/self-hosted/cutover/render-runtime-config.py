#!/usr/bin/env python3
"""S4: render the Runtime config.json from protected files, never from argv.

Secrets are read from the root-only MySQL client files created in A6 (/etc/hzy/mysql/hzy_rt_*.cnf) and the deployment
bindings from the installed Runtime .env (HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64). Nothing sensitive is accepted on the command
line or printed. Stages:
  b10b   minimal Runtime for the readiness heartbeat: apps.console + apps.directory only (database hzy_console), no enterprise block.
  final  the B14 configuration: adds workflow and codocs, and the enterprise block built from the B10 artifact's pruned binding
         (views-applied.json) and the cutover profile (instanceId, generation).
Usage:
  render-runtime-config.py --stage b10b|final --out /etc/hzy-data-runtime/config.json [--binding views-applied.json] [--profile profile.json]
  render-runtime-config.py --check /etc/hzy-data-runtime/config.json [--stage final]      (structural check, no start, no database)
"""
import argparse, base64, configparser, json, os, pwd, re, sys

# Console verified-policy window. Two Runtime limits apply outside environment=test: verifiedPolicyConfigured() accepts up to
# LongMaxAgeMS (3600000, policyenvelope/validity.go) but the write path Validate() (policyenvelope/envelope.go) only accepts
# up to MaxAgeMS (300000), which is also the lease Platform signs. Use the stricter one; 93600000 is test-only.
POLICY_MAX_AGE_MS = 300000
POLICY_MAX_AGE_LIMIT_MS = 300000
ISSUER = "https://aidcp.wiztek.cn/console"
JWKS = "http://127.0.0.1:31001/console/.well-known/jwks.json"
DEFAULT_ENV = "/etc/hzy-data-runtime/.env"
DEFAULT_MYSQL = "/etc/hzy/mysql"
DEFAULT_PROFILE = "/root/.hzy-s4/profile/S4-PROD-cutover-profile.json"

def env_value(path, key):
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def credential(mysql_dir, user):
    parser = configparser.ConfigParser()
    if not parser.read(os.path.join(mysql_dir, user + ".cnf")):
        raise SystemExit(f"missing MySQL client file for {user}")
    password = parser["client"]["password"].strip("\"'")
    if not password or password.startswith("REPLACE"):
        raise SystemExit(f"empty or placeholder password for {user}")
    return password

def db(mysql_dir, user, name):
    return {"host": "127.0.0.1", "port": 3306, "user": user, "password": credential(mysql_dir, user), "database": name, "connectionLimit": 3}

def render(stage, args):
    raw = env_value(args.env_file, "HZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64")
    if not raw:
        raise SystemExit("deployment bindings missing in the Runtime .env")
    bindings = json.loads(base64.b64decode(raw))
    off = {"enabled": False}
    apps = {k: dict(off) for k in ["finance", "people", "webdev", "altoc", "aims", "assets", "workflow", "codocs"]}
    apps["console"] = {"enabled": True, "db": db(args.mysql_dir, "hzy_rt_console", "hzy_console")}
    if stage == "final":
        # Verified policy delivery (Platform -> Gateway policy-sync -> Console) needs both; hzy0 carries the same blocks.
        # gatewayExchangeEnabled only enables Runtime-side token exchange for the gateway principal
        # (data-runtime/internal/apps/console/auth_gateway_exchange.go); Gateway identity validation still applies.
        apps["console"]["policyEnvelope"] = {"enabled": True, "enterpriseReadEnabled": True, "environment": "prod", "maxAgeMs": POLICY_MAX_AGE_MS}
        apps["console"]["gatewayExchangeEnabled"] = True
    apps["directory"] = {"enabled": True, "db": db(args.mysql_dir, "hzy_rt_console", "hzy_console")}
    cfg = {"_note": f"S4 Runtime configuration, stage {stage}, rendered by render-runtime-config.py. No secrets on any command line.",
           "server": {"host": "127.0.0.1", "port": 31080}, "tenant": "C000001", "deployment": "c000001-prod-tenant-runtime",
           "deploymentBindings": bindings,
           "auth": {"mode": "jwt", "jwt": {"issuer": ISSUER, "audience": "data-runtime", "jwksUrl": JWKS}}, "apps": apps}
    if args.workflow_lane and stage != "final":
        raise SystemExit("--workflow-lane 仅适用于 final")
    if stage == "final":
        if not args.binding:
            raise SystemExit("--binding (B10 views-applied.json) is required for the final stage")
        artifact = json.load(open(args.binding, encoding="utf-8"))
        domains_in = artifact["binding"]["Domains"]
        profile = json.load(open(args.profile, encoding="utf-8"))
        apps["workflow"] = {"enabled": True, "db": db(args.mysql_dir, "hzy_rt_workflow", "hzy_workflow")}
        apps["codocs"] = {"enabled": True, "db": db(args.mysql_dir, "hzy_rt_codocs", "hzy_codocs")}
        # Unified Enterprise domains mount their read/write/scheduler paths on the aims/assets adapters (server.go
        # ConfigureEnterpriseWrites); a disabled adapter leaves them unmounted and Platform marks the app blocked
        # (runtime_app_disabled), which also empties the tenant-gateway registry endpoint. hzy0 enables both on the unified database.
        apps["aims"] = {"enabled": True, "db": db(args.mysql_dir, "hzy_rt_enterprise", "hzy_enterprise")}
        apps["assets"] = {"enabled": True, "db": db(args.mysql_dir, "hzy_rt_enterprise", "hzy_enterprise")}
        domains = {}
        for name, d in sorted(domains_in.items()):
            domains[name] = {"ownerDeployment": d["OwnerDeployment"], "tables": d["Tables"], "read": d["Read"], "write": d["Write"], "scheduler": d["Scheduler"]}
        enterprise = {"enabled": True, "environment": profile["environment"], "schemaVersion": profile["schemaVersion"], "generation": profile["generation"],
                      "instanceId": profile["instanceId"], "db": db(args.mysql_dir, "hzy_rt_enterprise", "hzy_enterprise"), "domains": domains}
        if domains.get("aims", {}).get("scheduler") == "unified":
            enterprise["aimsDeliveryWorker"] = {"deployment": bindings["aims"], "serviceClientId": "aims.runtime"}
            # ADR-018a D1: milestone rollover runs in the Runtime process; the Aims wake then gets a 409 owner refusal.
            enterprise["inProcessScheduler"] = {"enabled": True, "intervalSeconds": 300}
        if domains.get("assets", {}).get("scheduler") == "unified":
            enterprise["assetsDeliveryWorker"] = {"deployment": bindings["assets"], "serviceClientId": "assets.runtime"}
        if "workflow" in domains:
            if not args.workflow_lane:
                raise SystemExit("B3 server 接线前不得渲染 Workflow 域；须显式 --workflow-lane")
            workflow = domains["workflow"]
            if workflow["read"] != "unified" or workflow["write"] != "unified" or workflow["tables"].get("service_command_receipt") != "workflow_service_command_receipt":
                raise SystemExit("Workflow lane 需要已登记的统一读写与独立回执映射")
            enterprise["workflowLane"] = {"enabled": True}
            apps["workflow"]["db"] = dict(enterprise["db"])
        elif args.workflow_lane:
            raise SystemExit("--workflow-lane 需要 Workflow 域")
        cfg["enterprise"] = enterprise
    return cfg

def write_protected(path, text, chown):
    tmp = path + ".tmp-render"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    if chown and os.geteuid() == 0:
        user = pwd.getpwnam("hzy-runtime")
        os.chown(tmp, user.pw_uid, user.pw_gid)
    os.replace(tmp, path)

def check(path, stage, chown, workflow_lane=False, aims_retired=False):
    problems = []
    st = os.stat(path)
    if (st.st_mode & 0o777) != 0o600:
        problems.append(f"mode {oct(st.st_mode & 0o777)} (want 0600)")
    if chown and os.geteuid() == 0 and pwd.getpwuid(st.st_uid).pw_name != "hzy-runtime":
        problems.append("owner is not hzy-runtime")
    text = open(path, encoding="utf-8").read()
    if "REPLACE" in text:
        problems.append("placeholder text remains")
    cfg = json.loads(text)
    if aims_retired:
        for flag in ["allowLegacyAimsCallbacks", "allowLegacyNotificationDetails"]:
            if cfg.get("enterprise", {}).get(flag) is not False:
                problems.append(f"hzy-aims retired requires enterprise.{flag}=false")
    for key in ["server", "tenant", "deployment", "deploymentBindings", "auth", "apps"]:
        if key not in cfg:
            problems.append(f"missing {key}")
    if cfg.get("deployment") != "c000001-prod-tenant-runtime" or cfg.get("tenant") != "C000001":
        problems.append("tenant/deployment is not the production identity")
    if not cfg.get("deploymentBindings", {}).get("enterprise"):
        problems.append("deploymentBindings has no enterprise entry")
    for name, app in cfg.get("apps", {}).items():
        if app.get("enabled") and not app.get("db", {}).get("password"):
            problems.append(f"apps.{name} enabled without a database password")
    enabled = sorted(n for n, a in cfg.get("apps", {}).items() if a.get("enabled"))
    if stage == "b10b" and (enabled != ["console", "directory"] or "enterprise" in cfg):
        problems.append("b10b must enable only console+directory and carry no enterprise block")
    if stage == "final":
        e = cfg.get("enterprise", {})
        if not (e.get("enabled") is True and e.get("generation") == 1 and e.get("environment") == "prod" and e.get("db", {}).get("database") == "hzy_enterprise"):
            problems.append("enterprise block is not the production generation-1 block")
        pe = cfg.get("apps", {}).get("console", {}).get("policyEnvelope", {})
        if not (pe.get("enabled") is True and pe.get("environment") == "prod" and isinstance(pe.get("maxAgeMs"), int) and 1000 <= pe["maxAgeMs"] <= POLICY_MAX_AGE_LIMIT_MS):
            problems.append("apps.console.policyEnvelope missing or maxAgeMs above the prod limit 300000")
        if cfg.get("apps", {}).get("console", {}).get("gatewayExchangeEnabled") is not True:
            problems.append("apps.console.gatewayExchangeEnabled is not true")
        bindings = set(cfg.get("deploymentBindings", {}).values())
        for name, d in e.get("domains", {}).items():
            if d.get("ownerDeployment") not in bindings or not d.get("tables"):
                problems.append(f"enterprise.domains.{name} owner/tables invalid")
        for need in ["aims", "assets"]:
            if cfg.get("apps", {}).get(need, {}).get("db", {}).get("database") != "hzy_enterprise":
                problems.append(f"apps.{need} must use the unified hzy_enterprise database")
        has_workflow = "workflow" in e.get("domains", {})
        enabled_lane = e.get("workflowLane", {}).get("enabled") is True
        if enabled_lane != workflow_lane or (has_workflow and not enabled_lane):
            problems.append("B3 server Workflow 域/开关与显式 --workflow-lane 不一致")
        workflow_db = cfg.get("apps", {}).get("workflow", {}).get("db", {}).get("database")
        if enabled_lane:
            wd = e.get("domains", {}).get("workflow", {})
            if not has_workflow or wd.get("read") != "unified" or wd.get("write") != "unified" or wd.get("tables", {}).get("service_command_receipt") != "workflow_service_command_receipt" or workflow_db != "hzy_enterprise":
                problems.append("Workflow lane 前置不满足")
        elif workflow_db == "hzy_enterprise":
            problems.append("B3 server 接线前 apps.workflow 不得指向 hzy_enterprise")
        if not e.get("domains"):
            problems.append("enterprise.domains empty")
        if e.get("domains", {}).get("aims", {}).get("scheduler") == "unified" and not e.get("aimsDeliveryWorker"):
            problems.append("aimsDeliveryWorker missing for unified aims scheduler")
        if e.get("domains", {}).get("aims", {}).get("scheduler") == "unified" and e.get("inProcessScheduler", {}).get("enabled") is not True:
            problems.append("enterprise.inProcessScheduler not enabled for unified aims scheduler")
        for need in ["console", "directory", "workflow", "codocs", "aims", "assets"]:
            if need not in enabled:
                problems.append(f"apps.{need} not enabled")
    print(json.dumps({"path": path, "stage": stage, "enabledApps": enabled, "enterprise": bool(cfg.get("enterprise")),
                      "domains": {k: len(v.get("tables", {})) for k, v in cfg.get("enterprise", {}).get("domains", {}).items()}, "problems": problems}))
    return not problems

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["b10b", "final"])
    ap.add_argument("--out")
    ap.add_argument("--check")
    ap.add_argument("--binding")
    ap.add_argument("--profile", default=DEFAULT_PROFILE)
    ap.add_argument("--env-file", default=DEFAULT_ENV)
    ap.add_argument("--mysql-dir", default=DEFAULT_MYSQL)
    ap.add_argument("--no-chown", action="store_true")
    ap.add_argument("--workflow-lane", action="store_true")
    ap.add_argument("--aims-retired", action="store_true", help="check-only retirement gate: both Runtime legacy switches must explicitly be false")
    args = ap.parse_args()
    if args.aims_retired and not args.check:
        ap.error("--aims-retired requires --check; explicitly configure both legacy switches before validation")
    if args.check:
        sys.exit(0 if check(args.check, args.stage or "b10b", not args.no_chown, args.workflow_lane, args.aims_retired) else 2)
    if not args.stage or not args.out:
        ap.error("--stage and --out are required")
    if os.path.exists(args.out):
        raise SystemExit(f"{args.out} exists; move the previous file aside first (it is kept as evidence)")
    write_protected(args.out, json.dumps(render(args.stage, args), indent=1) + "\n", not args.no_chown)
    print(f"rendered {args.out} stage={args.stage} (mode 0600)")
    sys.exit(0 if check(args.out, args.stage, not args.no_chown, args.workflow_lane, args.aims_retired) else 2)

if __name__ == "__main__":
    main()
