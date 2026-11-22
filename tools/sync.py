"""The sync job (.github/workflows/sync.yml): new Telegram posts and YouTube videos -> the site, with no one involved.

  1. tools/tg_fetch.py        new posts of both channels -> data/channels/<folder>/result.json
  2. telegram_lessons.py + import_telegram.py (TELEGRAM_EXPORTS=data/channels) -> site/data/library.json
     safety: a run that would drop a lesson that is on the site stops here and commits nothing
  3. tools/fetch_audio.py     host the new lessons' audio in R2 -> site/data/media.json (a failed file is retried next run)
  4. tools/youtube_sync.py + tools/import_youtube.mjs -> data/youtube.json, site/catalogue.json (skipped if YouTube refuses; both channels)
  5. node scripts/build.mjs   the site must still build
  6. commit + push to main    Cloudflare redeploys on the push
  7. report                   GitHub's run summary, and an email to the team inbox (POST /api/sync-report, SYNC_TOKEN)
                              when something was added, held or failed

Usage: python tools/sync.py [--no-push] [--no-audio] [--no-videos]
"""
import argparse, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "site" / "data" / "library.json"
MEDIA = ROOT / "site" / "data" / "media.json"
LESSONS = ROOT / "data" / "channels" / "lessons.json"
REPORT_URLS = ["https://hadadi.emah84.workers.dev/api/sync-report", "https://h-haddadi.com/api/sync-report"]
FILES = ["data/channels", "site/data/library.json", "site/data/media.json", "data/youtube.json", "site/catalogue.json"]
ENV = {**os.environ, "TELEGRAM_EXPORTS": str(ROOT / "data" / "channels"), "PYTHONUNBUFFERED": "1"}


def run(cmd, check=True, timeout=None):
    print("$ " + " ".join(cmd), flush=True)
    p = subprocess.run(cmd, cwd=ROOT, env=ENV, capture_output=True, text=True, timeout=timeout)
    if p.stderr: sys.stderr.write(p.stderr[-6000:])
    if check and p.returncode != 0: raise RuntimeError(f"{Path(cmd[1]).name if len(cmd) > 1 else cmd[0]} failed: " + (p.stderr.strip().splitlines() or ["exit " + str(p.returncode)])[-1][:300])
    return p


def load(p, default):
    try: return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError): return default


def changed_files():
    p = run(["git", "status", "--porcelain", "--", *FILES], check=False)
    return [ln[3:] for ln in p.stdout.splitlines() if ln.strip()]


def restore():
    run(["git", "checkout", "--", *[f for f in FILES if (ROOT / f).exists()]], check=False)
    run(["git", "clean", "-fdq", "--", "data/channels"], check=False)


def first_line(s):
    for ln in (s or "").splitlines():
        ln = re.sub(r"[^\w\s:«»()،.-]", "", ln).strip()
        if len(ln) > 3: return ln[:120]
    return ""


