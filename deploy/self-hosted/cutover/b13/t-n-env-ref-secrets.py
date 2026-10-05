#!/usr/bin/env python3
"""S4 T-n: generate env_ref service-client secrets on the new host and place them on BOTH sides without ever printing them.

Runtime side : /etc/hzy-data-runtime/.env  (HZY_SERVICE_CLIENT_<APP>_SECRET, read by the Console adapter through env_ref)
Application  : /etc/hzy/<app>.env          (the placeholder keys that hold the client secret)
Usage (root on the new host):  t-n-env-ref-secrets.py --only enterprise[,aims,codocs,workflow] (--plan | --apply)
Refuses to overwrite: the Runtime variable must be absent and every application key must still hold its REPLACE_ placeholder.
Nothing is started or restarted; the Runtime reads the new variables at its next start (B10b/B14 ordering, see the runbook)."""
import argparse, hashlib, os, pwd, secrets, shutil, sys, time

RUNTIME_ENV = "/etc/hzy-data-runtime/.env"
TARGETS = {
    "aims": ("HZY_SERVICE_CLIENT_AIMS_SECRET", "/etc/hzy/aims.env", ["HZY_AIMS_SERVICE_CLIENT_SECRET", "NUXT_HZY_SERVICE_CLIENT_CLIENT_SECRET"]),
    "codocs": ("HZY_SERVICE_CLIENT_CODOCS_SECRET", "/etc/hzy/codocs.env", ["HZY_SERVICE_CLIENT_SECRET", "NUXT_HZY_SERVICE_CLIENT_CLIENT_SECRET"]),
    "workflow": ("HZY_SERVICE_CLIENT_WORKFLOW_SECRET", "/etc/hzy/workflow.env", ["HZY_SERVICE_CLIENT_SECRET", "NUXT_HZY_SERVICE_CLIENT_CLIENT_SECRET"]),
    "enterprise": ("HZY_SERVICE_CLIENT_ENTERPRISE_SECRET", "/etc/hzy/enterprise.env", ["HZY_SERVICE_CLIENT_SECRET"]),
}

def read_lines(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read().split("\n")

def get(lines, key):
    for line in lines:
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def fp(value):
    return hashlib.sha256(value.encode()).hexdigest()[:12]

def write_like(path, text):
    st = os.stat(path)
    tmp = path + ".tmp-envref"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chown(tmp, st.st_uid, st.st_gid)
    os.chmod(tmp, st.st_mode & 0o777)
    os.replace(tmp, path)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", required=True)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", action="store_true")
    mode.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    names = [n.strip() for n in args.only.split(",") if n.strip()]
    if not names or any(n not in TARGETS for n in names):
        sys.exit("unknown target; choose from " + ",".join(TARGETS))
    runtime_lines = read_lines(RUNTIME_ENV)
    problems, plan = [], []
    for name in names:
        var, app_path, keys = TARGETS[name]
        app_lines = read_lines(app_path)
        if get(runtime_lines, var) is not None:
            problems.append(f"{name}: {var} already present in {RUNTIME_ENV}")
        for key in keys:
            current = get(app_lines, key)
            if current is None or not current.startswith("REPLACE_"):
                problems.append(f"{name}: {app_path} {key} is not a REPLACE_ placeholder")
        plan.append((name, var, app_path, keys))
    for p in plan:
        print(f"{'PLAN' if args.plan else 'APPLY'} {p[0]}: runtime {p[1]} + {p[2]} keys {p[3]}")
    if problems:
        print("\n".join("REFUSED: " + p for p in problems))
        sys.exit(2)
    if args.plan:
        return
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    backup = f"/root/.hzy-a5/envref-backup-{stamp}"
    os.makedirs(backup, mode=0o700)
    for path in {RUNTIME_ENV, *[p[2] for p in plan]}:
        shutil.copy2(path, os.path.join(backup, os.path.basename(path)))
    print(f"backups: {backup} (0700)")
    new_runtime = list(runtime_lines)
    if new_runtime and new_runtime[-1] == "":
        new_runtime.pop()
    written = {}
    for name, var, app_path, keys in plan:
        value = secrets.token_urlsafe(48)
        written[name] = fp(value)
        new_runtime.append(f'{var}="{value}"')
        app_lines = read_lines(app_path)
        out = [f"{line.split('=', 1)[0]}={value}" if line.split('=', 1)[0] in keys else line for line in app_lines]
        write_like(app_path, "\n".join(out))
        del value
    write_like(RUNTIME_ENV, "\n".join(new_runtime) + "\n")
    # Read back both sides and compare fingerprints.
    ok = True
    rl = read_lines(RUNTIME_ENV)
    for name, var, app_path, keys in plan:
        al = read_lines(app_path)
        fps = {get(rl, var) and fp(get(rl, var))} | {fp(get(al, k)) for k in keys if get(al, k)}
        same = len(fps) == 1 and written[name] in fps and all(get(al, k) and not get(al, k).startswith("REPLACE_") for k in keys)
        ok &= same
        print(f"{name}: runtime/app fingerprints {'MATCH' if same else 'MISMATCH'} sha256[:12]={written[name]}")
    for path in [RUNTIME_ENV] + [p[2] for p in plan]:
        st = os.stat(path)
        print(f"{path} mode={oct(st.st_mode & 0o777)} owner={pwd.getpwuid(st.st_uid).pw_name}")
    if not ok:
        sys.exit(3)

if __name__ == "__main__":
    main()
