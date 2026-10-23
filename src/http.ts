export class HttpError extends Error {
  constructor(readonly status:number,hostname:string,readonly retryAfterMs=0){super(`HTTP ${status} from ${hostname}`);}
}
export function retryDelay(e:unknown,fallback=30_000):number{
  return e instanceof HttpError&&e.status===429?Math.max(fallback,e.retryAfterMs):/\b429\b/.test(errorText(e))?fallback:0;
}
export async function getJson<T>(url:string,init:RequestInit={},timeout=12_000):Promise<T>{
  const res=await fetch(url,{...init,signal:AbortSignal.timeout(timeout)});
  if(!res.ok){
    const header=res.headers.get('retry-after');
    const retry=header?(/^\d+(\.\d+)?$/.test(header)?Number(header)*1000:Math.max(0,Date.parse(header)-Date.now())):0;
    await res.body?.cancel();
    throw new HttpError(res.status,new URL(url).hostname,Number.isFinite(retry)?retry:0);
  }
  return await res.json() as T;
}
export const errorText=(e:unknown)=>e instanceof Error ? e.message.replace(/https?:\/\/[^\s"']+/g,'[endpoint]').slice(0,300):'operation_failed';