def report(rep):
    """GitHub's run summary always; the email only when something happened."""
    lines = [f"## Sync {time.strftime('%Y-%m-%d %H:%M', time.gmtime())} UTC", ""]
    for k, title in (("lessons", "New lessons"), ("audio", "Audio hosted"), ("videos", "New videos"), ("held", "Held back (not published)"), ("errors", "Problems")):
        if rep.get(k):
            lines.append(f"**{title}: {len(rep[k])}**")
            lines += [f"- {x}" for x in rep[k]]
            lines.append("")
    if len(lines) == 2: lines.append("Nothing new.")
    text = "\n".join(lines)
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f: f.write(text + "\n")
    tok = os.environ.get("SYNC_TOKEN")
    if not tok or not any(rep.get(k) for k in ("lessons", "videos", "held", "errors")): return
    body = json.dumps({k: rep.get(k, []) for k in ("lessons", "audio", "videos", "held", "errors")} | {"run": rep.get("run", "")}).encode()
    for u in REPORT_URLS:
        try:
            req = urllib.request.Request(u, data=body, method="POST", headers={"content-type": "application/json", "authorization": "Bearer " + tok, "user-agent": "hadadi-sync"})
            with urllib.request.urlopen(req, timeout=20) as r:
                if r.status == 200: print(f"report sent ({u})"); return
        except Exception as e:
            print(f"report to {u}: {e}", file=sys.stderr)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--no-push", action="store_true", help="commit nothing (a dry run of everything else)")
    ap.add_argument("--no-audio", action="store_true")
    ap.add_argument("--no-videos", action="store_true")
    a = ap.parse_args(argv)
    rep = {"lessons": [], "audio": [], "videos": [], "held": [], "errors": []}
    if os.environ.get("GITHUB_RUN_ID"):
        rep["run"] = f"{os.environ.get('GITHUB_SERVER_URL', 'https://github.com')}/{os.environ.get('GITHUB_REPOSITORY')}/actions/runs/{os.environ['GITHUB_RUN_ID']}"
    old = load(LIB, {"lessons": []})
    old_ids = {l["id"] for l in old["lessons"]}
    old_media = load(MEDIA, {})

    # 1-2. Telegram
    try:
        p = run([sys.executable, "tools/tg_fetch.py"], timeout=900)
        got = json.loads(p.stdout.strip().splitlines()[-1])
        fresh = {f"{ch}-{i}" for ch, x in got.items() for i in x["new"] + x["changed"]}
        if fresh:
            run([sys.executable, "tools/telegram_lessons.py"])
            run([sys.executable, "tools/import_telegram.py"])
            new = load(LIB, {"lessons": []})
            new_ids = {l["id"] for l in new["lessons"]}
            gone = sorted(old_ids - new_ids)
            if gone:
                restore()
                raise RuntimeError(f"the import would remove {len(gone)} lessons from the site ({', '.join(gone[:5])}); nothing was changed")
            rep["lessons"] = [f"{l['title']} ({l['id']})" for l in new["lessons"] if l["id"] not in old_ids]
            for l in load(LESSONS, []):   # new posts that the rules left out: another speaker, forwarded, no title
                post_ids = {"-".join(re.match(r"https://t\.me/(\w+)/(\d+)", u).groups()).replace("Aqar8-", "masothrbj47-") for u in l.get("posts", []) if re.match(r"https://t\.me/(\w+)/(\d+)", u)}
                if l["id"] not in new_ids and (post_ids & fresh or l["id"] in fresh):
                    rep["held"].append(f"{l['id']}: {', '.join(l.get('flags') or ['left out'])}. {first_line(l.get('caption')) or l.get('title') or ''}".strip())
    except Exception as e:
        msg = str(e)
        if "TELEGRAM_LOGIN_EXPIRED" in msg: msg = "The Telegram login no longer works: run setup_sync.sh again in Cloud Shell."
        rep["errors"].append("Telegram: " + msg)

    # 3. audio
    if not a.no_audio and not any(x.startswith("Telegram: the import") for x in rep["errors"]):
        p = run([sys.executable, "tools/fetch_audio.py", "--max-gb", "3"], check=False, timeout=3 * 3600)
        media = load(MEDIA, {})
        titles = {l.get("tg"): l["title"] for l in load(LIB, {"lessons": []})["lessons"]}
        rep["audio"] = [titles.get(u, u) for u in media if u not in old_media]
        if p.returncode != 0:
            fails = [ln.strip() for ln in p.stdout.splitlines() if ln.startswith("   https://t.me/")]
            rep["errors"] += [f"Audio not hosted yet (retried next run): {x}" for x in fails] or ["Audio: " + (p.stderr.strip().splitlines() or ["failed"])[-1][:300]]

    # 4. videos
    if not a.no_videos:
        try:
            p = run([sys.executable, "tools/youtube_sync.py"], timeout=900)
            got = json.loads(p.stdout.strip().splitlines()[-1])
            if got["added"]: run(["node", "tools/import_youtube.mjs"])
            rep["videos"] = [f"{v['title']} (https://youtu.be/{v['id']})" for v in got["added"]]
            rep["held"] += [f"Video https://youtu.be/{v['id']}: {v['why']}. {v['title']}" for v in got["held"]]
            rep["errors"] += ["YouTube: " + x for x in got.get("errors", [])]
        except Exception as e:
            rep["errors"].append("YouTube (videos skipped this run): " + str(e)[:300])
            run(["git", "checkout", "--", "data/youtube.json", "site/catalogue.json"], check=False)

    # 5-6. build, commit, push
    files = changed_files()
    if files:
        try:
            run(["node", "scripts/build.mjs"], timeout=900)
        except Exception as e:
            restore()
            rep["errors"].append("The site did not build with the new data, so nothing was published: " + str(e)[:300])
            files = []
    if files and not a.no_push:
        parts = [f"{len(rep['lessons'])} lessons" if rep["lessons"] else "", f"{len(rep['audio'])} audio" if rep["audio"] else "",
                 f"{len(rep['videos'])} videos" if rep["videos"] else ""]
        msg = "Sync: " + (", ".join(x for x in parts if x) or "updated posts")
        run(["git", "add", "--", *FILES])
        run(["git", "commit", "-q", "-m", msg + ("\n\n" + rep["run"] if rep.get("run") else "")])
        for n in range(4):
            if run(["git", "push", "-q", "origin", "HEAD:main"], check=False).returncode == 0: break
            run(["git", "pull", "-q", "--rebase", "origin", "main"], check=False); time.sleep(5 * (n + 1))
        else:
            rep["errors"].append("Could not push to main; the next run tries again.")
    report(rep)
    return 1 if any(not x.startswith("Audio not hosted yet") for x in rep["errors"]) else 0   # a file that failed is retried; the rest needs a look


if __name__ == "__main__":
    sys.exit(main())
