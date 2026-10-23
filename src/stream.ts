import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { errorText } from './http.js';
type Logs={signature:string;err:unknown;logs:string[]};
export function subscribeLogs(url:string,address:string,onLogs:(logs:Logs,context:{slot:number})=>void,onHealth:(h:unknown)=>void){
  let stopped=false,ws:WebSocket|undefined,retry:NodeJS.Timeout|undefined,ping:NodeJS.Timeout|undefined;
  let backoff=1000,lastPong=0;
  const connect=()=>{
    if(stopped)return;
    const proxy=process.env.HTTPS_PROXY??process.env.https_proxy??process.env.HTTP_PROXY??process.env.http_proxy;
    ws=new WebSocket(url,{agent:proxy?new HttpsProxyAgent(proxy):undefined,handshakeTimeout:10000,maxPayload:4*1024*1024});
    ws.on('open',()=>{
      lastPong=Date.now();backoff=1000;
      ws!.send(JSON.stringify({jsonrpc:'2.0',id:1,method:'logsSubscribe',params:[{mentions:[address]},{commitment:'confirmed'}]}));
      onHealth({source:'pump-ws',ok:true,connected:true,at:Date.now()});
      ping=setInterval(()=>{if(Date.now()-lastPong>45000)ws?.terminate();else ws?.ping();},15000);
    });
    ws.on('pong',()=>{lastPong=Date.now();});
    ws.on('message',data=>{
      try{
        const msg=JSON.parse(data.toString());
        if(msg.error){onHealth({source:'pump-ws',ok:false,at:Date.now(),reason:'subscription_rejected'});ws?.close();return;}
        if(msg.method==='logsNotification'&&msg.params?.result?.value)onLogs(msg.params.result.value,msg.params.result.context);
      }catch(e){onHealth({source:'pump-ws',ok:false,at:Date.now(),reason:errorText(e)});}
    });
    ws.on('error',e=>onHealth({source:'pump-ws',ok:false,at:Date.now(),reason:errorText(e)}));
    ws.on('close',()=>{
      if(ping)clearInterval(ping);
      onHealth({source:'pump-ws',ok:false,at:Date.now(),reason:'stream_gap_reconnect_no_historical_replay'});
      if(!stopped){retry=setTimeout(connect,backoff);backoff=Math.min(backoff*2,30000);}
    });
  };
  connect();return ()=>{stopped=true;if(retry)clearTimeout(retry);if(ping)clearInterval(ping);ws?.terminate();};
}
