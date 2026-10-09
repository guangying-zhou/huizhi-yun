#!/usr/bin/env python3
"""Self-test for render-runtime-config.py with fake protected files: stages render, checks pass, placeholders/secrets handling holds."""
import base64, json, os, subprocess, sys, tempfile
here = os.path.dirname(os.path.abspath(__file__))
script = os.path.join(here, "render-runtime-config.py")
d = tempfile.mkdtemp()
os.makedirs(d + "/mysql")
for u in ["hzy_rt_console", "hzy_rt_workflow", "hzy_rt_codocs", "hzy_rt_enterprise"]:
    open(f"{d}/mysql/{u}.cnf", "w").write(f'[client]\nuser={u}\npassword="pw-{u}-fake"\n')
bindings = {"aims": "C000001-aims", "assets": "C000001-assets", "workflow": "C000001-workflow", "codocs": "C000001-codocs", "console": "C000001-console", "enterprise": "C000001-prod-enterprise"}
open(d + "/env", "w").write('HZY_X="1"\nHZY_DATA_RUNTIME_DEPLOYMENT_BINDINGS_B64="%s"\n' % base64.b64encode(json.dumps(bindings).encode()).decode())
json.dump({"environment": "prod", "schemaVersion": "enterprise.v1", "generation": 1, "instanceId": "1e3c34dd-bb9b-11f1-bf6b-000c293f1086"}, open(d + "/profile.json", "w"))
tables = lambda n: {f"t{i}": f"t{i}_x" for i in range(n)}
json.dump({"binding": {"Domains": {
    "aims": {"OwnerDeployment": "C000001-prod-enterprise", "Tables": tables(115), "Read": "unified", "Write": "unified", "Scheduler": "unified"},
    "assets": {"OwnerDeployment": "C000001-prod-enterprise", "Tables": tables(37), "Read": "unified", "Write": "unified", "Scheduler": "disabled"}}}}, open(d + "/views-applied.json", "w"))
common = ["--env-file", d + "/env", "--mysql-dir", d + "/mysql", "--no-chown", "--profile", d + "/profile.json"]
def run(*a):
    return subprocess.run([sys.executable, script, *common, *a], capture_output=True, text=True)
r = run("--stage", "b10b", "--out", d + "/b10b.json"); assert r.returncode == 0, r.stdout + r.stderr
assert "pw-" not in r.stdout + r.stderr, "no secret in output"
c = json.load(open(d + "/b10b.json")); assert sorted(k for k, v in c["apps"].items() if v["enabled"]) == ["console", "directory"] and "enterprise" not in c
assert oct(os.stat(d + "/b10b.json").st_mode & 0o777) == "0o600"
r = run("--stage", "b10b", "--out", d + "/b10b.json"); assert r.returncode != 0 and "exists" in (r.stdout + r.stderr), "refuses to overwrite"
r = run("--stage", "final", "--out", d + "/final.json"); assert r.returncode != 0, "final needs --binding"
r = run("--stage", "final", "--out", d + "/final.json", "--binding", d + "/views-applied.json"); assert r.returncode == 0, r.stdout + r.stderr
f = json.load(open(d + "/final.json")); e = f["enterprise"]
assert e["enabled"] and e["generation"] == 1 and e["environment"] == "prod" and e["db"]["database"] == "hzy_enterprise"
assert e["aimsDeliveryWorker"] == {"deployment": "C000001-aims", "serviceClientId": "aims.runtime"} and "assetsDeliveryWorker" not in e
assert e["inProcessScheduler"] == {"enabled": True, "intervalSeconds": 300}
assert len(e["domains"]["aims"]["tables"]) == 115 and len(e["domains"]["assets"]["tables"]) == 37
assert all(f["apps"][a]["enabled"] for a in ["console", "directory", "workflow", "codocs", "aims", "assets"])
assert all(f["apps"][a]["db"]["database"] == "hzy_enterprise" for a in ["aims", "assets"])
pe = f["apps"]["console"]["policyEnvelope"]
assert pe == {"enabled": True, "enterpriseReadEnabled": True, "environment": "prod", "maxAgeMs": 300000}
assert pe["maxAgeMs"] <= 300000, "prod policy window must not exceed data-runtime MaxAgeMS (write-path limit)"
assert f["apps"]["console"]["gatewayExchangeEnabled"] is True
# --check rejects a prod policy window above the Runtime limit, and a missing gateway exchange flag
over = json.loads(json.dumps(f)); over["apps"]["console"]["policyEnvelope"]["maxAgeMs"] = 3600000; json.dump(over, open(d + "/over.json", "w")); os.chmod(d + "/over.json", 0o600)
r = run("--check", d + "/over.json", "--stage", "final"); assert r.returncode == 2 and "policyEnvelope" in r.stdout
nogx = json.loads(json.dumps(f)); del nogx["apps"]["console"]["gatewayExchangeEnabled"]; json.dump(nogx, open(d + "/nogx.json", "w")); os.chmod(d + "/nogx.json", 0o600)
r = run("--check", d + "/nogx.json", "--stage", "final"); assert r.returncode == 2 and "gatewayExchangeEnabled" in r.stdout
# a placeholder or a wrong stage is caught by --check
bad = json.load(open(d + "/b10b.json")); bad["apps"]["console"]["db"]["password"] = "REPLACE_AT_B10B_x"; json.dump(bad, open(d + "/bad.json", "w")); os.chmod(d + "/bad.json", 0o600)
r = run("--check", d + "/bad.json", "--stage", "b10b"); assert r.returncode == 2 and "placeholder" in r.stdout
r = run("--check", d + "/b10b.json", "--stage", "final"); assert r.returncode == 2
os.chmod(d + "/b10b.json", 0o644); r = run("--check", d + "/b10b.json", "--stage", "b10b"); assert r.returncode == 2 and "mode" in r.stdout
# a missing/placeholder credential file stops the render
open(d + "/mysql/hzy_rt_workflow.cnf", "w").write('[client]\npassword="REPLACE_ME"\n')
r = run("--stage", "final", "--out", d + "/final2.json", "--binding", d + "/views-applied.json"); assert r.returncode != 0 and not os.path.exists(d + "/final2.json")
print("render-runtime-config self-test: OK")
# No server enterprise Workflow factory until B3: do not emit unsafe config.
artifact = json.load(open(d + "/views-applied.json"))
artifact["binding"]["Domains"]["workflow"] = {"OwnerDeployment":bindings["workflow"],"Tables":{"service_command_receipt":"workflow_service_command_receipt","workflow_system_parameters":"workflow_system_parameters"},"Read":"unified","Write":"unified","Scheduler":"disabled"}
json.dump(artifact,open(d + "/workflow-applied.json","w"))
open(d + "/mysql/hzy_rt_workflow.cnf","w").write('[client]\npassword="fake-only"\n')
r=run("--stage","final","--out",d+"/workflow-final.json","--binding",d+"/workflow-applied.json")
assert r.returncode!=0 and "B3 server" in r.stderr and not os.path.exists(d+"/workflow-final.json"),r.stdout+r.stderr
assert f["apps"]["workflow"]["db"]["database"]=="hzy_workflow"
for suffix, modify in [("domain",lambda c:c["enterprise"]["domains"].update(artifact["binding"]["Domains"])),("db",lambda c:c["apps"]["workflow"]["db"].update(database="hzy_enterprise"))]:
    candidate=json.loads(json.dumps(f));modify(candidate)
    path=d+"/workflow-check-"+suffix+".json";json.dump(candidate,open(path,"w"));os.chmod(path,0o600)
    r=run("--check",path,"--stage","final");assert r.returncode==2 and "B3 server" in r.stdout,r.stdout+r.stderr
