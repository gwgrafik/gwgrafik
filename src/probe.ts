import { Connection } from '@solana/web3.js';
import { loadConfig } from './config.js';
import { getJson,errorText } from './http.js';
import { SOL,USDC } from './types.js';
const cfg=loadConfig();
const checks=[
  ['solana-rpc',async()=>new Connection(cfg.RPC_URL).getLatestBlockhash('confirmed')],
  ['dexscreener',async()=>getJson(`https://api.dexscreener.com/token-profiles/latest/v1`)],
  ['geckoterminal',async()=>getJson('https://api.geckoterminal.com/api/v2/networks/solana/new_pools')],
  ['jupiter-v2-quote',async()=>getJson(`${cfg.JUPITER_BASE_URL}/order?inputMint=${USDC}&outputMint=${SOL}&amount=2000000`,{headers:cfg.JUPITER_API_KEY?{'x-api-key':cfg.JUPITER_API_KEY}:{}})],
] as const;
const results=await Promise.all(checks.map(async([source,run])=>{const start=Date.now();try{await run();return {source,ok:true,ms:Date.now()-start};}catch(e){return {source,ok:false,ms:Date.now()-start,error:errorText(e)};}}));
console.log(JSON.stringify({at:new Date().toISOString(),results},null,2));
if(results.some(r=>!r.ok))process.exitCode=1;
