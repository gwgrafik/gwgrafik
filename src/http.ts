export async function getJson<T>(url:string,init:RequestInit={},timeout=12_000):Promise<T>{
  const res=await fetch(url,{...init,signal:AbortSignal.timeout(timeout)});
  if(!res.ok)throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  return await res.json() as T;
}
export const errorText=(e:unknown)=>e instanceof Error ? e.message.replace(/https?:\/\/[^\s"']+/g,'[endpoint]').slice(0,300):'operation_failed';
