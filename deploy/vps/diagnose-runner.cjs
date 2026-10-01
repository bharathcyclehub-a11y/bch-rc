const fs=require('node:fs');
const {parseEnv}=require('node:util');
const {spawnSync}=require('node:child_process');
const {createHash,randomUUID}=require('node:crypto');
async function main(){
 const env=parseEnv(process.env.PRODUCTION_ENV||'');
 const salt=randomUUID();
 const expectedHash=createHash('sha256').update(salt+JSON.stringify([env.SHIPROCKET_EMAIL,env.SHIPROCKET_PASSWORD])).digest('hex');
 const cfg={appDir:process.env.APP_DIR,vpsHost:process.env.VPS_HOST,salt,expectedHash};
 if(!cfg.appDir||!cfg.vpsHost||!process.env.VPS_USER||!process.env.VPS_KNOWN_HOSTS||!process.env.SSHPASS)throw Error('Existing deployment SSH secrets incomplete');
 fs.mkdirSync(process.env.HOME+'/.ssh',{recursive:true,mode:0o700});
 fs.writeFileSync(process.env.HOME+'/.ssh/known_hosts',process.env.VPS_KNOWN_HOSTS+'\n',{mode:0o600});
 const script='const diagnosticConfig = '+JSON.stringify(cfg)+';\n'+fs.readFileSync('deploy/vps/diagnose-shiprocket.cjs','utf8');
 const r=spawnSync('sshpass',['-e','ssh','-p',process.env.VPS_PORT||'22','-o','StrictHostKeyChecking=yes','-o','PubkeyAuthentication=no','-o','ConnectTimeout=15',process.env.VPS_USER+'@'+process.env.VPS_HOST,'node -'],{input:script,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
 console.log(r.stdout||'');console.error(r.stderr||'');
 console.log('VPS diagnostic exit:',r.status);
 const response=await fetch('https://apiv2.shiprocket.in/v1/external/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:env.SHIPROCKET_EMAIL,password:env.SHIPROCKET_PASSWORD}),signal:AbortSignal.timeout(20000)});
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{}
 console.log(JSON.stringify({label:'github_runner_login',data:{status:response.status,content_type:response.headers.get('content-type'),server:response.headers.get('server'),token_present:!!data?.token}}));
 if(r.status!==0)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
