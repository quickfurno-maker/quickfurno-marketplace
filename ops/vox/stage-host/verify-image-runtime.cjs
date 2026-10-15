// Runs ONLY inside an isolated, network-none candidate image. No credentials.
(async()=>{
const cases=[
 ['/api/health',200],
 ['/api/overview',503],
 ['/api/vendor360',503],
 ['/api/service-desk',503],
 ['/api/approved-followups',503],
 ['/api/intelligence',503],
 ['/operations',200]
];
for(let i=0;i<30;i++){try{
  const response=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(1800)});
  response.body?.cancel?.().catch(()=>{});
  break;
}catch{await new Promise(r=>setTimeout(r,500));}}
let pass=0;for(const [path,status] of cases){
  let response;try{response=await fetch('http://127.0.0.1:3000'+path,{redirect:'manual',signal:AbortSignal.timeout(2500)});}
  catch{console.error('VOX_PRIVATE_IMAGE_NO_RESPONSE',path);process.exit(17);}
  const good=response.status===status;
  console.log('VOX_PRIVATE_IMAGE_HTTP',path,'observed='+response.status,'expected='+status,'pass='+good);
  if(good)pass++;
  response.body?.cancel?.().catch(()=>{});
}
console.log('VOX_PRIVATE_IMAGE_NO_EGRESS_SMOKE='+pass+'/'+cases.length);
if(pass!==cases.length)process.exitCode=18;
})().catch(()=>{console.error('VOX_PRIVATE_IMAGE_SMOKE_ERROR');process.exitCode=19;});
