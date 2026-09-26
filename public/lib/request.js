export class RequestError extends Error {
  constructor(code,message,status=0){super(message);this.code=code;this.status=status;}
}

// AbortSignal.timeout is missing in iOS 15. Use the older AbortController API,
// and keep the timer active until the response body has finished loading too.
export async function requestJSON(path,{timeoutMs=20000,...options}={}){
  const controller=new AbortController();let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{
    const response=await fetch(path,{...options,signal:controller.signal});
    let data;
    if(response.headers.get('content-type')?.includes('application/json')){
      try{data=await response.json();}catch(error){if(timedOut)throw error;if(response.ok)throw new RequestError('format','词库接口返回的数据无法解析。');}
    }
    if(!response.ok)throw new RequestError('http',data?.error||`服务器暂时无法处理请求（HTTP ${response.status}）。`,response.status);
    if(data===undefined)throw new RequestError('format','词库接口未返回有效的 JSON 数据。');
    return data;
  }catch(error){
    if(timedOut)throw new RequestError('timeout','等待服务器响应超时。');
    if(error instanceof RequestError)throw error;
    throw new RequestError('network','无法连接网站服务，请检查网络后重试。');
  }finally{clearTimeout(timer);}
}

export const canRetry=error=>['timeout','network'].includes(error.code)||(error.code==='http'&&[408,429,500,502,503,504].includes(error.status));
