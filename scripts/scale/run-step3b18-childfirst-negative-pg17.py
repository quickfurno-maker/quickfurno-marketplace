# Offline synthetic PostgreSQL17 negative rehearsal; no Supabase URLs, no secrets.
import os,pathlib,subprocess,shutil,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
BIN=pathlib.Path("C:/Program Files/PostgreSQL/17/bin")
SCRATCH=pathlib.Path("D:/QuickFurno-Workspace/Artifacts/QF-3B18-NEGATIVE-PG17-20261025")
PORT="55490"
def run(args,timeout=60,capture=False):
 r=subprocess.run([str(a) for a in args],stdin=subprocess.DEVNULL,
    stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
    stderr=subprocess.PIPE if capture else subprocess.DEVNULL,
    text=True,encoding="utf-8",errors="replace",timeout=timeout)
 if r.returncode: raise RuntimeError("LOCAL_NEGATIVE_REHEARSAL_COMMAND_FAILURE:"+pathlib.Path(str(args[0])).name+":"+str(r.returncode)+":"+((r.stderr or "")[-350:] if capture else ""))
 return (r.stdout or "")
if SCRATCH.exists():raise RuntimeError("REFUSE_EXISTING_SCRATCH")
for tool in ("pg_isready.exe","initdb.exe","pg_ctl.exe","psql.exe"):
 if not (BIN/tool).is_file():raise RuntimeError("MISSING_PG17:"+tool)
r=subprocess.run([str(BIN/"pg_isready.exe"),"-q","-h","127.0.0.1","-p",PORT],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if r.returncode==0:raise RuntimeError("SCRATCH_PORT_ALREADY_SERVING")
SCRATCH.mkdir(parents=True)
started=False
try:
 sql=SCRATCH/"rehearsal.sql"
 with sql.open("wb") as o:
  p=subprocess.run(["node",str(ROOT/"scripts/scale/step3b18-childfirst-negative-generate.mjs")],stdin=subprocess.DEVNULL,stdout=o,stderr=subprocess.PIPE,timeout=30)
 if p.returncode:raise RuntimeError("SOURCE_MIGRATION_SQL_GENERATION_FAILED")
 txt=sql.read_text(encoding="utf-8")
 if not txt.lstrip().startswith("\\set ON_ERROR_STOP on"):raise RuntimeError("PSQL_ERROR_STOP_MARKER_MISSING")
 if "\\echo STEP3B17_REAL_MIGRATION" not in txt:raise RuntimeError("PASS_MARKER_MISSING")
 pgdata=SCRATCH/"pgdata"
 run([BIN/"initdb.exe","-D",pgdata,"-A","trust","-U","postgres","-E","UTF8","--locale=C","--no-instructions"],90)
 r=subprocess.run([str(BIN/"pg_ctl.exe"),"-D",str(pgdata),"-l",str(SCRATCH/"postgres.log"),
  "-o",f"-c listen_addresses=127.0.0.1 -p {PORT}","-W","start"],
  stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
 if r.returncode:raise RuntimeError("SCRATCH_POSTGRES_START_FAILED")
 started=True
 for i in range(40):
  probe=subprocess.run([str(BIN/"pg_isready.exe"),"-q","-h","127.0.0.1","-p",PORT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  if probe.returncode==0:break
  time.sleep(.25)
 else:raise RuntimeError("SCRATCH_POSTGRES_NOT_READY")
 out=run([BIN/"psql.exe","-X","-h","127.0.0.1","-p",PORT,"-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-f",sql],70,True)
 if "STEP3B18_CHILD_FIRST_WITH_IMMUTABLE_LINEAGE_NEGATIVE_PASS" not in out:raise RuntimeError("LOCAL_SCRIPT_PASS_MARKER_ABSENT")
 print("STEP3B18_CHILD_FIRST_NEGATIVE_PG17_PASS")
 print("SYNTHETIC_ROOTS=29 vendors, 74 leads, 73 immutable events; blocked row-delete, rewrite, truncate, root deletes")
 print("VALID_EXCEPTION=assignment backreference cleared with immutable lead/vendor lineage intact")
finally:
 if started:
  r=subprocess.run([str(BIN/"pg_ctl.exe"),"-D",str(SCRATCH/"pgdata"),"-m","fast","-w","stop"],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=25)
  if r.returncode:raise RuntimeError("SCRATCH_STOP_FAILED: DO NOT REMOVE PENDING_POSTGRES")
 shutil.rmtree(SCRATCH)
 print("SCRATCH_PG17_STOPPED_AND_WIPED")
