import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFetchMetadata, isInfoRouteLanding, isInfoNewsLanding, campusLandingCategory } from '../src/policy.mjs';
const info='https://info.tsinghua.edu.cn';
const home='https://myhome.tsinghua.edu.cn';
const origins=new Set([info,home]);
const headers={'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document','sec-fetch-user':'?1'};
const navigation={method:'GET',hasBody:false};
const entry=info+'/f/info/route?id=ece02eecada569b9cae68be99461c98d';

test('Info news article IDs admit only exact read-only top-level navigation',()=>{
 const base=info+'/f/info/xxfb_fg/xnzx/template/detail';
 const article=base+'?xxid=00112233445566778899aabbccddeeff';
 for(const id of ['00112233445566778899aabbccddeeff','00112233445566778899AABBCCDDEEFF']){
  const target=new URL(base+'?xxid='+id);
  assert.equal(isInfoNewsLanding(target),true);
  assert.equal(campusLandingCategory(target),'info-news-detail');
  for(const method of ['GET','HEAD'])assert.doesNotThrow(()=>validateFetchMetadata(headers,target,origins,{method,hasBody:false}));
 }
 for(const url of [article+'&xxid=00112233445566778899aabbccddeeff',article+'&url=https://other.test/',article+'&ticket=value',article+'&',article+'#',article+'#fragment',base+'?xxid=bad',base+'?x%78id=00112233445566778899aabbccddeeff',article.replace(info,'https://other.tsinghua.edu.cn'),article.replace('/template/detail','/template/delete')]){
  assert.equal(isInfoNewsLanding(new URL(url)),false,url);
  assert.throws(()=>validateFetchMetadata(headers,new URL(url),origins,navigation),url);
 }
 for(const method of ['POST','DELETE'])assert.throws(()=>validateFetchMetadata(headers,new URL(article),origins,{method,hasBody:false}));
 assert.throws(()=>validateFetchMetadata({...headers,'sec-fetch-dest':'iframe'},new URL(article),origins,navigation));
 assert.throws(()=>validateFetchMetadata({...headers,'sec-fetch-user':undefined},new URL(article),origins,navigation));
});

test('user navigation accepts saved Info routes and numeric myhome notices',()=>{
 for(const href of [entry,info+'/f/info/route?id=routea0e943cd14c74d9b9a5416859c9ffd54',home+'/Netweb_List/News_notice_Detail.aspx?code=5697']){
  assert.doesNotThrow(()=>validateFetchMetadata(headers,new URL(href),origins,navigation));
  assert.throws(()=>validateFetchMetadata({...headers,'sec-fetch-dest':'iframe'},new URL(href),origins,navigation));
  assert.throws(()=>validateFetchMetadata(headers,new URL(href),origins,{method:'POST',hasBody:true}));
 }
});
test('official Info application links accept only a saved service selector',()=>{
 const href=info+'/f/info/portal_fg/teacher/roamingToApp?yyfwid=02380C5D6E263477772F7AA7018A51AF';
 for(const value of [href,href+'&bz=app'])assert.doesNotThrow(()=>validateFetchMetadata(headers,new URL(value),origins,navigation));
 for(const suffix of ['&yyfwid=duplicate','&bz=other','&bz=app&bz=app','&url=https://evil.test/','&ticket=untrusted']){
  assert.throws(()=>validateFetchMetadata(headers,new URL(href+suffix),origins,navigation));
 }
 assert.throws(()=>validateFetchMetadata(headers,new URL(href),origins,{method:'POST',hasBody:false}));
});

