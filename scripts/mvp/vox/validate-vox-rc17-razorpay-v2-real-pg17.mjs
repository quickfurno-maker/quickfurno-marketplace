#!/usr/bin/env node
// RC17-A: disposable real PG17, no provider network or managed DB.
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const name="qf-vox-rc17-v2-pg17";
const docker=args=>execFileSync("docker",args,{encoding:"utf8",timeout:20000,stdio:["ignore","pipe","ignore"]}).trim();
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const uuid=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const [vendor,pkg,testOrder,liveOrder,token,other,liveToken,nullProviderOrder]=[1,2,3,4,5,6,7,8].map(uuid);
const check=(value,label)=>{if(!value)throw Error(label)};
const reject=async(fn,label)=>{let denied=false;try{await fn()}catch{denied=true}check(denied,label+"_MUST_DENY")};
const setup=[
 "CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN",
 "CREATE TABLE public.vendors (id uuid PRIMARY KEY,package_expires_at timestamptz,package_name text,package_status text,paid_status text,credits integer DEFAULT 0)",
 "CREATE TABLE public.packages (id uuid PRIMARY KEY,name text,lead_count integer,total_price numeric,validity_days integer,is_active boolean)",
 "CREATE TABLE public.vendor_package_orders (id uuid PRIMARY KEY,vendor_id uuid,package_id uuid,package_name text,package_price numeric,package_currency text,credits_included integer,validity_days integer,order_status text,payment_status text,payment_provider text,payment_method text,provider_order_id text UNIQUE,provider_payment_id text UNIQUE,provider_amount_subunits bigint,provider_receipt text,provider_order_request_token uuid,provider_order_requested_at timestamptz,paid_at timestamptz,activated_at timestamptz,activation_status text,failure_reason text,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now())",
 "CREATE TABLE public.payments (id uuid PRIMARY KEY,vendor_id uuid,package_id uuid,amount numeric,payment_method text,payment_status text,transaction_id text)",
 "CREATE TABLE public.vendor_packages (id uuid DEFAULT gen_random_uuid() PRIMARY KEY,vendor_id uuid,package_id uuid,expiry_date timestamptz,total_leads integer,remaining_leads integer,price_paid numeric,payment_status text,status text)",
 "CREATE TABLE public.vendor_credit_logs (reference_type text,reference_id text,UNIQUE(reference_type,reference_id))",
 "CREATE FUNCTION public.qf_apply_vendor_credit_delta(uuid,integer,text,text,text,text,text,boolean) RETURNS jsonb LANGUAGE plpgsql AS $f$ BEGIN INSERT INTO public.vendor_credit_logs VALUES($5,$6); UPDATE public.vendors SET credits=credits+$2 WHERE id=$1; RETURN jsonb_build_object('status','applied'); END $f$",
 "CREATE FUNCTION public.update_vendor_visibility(uuid) RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$"
].join(";")+";";
let pool,started=false;
try{
 for(const key of ["DATABASE_URL","SUPABASE_URL","SUPABASE_SERVICE_ROLE_KEY","RAZORPAY_LIVE_KEY_SECRET"])
  check(!process.env[key],"MANAGED_CREDENTIAL_DENIED_"+key);
 check(!process.env.DOCKER_HOST||/^(unix|npipe):\/\//.test(process.env.DOCKER_HOST),
  "REMOTE_DOCKER_DENIED");
 docker(["image","inspect","postgres:17-alpine"]);
 check(!docker(["ps","-aq","--filter","name=^/"+name+"$"]),"CONTAINER_ALREADY_EXISTS");
 docker(["run","-d","--rm","--pull","never","--name",name,
  "-p","127.0.0.1::5432","-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine"]);
 started=true;
 let port=0,ready=false;
 for(let i=0;i<125;i++){
  try{
   const m=docker(["port",name,"5432/tcp"]).match(/^127\.0\.0\.1:(\d+)$/m);
   if(m)port=Number(m[1]);
   ready=docker(["exec",name,"psql","-X","-A","-t","-U","postgres","-d","postgres","-c","SELECT 1;"])==="1";
  }catch{}
  if(port&&ready)break;await sleep(125);
 }
 check(port&&ready,"PG17_NOT_READY");
 pool=new Pool({host:"127.0.0.1",port,user:"postgres",password:"synthetic_only",database:"postgres",max:4});
 await pool.query(setup);
 await pool.query("INSERT INTO public.vendors(id) VALUES($1)",[vendor]);
 await pool.query("INSERT INTO public.packages(id,name,lead_count,total_price,validity_days,is_active) VALUES($1,'Pune',10,790,30,true)",[pkg]);
 for(const orderId of [testOrder,liveOrder,nullProviderOrder]){
  await pool.query("INSERT INTO public.vendor_package_orders(id,vendor_id,package_id,package_name,package_price,package_currency,credits_included,validity_days,order_status,payment_status,payment_provider,payment_method,activation_status) VALUES($1,$2,$3,'Pune',790,'INR',10,30,'created','not_started','not_connected','online_future','not_activated')",[orderId,vendor,pkg]);
 }
 const ddl=readFileSync(resolve(root,"ops/vox/rc17-review-candidates/20261031001000_rc17_razorpay_v2_authority_REVIEW_ONLY.sql"),"utf8");
 await pool.query(ddl);
 const rpc=(fn,values)=>pool.query("SELECT public."+fn+"("+values.map((_,i)=>"$"+(i+1)).join(",")+") AS result",values).then(r=>r.rows[0].result);
 const claim=(id,t,mode)=>rpc("qf_claim_vendor_package_razorpay_order_v2",[id,t,mode]);
 const bind=(id,t,mode,providerId)=>rpc("qf_bind_vendor_package_razorpay_order_v2",[id,providerId,79000,"qfvp_"+id.replaceAll("-",""),t,mode]);
 const activate=(id,payment,mode)=>rpc("qf_activate_vendor_package_order_v2",[id,payment,mode]);
 const failed=(id,payment,mode)=>rpc("qf_mark_vendor_package_payment_failed_v2",[id,payment,mode]);
 const release=(id,t,mode)=>rpc("qf_release_vendor_package_razorpay_order_claim_v2",[id,t,mode]);
 await pool.query("UPDATE public.vendor_package_orders SET payment_provider=NULL WHERE id=$1",[nullProviderOrder]);
 await reject(()=>claim(nullProviderOrder,other,"test"),"NULL_PROVIDER_CANNOT_CLAIM");
 const c=await claim(testOrder,token,"test");
 check(c.status==="claimed"&&Number(c.amount_subunits)===79000,"CLAIM_INVALID");
 await reject(()=>claim(testOrder,other,"test"),"CONCURRENT_CLAIM");
 await reject(()=>claim(testOrder,token,"test"),"UNCERTAIN_SAME_TOKEN_RETRY");
 await reject(()=>bind(testOrder,other,"test","order_test"),"WRONG_BIND_TOKEN");
 await reject(()=>bind(testOrder,token,"live","order_test"),"WRONG_BIND_MODE");
 check((await bind(testOrder,token,"test","order_test")).status==="bound","BIND_FAILED");
 check((await claim(testOrder,other,"test")).provider_order_id==="order_test","BOUND_READ_MISSING");
 await reject(()=>claim(testOrder,other,"live"),"BOUND_CROSS_MODE");
 await reject(()=>activate(testOrder,"pay_test","live"),"PAYMENT_CROSS_MODE");
 check((await activate(testOrder,"pay_test","test")).credits_added===10,"CREDIT_NOT_GRANTED");
 check((await activate(testOrder,"pay_test","test")).credits_added===0,"DUPLICATE_CREDIT");
 await reject(()=>activate(testOrder,"pay_other","test"),"PAYMENT_REPLAY_FORGED");
 check((await failed(testOrder,"pay_failed","test")).status==="ignored_activated","FAIL_AFTER_PAID");
 const vendorState=await pool.query("SELECT credits FROM public.vendors WHERE id=$1",[vendor]);
 check(vendorState.rows[0].credits===10,"EXACT_ONCE_CREDIT_FAILED");
 const logs=await pool.query("SELECT count(*)::int AS n FROM public.vendor_credit_logs");
 check(logs.rows[0].n===1,"EXACT_ONCE_LOG_FAILED");
 await claim(liveOrder,liveToken,"live");
 await reject(()=>release(liveOrder,other,"live"),"WRONG_RELEASE_TOKEN");
 await reject(()=>release(liveOrder,liveToken,"test"),"WRONG_RELEASE_MODE");
 await release(liveOrder,liveToken,"live");
 await reject(()=>release(liveOrder,liveToken,"live"),"RELEASE_REPLAY");
 const cleared=await pool.query("SELECT provider_mode,provider_order_request_token,payment_provider FROM public.vendor_package_orders WHERE id=$1",[liveOrder]);
 check(cleared.rows[0].provider_mode===null&&cleared.rows[0].provider_order_request_token===null&&cleared.rows[0].payment_provider==="not_connected","RELEASE_NOT_ATOMIC");
 await claim(liveOrder,other,"live");
 await bind(liveOrder,other,"live","order_live");
 await reject(()=>failed(liveOrder,"pay_other","test"),"FAILED_CROSS_MODE");
 check((await failed(liveOrder,"pay_live","live")).status==="marked_failed","FAILED_EVENT_NOT_RECORDED");
 const priv=await pool.query("SELECT has_function_privilege('anon','public.qf_claim_vendor_package_razorpay_order_v2(uuid,uuid,text)','EXECUTE') a,has_function_privilege('authenticated','public.qf_activate_vendor_package_order_v2(uuid,text,text)','EXECUTE') b");
 check(priv.rows[0].a===false&&priv.rows[0].b===false,"BROWSER_RPC_EXPOSED");
 console.log("VOX_RC17_REAL_PG17_RAZORPAY_V2_PASS funcs=5 exact_once_credit=true test_live_fenced=true claim_replay_denied=true browser_rpc_denied=true provider_calls=0");
}catch(e){
 console.error("VOX_RC17_REAL_PG17_RAZORPAY_V2_FAIL "+String(e?.stack||e));process.exitCode=1;
}finally{if(pool)try{await pool.end()}catch{}if(started)try{docker(["rm","-f","-v",name])}catch{}}
