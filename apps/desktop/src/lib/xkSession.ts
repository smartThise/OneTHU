import type { ZhjwxkSession } from '@onethu/core';

/** Stable cache key within an account, live credentials within that key. */
export function createXkSessionProvider(options: Pick<ZhjwxkSession,'http'|'isoFetch'|'onSessionReady'> & {
  identity: () => { username:string;password:string;fingerprint:string;finger3?:string };
}): () => ZhjwxkSession {
  let current: { username:string;fingerprint:string;session:ZhjwxkSession } | undefined;
  return () => {
    const identity=options.identity();
    if(!current||current.username!==identity.username||current.fingerprint!==identity.fingerprint){
      const {username,fingerprint}=identity;
      const owned=()=>{
        const now=options.identity();
        if(now.username!==username||now.fingerprint!==fingerprint)throw Object.assign(new Error('AUTH_SESSION_CHANGED'),{code:'AUTH_SESSION_CHANGED'});
        return now;
      };
      current={username,fingerprint,session:{http:options.http,isoFetch:options.isoFetch,
        get username(){return owned().username;},get password(){return owned().password;},
        get fingerprint(){return owned().fingerprint;},get finger3(){return owned().finger3;},
        onSessionReady:async state=>{owned();await options.onSessionReady?.(state);owned();}}};
    }
    return current.session;
  };
}
