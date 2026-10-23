import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Store } from './store.js';
import type { Config } from './config.js';
import type { WalletWatch } from './wallets.js';
const html=`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Solana Profit Engine</title>
<style>body{font:16px system-ui;background:#10151e;color:#e9eef6;margin:2rem}button,input{font:inherit;padding:.6rem}section{background:#1b2433;padding:1rem;margin:1rem 0;border-radius:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}.warning{color:#ffc870}table{width:100%;text-align:left}td,th{padding:.5rem;border-bottom:1px solid #455}</style>
<h1>Solana Profit Engine V1</h1><p class="warning" id="state">Łączenie…</p><form id="auth"><input id="token" type="password" placeholder="Token panelu" autocomplete="off"><button>Połącz</button></form>
<section><h2>Kapitał i wynik netto</h2><pre id="summary"></pre></section><section><h2>Pozycje</h2><div id="positions"></div></section>
<section><h2>Źródła danych</h2><pre id="health"></pre></section><section><h2>Obserwowane portfele — historia częściowa</h2><pre id="wallets"></pre></section><section><h2>Decyzje i transakcje</h2><pre id="events"></pre></section>
<script>let token='';document.querySelector('#auth').onsubmit=e=>{e.preventDefault();token=document.querySelector('#token').value;refresh()};
function dollars(x){return x===null?'nieznane':(Number(x)/1e6).toFixed(4)+' USD'}
async function refresh(){try{let r=await fetch('/api/state',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Dostęp: '+r.status);let s=await r.json();
document.querySelector('#state').textContent='Tryb: '+s.mode.toUpperCase()+' • '+s.status+' • '+new Date(s.at).toLocaleTimeString();
document.querySelector('#summary').textContent=JSON.stringify(s.summary,null,2);
let el=document.querySelector('#positions');el.replaceChildren();for(let p of s.positions){let line=document.createElement('p');line.textContent=p.mint+' | '+p.strategy+' | ilość '+p.atoms+' | wynik zrealizowany '+dollars(p.realizedUsd)+' | odzyskany wkład '+p.recovered+' | status '+p.status;el.append(line)}
document.querySelector('#health').textContent=JSON.stringify(s.health,null,2);document.querySelector('#wallets').textContent=JSON.stringify(s.wallets,null,2);
document.querySelector('#events').textContent=s.events.map(e=>new Date(e.at).toISOString()+' '+e.kind+' '+e.mint+' '+JSON.stringify(e.payload)).join('\\n');
}catch(e){document.querySelector('#state').textContent=e.message}}refresh();setInterval(refresh,3000);</script></html>`;
export function dashboard(store:Store,cfg:Config,wallets:WalletWatch){
  return createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
    if(req.method!=='GET'){res.writeHead(405).end();return;}
    if(req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({process:'running',mode:cfg.MODE,marketReady:store.get('market_ready')??false}));return;}
    if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
    if(req.url!=='/api/state'){res.writeHead(404).end();return;}
    if(cfg.DASHBOARD_TOKEN){
      const sent=Buffer.from(req.headers.authorization??''),expected=Buffer.from('Bearer '+cfg.DASHBOARD_TOKEN);
      if(sent.length!==expected.length||!timingSafeEqual(sent,expected)){res.writeHead(401).end();return;}
    }
    const positions=store.positions(false),fills=store.fills(),events=store.recent(80);
    const realized=positions.reduce((s,p)=>s+BigInt(p.realizedUsd),0n)-store.charges();
    const closed=positions.filter(p=>p.status==='closed'),wins=closed.filter(p=>BigInt(p.realizedUsd)>0n);
    const grossWins=closed.reduce((s,p)=>s+(BigInt(p.realizedUsd)>0n?BigInt(p.realizedUsd):0n),0n);
    const grossLoss=-closed.reduce((s,p)=>s+(BigInt(p.realizedUsd)<0n?BigInt(p.realizedUsd):0n),0n);
    const state={at:Date.now(),mode:cfg.MODE,status:store.get('market_ready')?'dane odbierane':'oczekiwanie na źródła; brak potwierdzenia gotowości rynku',
      summary:{paperCashMicroUsd:cfg.MODE==='paper'?store.get('paper_cash'):null,realizedMicroUsd:realized.toString(),
        openPositions:positions.filter(p=>p.status!=='closed').length,costsMicroUsd:(fills.reduce((s,f)=>s+BigInt(f.networkFeeUsd),0n)+store.charges()).toString(),
        closed:closed.length,winRate:closed.length?wins.length/closed.length:null,profitFactor:grossLoss?Number(grossWins)/Number(grossLoss):null,
        expectancyMicroUsd:closed.length?(closed.reduce((s,p)=>s+BigInt(p.realizedUsd),0n)/BigInt(closed.length)).toString():null,
        pnlNote:'USD valuation uses observed FX; fill deltas already include DEX fees and price impact. Paper is not live execution.'},
      positions:positions.map(p=>({...p,liquidation:store.get('mark:'+p.id)??{netUsd:null},quoteValueIsGuaranteed:false})),
      watchedTokens:store.markets().sort((a,b)=>b.change5m-a.change5m).slice(0,100),
      health:store.get('source_health')??{},wallets:wallets.leaders(),events};
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify(state,(k,v)=>['signedBase64','raw'].includes(k)?undefined:v));
  }).listen(cfg.PORT,cfg.HOST);
}