assert f["enterprise"]["inProcessScheduler"]=={"enabled":True,"intervalSeconds":300}
print("Workflow pre-B3 fail-closed: PASS")

# Explicit opt-in is the only way to mount the unified Workflow adapter.
r=run("--stage","final","--out",d+"/workflow-on.json","--binding",d+"/workflow-applied.json","--workflow-lane")
assert r.returncode==0,r.stdout+r.stderr
on=json.load(open(d+"/workflow-on.json"))
assert on["enterprise"]["workflowLane"]=={"enabled":True}
assert on["apps"]["workflow"]["db"]==on["enterprise"]["db"]
r=run("--check",d+"/workflow-on.json","--stage","final");assert r.returncode==2
r=run("--check",d+"/workflow-on.json","--stage","final","--workflow-lane");assert r.returncode==0
r=run("--stage","final","--out",d+"/missing-workflow.json","--binding",d+"/views-applied.json","--workflow-lane");assert r.returncode!=0
for label,mutate in [("off",lambda c:c["enterprise"]["workflowLane"].update(enabled=False)),("db",lambda c:c["apps"]["workflow"]["db"].update(database="hzy_workflow")),("mode",lambda c:c["enterprise"]["domains"]["workflow"].update(write="disabled"))]:
    bad=json.loads(json.dumps(on));mutate(bad);path=d+"/lane-bad-"+label+".json";json.dump(bad,open(path,"w"));os.chmod(path,0o600)
    r=run("--check",path,"--stage","final","--workflow-lane");assert r.returncode==2,r.stdout+r.stderr
print("Workflow explicit lane opt-in: PASS")

# Retirement is explicit; absent, true and string false must all fail closed.
for value in [None, True, "false", False]:
    candidate=json.loads(json.dumps(f))
    candidate["enterprise"]["allowLegacyAimsCallbacks"]=False
    if value is not None: candidate["enterprise"]["allowLegacyNotificationDetails"]=value
    path=d+"/retired.json";json.dump(candidate,open(path,"w"));os.chmod(path,0o600)
    result=run("--check",path,"--stage","final","--aims-retired")
    assert result.returncode==(0 if value is False else 2),result.stdout+result.stderr
    assert run("--check",path,"--stage","final").returncode==0
candidate["enterprise"]["allowLegacyAimsCallbacks"]=True
json.dump(candidate,open(path,"w"))
assert run("--check",path,"--stage","final","--aims-retired").returncode==2
print("Aims retirement legacy gate: PASS")
