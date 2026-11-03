import { icon } from './brand.generated.js';
import { deadlineInfo } from './deadline.js';
import { client, resourceUrl, originalUrl } from './client.js';
import { esc, rich, safeHtml, text, loading, error, attachment, btn, empty } from './ui.js';
import type { Homework, Notification, CourseFile, LearnBbsBoard, LearnBbsThreadDetail, LearnBbsPost } from '../../../packages/core/src/learn/types.js';
export interface DetailHost { open(title:string,html:string): number; update(token:number,html:string):void; refresh():Promise<void>; noticeRead(cid:string):Promise<void>; toast(t:string):void; root:ShadowRoot; }
export function details(ui:DetailHost) {
  let preview:CourseFile|null=null;let previewUrl='';
  let token=0, current:Homework|null=null, page:Awaited<ReturnType<typeof client.getHomeworkPageDetail>>|null=null;
  let forum:{cid:string;boards:LearnBbsBoard[];bqid:string;kind:'yb'|'jh'|'cy';start:number;thread?:LearnBbsThreadDetail;page:number;seen:Set<string>}|null=null;
  const nativeLink=(url:string)=>`<a class="button-link" href="${esc(originalUrl(url))}" target="_blank" rel="noopener">原版页面 ${icon('External')}</a>`;
  async function hw(h:Homework) {
    current=h;page=null;token=ui.open(h.title,loading('正在读取作业正文、附件与提交状态…'));const id=token;
    try {
      const results=await Promise.allSettled([client.getHomeworkPageDetail(h.courseId,h.id),h.baseId?client.getHomeworkDetail(h.baseId):Promise.resolve({description:h.content})]);
      if(id!==token)return;
      if(results[0].status==='rejected')throw results[0].reason;
      page=results[0].value;
      const description=results[1].status==='fulfilled'?results[1].value.description:page.description||h.content;
      const groups=[['教师附件','teacher',page.attachment],['答案附件','answer',page.answerAttachment],['我的提交附件','submission',page.submittedAttachment],['批改附件','grade',page.gradeAttachment]] as const;
      ui.update(id,`<div class="detail-meta"><span>${icon('Clock')}${esc(h.deadline?'截止 '+h.deadline:'截止时间未提供')} ${!h.submitted?`<b class="deadline ${deadlineInfo(h.deadline).tone}">${esc(deadlineInfo(h.deadline).label)}</b>`:''}</span><span class="badge">${h.graded?'已批改':h.submitted?'已提交':'未提交'}</span>${nativeLink(h.url)}</div><h3>作业说明</h3>${rich(description||page.description||'')}${groups.map(([label,role,a])=>{const rows=page!.attachments?.filter(x=>x.role===role)||[];const seen=new Set<string>();const atts=(rows.length?rows:a?[a]:[]).filter(x=>{let key=x.downloadUrl;try{const u=new URL(resourceUrl(key));u.searchParams.delete('_csrf');key=u.href;}catch{}if(seen.has(key))return false;seen.add(key);return true;});return atts.length?`<h3>${label}</h3>${atts.map(attachment).join('')}`:'';}).join('')}${text(page.submittedContent||'').trim()?`<h3>已提交内容</h3>${rich(page.submittedContent)}`:''}${h.graded?`<section class="panel"><h3>批改结果</h3><p class="grade">${esc(h.grade??'未提供分数')}</p><p>${esc(h.graderName||'')} ${esc(h.gradeTime||'')}</p>${rich(h.gradeContent||'')}</section>`:''}${page.hasSubmitForm?`<form id="homework-form" class="editor-form"><h3>${h.submitted?'更新作业':'提交作业'}</h3><label>作业内容</label><div class="editor-toolbar">${['bold','italic','insertUnorderedList','insertOrderedList'].map((k,i)=>`<button type="button" data-format="${k}">${['加粗','斜体','无序列表','编号列表'][i]}</button>`).join('')}</div><div id="hw-content" role="textbox" aria-label="作业内容" aria-multiline="true" contenteditable="true" class="rich rich-editor">${safeHtml(page.submittedContent||'')}</div><label>附件<input type="file" id="hw-file"></label>${page.submittedAttachment?'<p>未选择新文件时保留当前附件。</p>':''}<div class="form-actions"><button type="submit" class="primary">${h.submitted?'更新提交':'提交作业'}</button>${page.submittedAttachment?btn('remove-attachment','移除已提交附件','class="danger"'):''}</div><div id="write-status" role="status"></div></form>`:'<div class="notice-note">学校当前未开放此作业的提交表单。</div>'}`);
    } catch {ui.update(id,error('作业详情读取失败，请重试。')+btn('retry-homework','重试')+nativeLink(h.url));}
  }
  async function notice(n:Notification) {
    token=ui.open(n.title,loading());const id=token;
    try {const p=await client.getNotificationPageDetail(n.courseId,n.id,n.attachmentName);ui.update(id,`<div class="detail-meta">${esc(n.publisher)} · ${esc(n.publishTime)} ${nativeLink(n.url)}</div>${rich(n.content||'')}${(p.attachments?.length?p.attachments:p.attachment?[p.attachment]:[]).map(attachment).join('')}`);if(id===token)void ui.noticeRead(n.courseId);}catch{ui.update(id,error('通知附件读取失败。')+rich(n.content||'')+nativeLink(n.url));}
  }
  function file(f:CourseFile) {
    preview=f;
    token=ui.open(f.title,`<div class="detail-meta">${esc(f.uploadTime)} · ${esc(f.size||'')} · ${esc(f.fileType||'')}</div>${f.description?rich(f.description):''}${attachment({name:f.title,downloadUrl:f.downloadUrl,size:f.size})}${/^(pdf|png|jpe?g|gif|webp|txt)$/i.test(f.fileType||'')?`<button data-action="preview-file">预览文件</button><div id="preview-area"></div>`:'<p class="notice-note">此格式请下载后使用对应应用打开。</p>'}`);
  }
  async function groups(cid:string) {token=ui.open('我的分组',loading());const id=token;try{const rows=await client.getCourseGroups(cid);ui.update(id,rows.length?rows.map(g=>`<section class="panel"><h3>${esc(g.name)}</h3><p>${esc(g.creator||'')} ${esc(g.createTime||'')}</p><div class="members">${g.members.map(m=>`<span class="badge">${esc(m.name)}${m.role?' · '+esc(m.role):''}</span>`).join('')}</div></section>`).join(''):empty('暂无分组'));}catch{ui.update(id,error('分组读取失败。'));}}
  async function threads(cid:string,reset=true) {
    if(reset||!forum||forum.cid!==cid)forum={cid,boards:[],bqid:'',kind:'yb',start:0,page:0,seen:new Set()};
    token=ui.open('课程讨论',loading());const id=token;const f=forum!;
    try {
      if(!f.boards.length)f.boards=await client.getBbsBoards(cid);
      const data=await client.getBbsThreads(cid,{bqid:f.bqid,kind:f.kind,start:f.start,length:20});
      if(id!==token)return;
      ui.update(id,`<div class="forum-tools"><select id="forum-board" aria-label="讨论板块"><option value="">全部板块</option>${f.boards.map(b=>`<option value="${esc(b.bqid)}" ${b.bqid===f.bqid?'selected':''}>${esc(b.name)}</option>`).join('')}</select><select id="forum-kind" aria-label="讨论筛选"><option value="yb" ${f.kind==='yb'?'selected':''}>全部</option><option value="jh" ${f.kind==='jh'?'selected':''}>精华</option><option value="cy" ${f.kind==='cy'?'selected':''}>我参与的</option></select>${btn('new-thread','发表话题','class="primary"')}</div><div class="thread-list">${data.threads.map(t=>`<button class="thread-row" data-action="thread" data-id="${esc(t.id)}" data-board="${esc(t.bqid||f.bqid)}"><strong>${t.pinned?'置顶 · ':''}${t.essence?'精华 · ':''}${esc(t.title)}</strong><small>${esc(t.author)} · ${esc(t.time)} · ${t.replies} 回复</small></button>`).join('')||empty('暂无话题')}</div><div class="pager">${btn('forum-prev','上一页',f.start===0?'disabled':'')}<span>${f.start+1}–${Math.min(f.start+20,data.total)} / ${data.total}</span>${btn('forum-next','下一页',f.start+20>=data.total?'disabled':'')}</div>`);
    }catch{ui.update(id,error('讨论列表读取失败。')+btn('retry-forum','重试'));}
  }
  function posts(rows:LearnBbsPost[]):string {return rows.map(p=>`<article class="post"><div class="detail-meta">${esc(p.author)} · ${esc(p.time)}</div>${rich(p.html)}${p.attachments.map(a=>attachment({name:a.wjmc,downloadUrl:`/b/wlxt/bbs/bbs_tltb/student/downloadFileByTlForStu?wlkcid=${encodeURIComponent(forum!.cid)}&wjid=${encodeURIComponent(a.wjid)}`})).join('')}${btn('reply-to','回复','data-id="'+esc(p.hhid)+'"')}${p.children?.length?`<div class="nested">${posts(p.children)}</div>`:''}</article>`).join('');}
  async function thread(threadId:string,bqid?:string) {
    if(!forum)return;token=ui.open('讨论详情',loading());const id=token;
    try{const t=await client.getBbsThread(forum.cid,threadId,bqid);forum.thread=t;forum.page=0;forum.seen=new Set(t.posts.map(p=>p.hhid));replyTo='';ui.update(id,btn('back-forum',icon('Chevron')+' 返回讨论列表')+`<h2>${esc(t.title)}</h2><div class="detail-meta">${esc(t.author)} · ${esc(t.time)}</div>${rich(t.html)}<h3>回复 · ${t.replyCount}</h3><div id="forum-posts">${posts(t.posts)}</div>${t.replyCount>t.posts.length||t.posts.length>=15?btn('more-posts','加载更多回复'):''}<form id="reply-form" class="editor-form"><h3 id="reply-label">发表回复</h3><textarea id="reply-content" required rows="5" placeholder="输入回复内容"></textarea><input type="file" id="reply-file"><button type="submit" class="primary">发送回复</button><div id="write-status" role="status"></div></form>`);}catch{ui.update(id,error('话题读取失败。')+btn('back-forum','返回列表'));}
  }
  function newThread() {if(!forum)return;token=ui.open('发表话题',`<form id="thread-form" class="editor-form"><label>板块<select id="new-board" required>${forum.boards.map(b=>`<option value="${esc(b.bqid)}">${esc(b.name)}</option>`).join('')}</select></label><label>标题<input id="thread-title" required maxlength="200"></label><label>正文<textarea id="thread-content" required rows="8"></textarea></label><label>附件<input id="thread-file" type="file"></label><button type="submit" class="primary">发表话题</button><div id="write-status" role="status"></div></form>`);}
  let replyTo='';let writing=false;
  function invalidate(){ token++; current=null;page=null;preview=null;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';} }
  async function write(form:HTMLFormElement) {
    if(writing)return;
    const status=form.querySelector('#write-status') as HTMLElement;
    const file=(id:string)=>(form.querySelector('#'+id) as HTMLInputElement)?.files?.[0];
    const value=(id:string)=>(form.querySelector('#'+id) as HTMLInputElement)?.value||'';
    writing=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='正在提交，请等待学校确认…';
    try {
      if(form.id==='homework-form'&&current&&page?.hasSubmitForm){
        const h=current;const html=safeHtml(form.querySelector('#hw-content')?.innerHTML||'');
        const result=await client.submitHomework(h.id,{content:html,file:file('hw-file')});
        if(!result.ok)throw new Error(result.msg||'提交未获确认');
        // Read back from server before presenting success.
        const actual=await client.getAllHomework([h.courseId]); const row=actual.find(row=>row.id===h.id);
        if(!row?.submitted)throw new Error('学校返回成功，但回读尚未显示已提交；请核对后再操作。');
        ui.toast('作业已提交，已核对学校状态');await ui.refresh();await hw(row);
      }else if(form.id==='reply-form'&&forum?.thread){await client.postBbsReply(forum.cid,forum.thread.id,'<p>'+esc(value('reply-content')).replace(/\n/g,'<br>')+'</p>',replyTo||undefined,file('reply-file'));replyTo='';ui.toast('回复已发送');await thread(forum.thread.id,forum.thread.bqid);}
      else if(form.id==='thread-form'&&forum){await client.postBbsThread(forum.cid,{bqid:value('new-board'),title:value('thread-title'),html:'<p>'+esc(value('thread-content')).replace(/\n/g,'<br>')+'</p>',file:file('thread-file')});ui.toast('话题已发表');await threads(forum.cid,false);}
    }catch(err){status.textContent=err instanceof Error?err.message:'提交失败，请重试。';}finally{writing=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  ui.root.addEventListener('submit',ev=>{const form=ev.target as HTMLFormElement;if(['homework-form','reply-form','thread-form'].includes(form.id)){ev.preventDefault();void write(form);}});
  ui.root.addEventListener('change',ev=>{const el=ev.target as HTMLSelectElement;if(forum&&(el.id==='forum-board'||el.id==='forum-kind')){if(el.id==='forum-board')forum.bqid=el.value;else forum.kind=el.value as 'yb'|'jh'|'cy';forum.start=0;void threads(forum.cid,false);}});
  ui.root.addEventListener('mousedown',ev=>{if((ev.target as Element).closest('[data-format]'))ev.preventDefault();});
  ui.root.addEventListener('click',ev=>{const el=(ev.target as Element).closest('[data-format]') as HTMLElement|null;if(el){document.execCommand(el.dataset.format!,false);}});
  ui.root.addEventListener('click',async ev=>{const el=(ev.target as Element).closest('[data-action]') as HTMLElement|null;if(!el)return;const action=el.dataset.action;
    if(action==='preview-file'&&preview){const id=token;const area=ui.root.querySelector('#preview-area');if(area)area.innerHTML=loading('正在读取预览…');try{const res=await fetch(resourceUrl(preview.downloadUrl),{credentials:'same-origin'});if(!res.ok)throw 0;if(Number(res.headers.get('content-length')||0)>50*1024*1024)throw 0;const raw=await res.blob();if(raw.size>50*1024*1024)throw 0;if(id!==token)return;if(previewUrl)URL.revokeObjectURL(previewUrl);const mime:Record<string,string>={pdf:'application/pdf',txt:'text/plain',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp'};const type=mime[(preview.fileType||'').toLowerCase()]||raw.type;if(!/^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/plain)/.test(type))throw 0;previewUrl=URL.createObjectURL(new Blob([raw],{type}));if(area)area.innerHTML=`<iframe class="file-preview" title="文件预览" src="${previewUrl}"></iframe>`;}catch{if(area)area.innerHTML=error('无法预览或文件过大，请下载后打开。');}}
    if(action==='retry-homework'&&current)void hw(current);
    if(action==='remove-attachment'&&current&&page){if(!confirm('确认移除这份作业已提交的附件？正文将保留。'))return;try{const result=await client.submitHomework(current.id,{content:page.submittedContent||'',remove:true});if(!result.ok)throw Error(result.msg);ui.toast('附件已移除');await hw(current);await ui.refresh();}catch{ui.toast('附件移除失败，请重新核对。');}}
    if(action==='retry-forum'||action==='back-forum'){if(forum)void threads(forum.cid,false);}
    if(action==='forum-prev'&&forum){forum.start=Math.max(0,forum.start-20);void threads(forum.cid,false);}
    if(action==='forum-next'&&forum){forum.start+=20;void threads(forum.cid,false);}
    if(action==='thread')void thread(el.dataset.id!,el.dataset.board);
    if(action==='new-thread')newThread();
    if(action==='reply-to'){replyTo=el.dataset.id||'';const label=ui.root.querySelector('#reply-label');if(label)label.textContent='回复选中楼层';(ui.root.querySelector('#reply-content') as HTMLTextAreaElement)?.focus();}
    if(action==='more-posts'&&forum?.thread){try{const rows=await client.getBbsThreadPosts(forum.cid,forum.thread.id,++forum.page,forum.thread.bqid);const fresh=rows.filter(p=>!forum!.seen.has(p.hhid));fresh.forEach(p=>forum!.seen.add(p.hhid));ui.root.querySelector('#forum-posts')?.insertAdjacentHTML('beforeend',posts(fresh));if(!fresh.length)el.remove();}catch{forum.page--;ui.toast('回复读取失败');}}
  });
  return {hw,notice,file,groups,threads,invalidate};
}
