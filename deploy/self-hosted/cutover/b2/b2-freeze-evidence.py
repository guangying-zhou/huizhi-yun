#!/usr/bin/env python3
"""S4 B2: freeze evidence for the nine production databases (read-only).

Runs on the new host. Reads the Japan production MySQL with the read-only account from --cnf (default: the S3 hzy_dump client file).
Round mode collects, per database and table, COUNT(*) and CHECKSUM TABLE; compare mode diffs two round files. Only status and
counts are printed; no credentials. Output files are 0600 in a 0700 directory.

  b2-freeze-evidence.py round  --out DIR --name r1
  b2-freeze-evidence.py compare --out DIR r1 r2
"""
import argparse, json, os, subprocess, sys, time

DBS = ["hzy_aims", "hzy_altoc", "hzy_assets", "hzy_codocs", "hzy_console", "hzy_finance", "hzy_people", "hzy_webdev", "hzy_workflow"]

def mysql(cnf, sql, db=None):
    cmd = ["mysql", f"--defaults-extra-file={cnf}", "--batch", "--raw", "--skip-column-names"]
    if db: cmd.append(db)
    r = subprocess.run(cmd + ["-e", sql], capture_output=True, text=True)
    if r.returncode: raise SystemExit(f"mysql failed ({db}): {r.stderr.strip()[:160]}")
    return [line.split("\t") for line in r.stdout.splitlines() if line]

def collect(cnf, dbs):
    """One mysql session per database (a fresh TLS connection per statement is far too slow over the WAN)."""
    out = {"utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "dbs": {}}
    for db in dbs:
        tables = [r[0] for r in mysql(cnf, "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY 1", db)]
        sql = "".join(f"SELECT 'C', '{t}', COUNT(*) FROM `{t}`; CHECKSUM TABLE `{t}`;\n" for t in tables)
        entry = {t: {} for t in tables}
        for row in mysql(cnf, sql, db):
            if row[0] == "C": entry[row[1]]["count"] = int(row[2])
            else: entry[row[0].split(".", 1)[1]]["checksum"] = row[1]
        missing = [t for t, v in entry.items() if set(v) != {"count", "checksum"}]
        if missing: raise SystemExit(f"incomplete result for {db}: {missing[:3]}")
        out["dbs"][db] = entry
    return out

def write_private(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh: fh.write(data)

def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("round"); r.add_argument("--out", required=True); r.add_argument("--name", required=True); r.add_argument("--cnf", default="/root/.hzy-s3/hzy_dump.my.cnf"); r.add_argument("--dbs", default=",".join(DBS), help="comma-separated database names (default: the nine Japan production databases)")
    r.add_argument("--alias", default="", help="restored-name=recorded-name pairs, e.g. hzy_aims_src=hzy_aims, so a restored copy is recorded under the production name")
    c = sub.add_parser("compare"); c.add_argument("--out", required=True); c.add_argument("--counts-only", action="store_true", help="compare row counts only (cross-server restore checks); checksum differences are reported separately"); c.add_argument("a"); c.add_argument("b")
    args = ap.parse_args()
    os.umask(0o077)
    os.makedirs(args.out, mode=0o700, exist_ok=True)
    if args.cmd == "round":
        data = collect(args.cnf, args.dbs.split(","))
        alias = dict(p.split("=", 1) for p in args.alias.split(",") if p)
        data["dbs"] = {alias.get(k, k): v for k, v in data["dbs"].items()}
        write_private(os.path.join(args.out, args.name + ".json"), json.dumps(data, sort_keys=True))
        tables = sum(len(v) for v in data["dbs"].values()); rows = sum(t["count"] for v in data["dbs"].values() for t in v.values())
        print(f"round {args.name} utc={data['utc']} databases={len(data['dbs'])} tables={tables} rows={rows}")
        return 0
    a = json.load(open(os.path.join(args.out, args.a + ".json"))); b = json.load(open(os.path.join(args.out, args.b + ".json")))
    diffs, sumdiffs = [], []
    for db in sorted(set(a["dbs"]) | set(b["dbs"])):
        ta, tb = a["dbs"].get(db, {}), b["dbs"].get(db, {})
        for t in sorted(set(ta) | set(tb)):
            x, y = ta.get(t), tb.get(t)
            if x == y: continue
            if args.counts_only and x and y and x["count"] == y["count"]: sumdiffs.append((db, t, x, y)); continue
            diffs.append((db, t, x, y))
    for db, t, x, y in diffs: print(f"DIFF {db}.{t} {x} -> {y}")
    for db, t, x, y in sumdiffs: print(f"CHECKSUM-ONLY {db}.{t} {x['checksum']} -> {y['checksum']}")
    print(f"compare {args.a} ({a['utc']}) vs {args.b} ({b['utc']}): tables={sum(len(v) for v in a['dbs'].values())} count_or_structure_differences={len(diffs)} checksum_only_differences={len(sumdiffs)}")
    return 1 if diffs else 0

if __name__ == "__main__":
    sys.exit(main())