const discover='https://discover.lib.tsinghua.edu.cn';
const bookSearch=discover+'/entrance/searchEntrance/sortList?query=any,contains,%E6%95%B0%E6%8D%AE%E7%BB%93%E6%9E%84&tab=default_tab&search_scope=default_scope&vid=86THU';
test('official library search links admit user navigation with basic and advanced search parameters',()=>{
 const advanced=discover+'/entrance/searchEntrance/classificationList?mode=advanced&query=title,contains,algorithms&query=creator,contains,Knuth&pfilter=lang,exact,eng&pfilter=rtype,exact,books&offset=10&sortBy=date&lang=en_US&detailMark=true&isOpenDialog=false';
 const filtered=bookSearch+'&qInclude='+encodeURIComponent('facet_rtype,exact,books')+'&multiFacets='+encodeURIComponent(JSON.stringify({lang:['chi']}))+'&pcAvailability=true&value='+encodeURIComponent('纸本图书');
 for (const href of [bookSearch,advanced,filtered]) {
  for (const site of ['same-site','cross-site']) for (const method of ['GET','HEAD']) {
   assert.doesNotThrow(()=>validateFetchMetadata({...headers,'sec-fetch-site':site},new URL(href),new Set([discover]),{method,hasBody:false}));
  }
  assert.equal(campusLandingCategory(new URL(href)),'library-search');
 }
});
test('library search navigation does not allow hidden actions, redirects or untrusted request provenance',()=>{
 for (const href of [
  bookSearch+'&ticket=secret',bookSearch+'&redirect=https://evil.test/',bookSearch+'&action=delete',bookSearch+'&vid=duplicate',
  bookSearch+'&sortBy=date&sortBy=title',bookSearch+'&offset=-1',bookSearch+'&offset=1e5',bookSearch+'&lang=../../other',
  bookSearch+'&value=%00',bookSearch+'&value=%0A',bookSearch+'&value=%5C',bookSearch+'&value=%zz',bookSearch+'&value=%E4',
  bookSearch+'#secret',bookSearch+'&mode=action',bookSearch+'&detailMark=delete',
  bookSearch.replace('/sortList','/delete'),bookSearch.replace('/entrance/searchEntrance/sortList','/tsinghuasearch/primo/listData'),
  bookSearch.replace(discover,'https://evil.test'),bookSearch+'&query='+('a'.repeat(8192)),
  bookSearch+Array.from({length:16},(_,i)=>'&query=any,contains,'+i).join(''),
 ]) assert.throws(()=>validateFetchMetadata(headers,new URL(href),new Set([discover]),navigation),href);
 for (const changed of [
  {'sec-fetch-user':undefined},{'sec-fetch-user':'?0'},{'sec-fetch-mode':'cors'},
  {'sec-fetch-dest':'iframe'},{'sec-fetch-dest':'empty'},{origin:discover},
 ]) assert.throws(()=>validateFetchMetadata({...headers,...changed},new URL(bookSearch),new Set([discover]),navigation));
 assert.throws(()=>validateFetchMetadata(headers,new URL(bookSearch),new Set(),navigation));
 for (const method of ['POST','DELETE']) assert.throws(()=>validateFetchMetadata(headers,new URL(bookSearch),new Set([discover]),{method,hasBody:true}));
 assert.throws(()=>validateFetchMetadata(headers,new URL(bookSearch),new Set([discover]),{method:'GET',hasBody:true}));
});
test('navigation cannot add arbitrary targets, ticket fields, duplicate IDs or origin data',()=>{
 for(const href of [entry+'&url=https://evil.test/',entry+'&id=other',entry+'#fragment',entry.replace('ece02eec','invalid'),home+'/Netweb_List/News_notice_Detail.aspx?code=5697&ticket=other',home+'/Netweb_List/News_notice_Detail.aspx?code=//evil.test']){
  assert.throws(()=>validateFetchMetadata(headers,new URL(href),origins,navigation));
 }
 assert.equal(isInfoRouteLanding(new URL(entry)),true);
 assert.equal(isInfoRouteLanding(new URL(entry.replace(info,'https://evil.test'))),false);
 assert.throws(()=>validateFetchMetadata({...headers,origin:'https://evil.test'},new URL(entry),origins,navigation));
});
