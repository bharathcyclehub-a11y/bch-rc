const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const dns = require('node:dns').promises;
const { createHash } = require('node:crypto');
const API = 'https://apiv2.shiprocket.in/v1/external/auth/login';
const appDir = diagnosticConfig.appDir;
const env = parseEnv(fs.readFileSync(path.join(appDir, 'shared/.env'), 'utf8'));
const secrets = Object.entries(env).filter(([k]) => /password|token|secret|key|database_url|email/i.test(k)).map(([,v])=>v).filter(v=>v.length>3);
function scrub(value) {
  let s=String(value);
  for (const secret of secrets) s=s.split(secret).join('<redacted>');
  return s.replace(/("(?:token|access_token|refresh_token|password|email)"\s*:\s*")[^"]*"/gi,'$1<redacted>"')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'<redacted-token>')
    .replace(/^(set-cookie|authorization|proxy-authorization):.*$/gim,'$1: <redacted>')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g,'$1<redacted>@');
}
function clean(value) {
  if(typeof value==='string')return scrub(value);
  if(Array.isArray(value))return value.map(clean);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,/^(token|access_token|refresh_token|password|email|authorization|proxy-authorization|set-cookie)$/i.test(k)?'<redacted>':clean(v)]));
  return value;
}
function emit(label, data) { console.log(JSON.stringify({label,data:clean(data)})); }
function run(file,args,input) {
  const r=spawnSync(file,args,{encoding:'utf8',input,timeout:25000,maxBuffer:1024*1024});
  return {exit:r.status,stdout:scrub(r.stdout||''),stderr:scrub(r.stderr||''),error:r.error?.code};
}
function curl(label,args,input) {const r=run('curl',['-sS','--connect-timeout','8','--max-time','20',...args],input);emit(label,r);return r;}
function credentialHash(e){return createHash('sha256').update(diagnosticConfig.salt+JSON.stringify([e.SHIPROCKET_EMAIL,e.SHIPROCKET_PASSWORD])).digest('hex');}
async function main(){
  emit('runtime',{node:process.version,utc:new Date().toISOString(),user:process.getuid?.(),credentials_present:!!env.SHIPROCKET_EMAIL&&!!env.SHIPROCKET_PASSWORD,credentials_match_deployment_secret:credentialHash(env)===diagnosticConfig.expectedHash});
  for (const k of ['SHIPROCKET_EMAIL','SHIPROCKET_PASSWORD','SHIPROCKET_PICKUP_LOCATION','SHIPROCKET_PICKUP_PINCODE']) emit('env_variable',{name:k,present:!!env[k],outer_whitespace:env[k]!==env[k]?.trim()});
  const live=[];
  for(const pid of fs.readdirSync('/proc').filter(p=>/^\d+$/.test(p))){try{
    const e=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
    if(e.name==='bch-rc'||(e.pm_cwd&&e.pm_cwd.startsWith(appDir+'/'))){live.push({pid,credentials_match_file:e.SHIPROCKET_EMAIL===env.SHIPROCKET_EMAIL&&e.SHIPROCKET_PASSWORD===env.SHIPROCKET_PASSWORD,proxy_vars:Object.keys(e).filter(k=>/^(https?|all|no)_proxy$|^NODE_USE_ENV_PROXY$|^NODE_OPTIONS$/i.test(k))});}
  }catch{}}
  emit('application_processes',live);
  emit('proxy_variables',{shell:Object.keys(process.env).filter(k=>/^(https?|all|no)_proxy$|^NODE_USE_ENV_PROXY$/i.test(k)),file:Object.keys(env).filter(k=>/^(https?|all|no)_proxy$|^NODE_USE_ENV_PROXY$/i.test(k))});
  const ip4=curl('outbound_ipv4',['-4','https://api.ipify.org']);
  emit('outbound_matches_vps_host',ip4.exit===0&&ip4.stdout.trim()===diagnosticConfig.vpsHost);
  curl('outbound_ipv6',['-6','https://api6.ipify.org']);
  for(const family of [4,6]){try{emit('dns_ipv'+family,await (family===4?dns.resolve4('apiv2.shiprocket.in'):dns.resolve6('apiv2.shiprocket.in')));}catch(e){emit('dns_ipv'+family,{error:e.code});}}
  emit('nslookup',run('nslookup',['apiv2.shiprocket.in']));
  if(!env.SHIPROCKET_EMAIL||!env.SHIPROCKET_PASSWORD) throw Error('Missing Shiprocket login variables');
  const payload=JSON.stringify({email:env.SHIPROCKET_EMAIL,password:env.SHIPROCKET_PASSWORD});
  for(const family of [4,6]) curl('curl_login_ipv'+family,['-'+family,'-i','-X','POST',API,'-H','Content-Type: application/json','--data-binary','@-','-w','\nremote_ip=%{remote_ip} http_code=%{http_code}\n'],payload);
  try{const res=await fetch(API,{method:'POST',headers:{'content-type':'application/json'},body:payload,signal:AbortSignal.timeout(20000)});const body=await res.text();emit('node_login',{status:res.status,headers:Object.fromEntries(res.headers),body});}catch(e){emit('node_login',{error:e.message,cause:e.cause?.code});}
  curl('curl_verbose_get_ipv4',['-4','-v',API]);
  emit('addresses',run('ip',['-br','address']));
  emit('routes',run('ip',['route','show']));
  emit('ufw',run('sudo',['-n','ufw','status','verbose']));
  emit('iptables_output',run('sudo',['-n','iptables','-S','OUTPUT']));
  emit('iptables_nat',run('sudo',['-n','iptables','-t','nat','-S']));
}
main().catch(e=>{emit('fatal',{message:e.message});process.exitCode=1;});
