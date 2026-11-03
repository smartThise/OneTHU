import { icon } from './brand.generated.js';
import { resourceUrl } from './client.js';
export const esc = (x:unknown) => String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const text = (html:string) => { const d = new DOMParser().parseFromString(html,'text/html'); return d.body.textContent || ''; };
export function safeHtml(html:string) {
  const doc=new DOMParser().parseFromString(html||'', 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,svg,link,meta,base').forEach(n=>n.remove());
  for(const el of Array.from(doc.body.querySelectorAll('*'))) {
    const attrs=Array.from(el.attributes);
    for(const a of attrs) if(!['href','src','alt','title','colspan','rowspan','width','height'].includes(a.name)) el.removeAttribute(a.name);
    for(const a of ['href','src']) if(el.hasAttribute(a)) {
      try {const u=new URL(el.getAttribute(a)!,location.origin); if(!['https:','http:'].includes(u.protocol)) throw 0;
        if(a==='src'&&u.origin!==location.origin)throw 0;
        el.setAttribute(a,u.origin===location.origin?resourceUrl(u.href):u.href);
        if(a==='href'){el.setAttribute('target','_blank');el.setAttribute('rel','noopener noreferrer');}
      } catch {el.removeAttribute(a);}
    }
  }
  return doc.body.innerHTML;
}
export const rich=(html:string)=>`<div class="rich">${safeHtml(html)||'<p>未提供正文。</p>'}</div>`;
export const loading=(t='正在读取…')=>`<div class="loading"><span class="spinner"></span>${esc(t)}</div>`;
export const empty=(t:string)=>`<div class="empty"><strong>${esc(t)}</strong></div>`;
export const error=(t='读取失败，请重试。')=>`<div class="warning" role="alert">${esc(t)}</div>`;
export const btn=(action:string,label:string,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`;
export function attachment(a:{name:string;downloadUrl:string;size?:string}) {
  try{return `<a class="attachment" target="_blank" rel="noopener" href="${esc(resourceUrl(a.downloadUrl))}" download><span>${icon('File')} ${esc(a.name)}</span><small>${esc(a.size||'下载附件')} ${icon('Download')}</small></a>`;}catch{return error('附件地址不可用');}
}
export function nativeFrameCss() {return `:root{color-scheme:light}body{background:#fff!important;color:#212120!important;font-family:-apple-system,"PingFang SC",sans-serif!important}#banner,#banner_header,#banner_footer,#mrhere,.banner_header,.banner_footer,.mrhere,.navlef{display:none!important}#content,body>.content,.content{margin-left:0!important;width:auto!important;min-width:0!important}#content{float:none!important;margin:0!important;width:100%!important}.rtcon{padding-left:0!important;padding-right:0!important;box-sizing:border-box!important}.course,.course-w{width:100%!important;box-sizing:border-box!important}.course{background:#f7f7f5!important}input,select,textarea{border-radius:8px!important;accent-color:#212120}a{color:#383835}.btn,button,input[type=button],input[type=submit]{border-radius:8px!important}.btn{background:#212120!important;border-color:#212120!important;color:#fff!important}.dataTables_wrapper .paginate_button.current{background:#212120!important;color:#fff!important;border-color:#212120!important}`;}
