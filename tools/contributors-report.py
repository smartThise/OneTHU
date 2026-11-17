#!/usr/bin/env python3
"""Public contributor snapshot from the selected Git history. Never publish author emails."""
import argparse,collections,datetime,json,pathlib,re,subprocess
parser=argparse.ArgumentParser();parser.add_argument('--ref',default='HEAD');parser.add_argument('--offline',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
def git(*argv):return subprocess.check_output(['git',*argv],cwd=root,text=True)
raw=git('log',args.ref,'--no-merges','--numstat','--format=%x1e%aN%x1f%aE%x1f%H%x1d%B%x1c')
identities={};credit=[]
code=re.compile(r'\.(?:[cm]?js|jsx|tsx?|rs|py|kts?|java|swift|sh|css|scss|html|vue|c|h|cpp)$')
exclude=re.compile(r'(?:^|/)(?:node_modules|dist|vendor|gen|generated|locales|fixtures|__snapshots__)(?:/|$)|(?:^|/)(?:pnpm-lock|package-lock)|\.min\.')
for entry in raw.split('\x1e')[1:]:
 metadata,rest=entry.split('\x1d',1);name,email,sha=metadata.split('\x1f');body,stats=rest.split('\x1c',1)
 identity=identities.setdefault(email.lower(),{'name':name,'commit':sha,'commits':0,'codeAdded':0,'codeDeleted':0});identity['commits']+=1
 for line in stats.splitlines():
  fields=line.split('\t',2)
  if len(fields)!=3:continue
  added,deleted,path=fields
  if added.isdigit() and code.search(path) and not exclude.search(path):identity['codeAdded']+=int(added);identity['codeDeleted']+=int(deleted)
 for coauthor in re.findall(r'^Co-authored-by:\s*(.*?)\s*<([^>]+)>',body,re.M|re.I):credit.append(coauthor)
# Include authors of merge-only commits and coauthors without attributing duplicated line totals.
for row in git('log',args.ref,'--format=%aN%x1f%aE%x1f%H').splitlines():
 name,email,sha=row.split('\x1f');identities.setdefault(email.lower(),{'name':name,'commit':sha,'commits':0,'codeAdded':0,'codeDeleted':0})
for name,email in credit:identities.setdefault(email.lower(),{'name':name,'commit':None,'commits':0,'codeAdded':0,'codeDeleted':0})
alias_path=root/'docs/contributor-identities.json'
aliases=json.loads(alias_path.read_text()) if alias_path.exists() else {}
people={}
for email,item in identities.items():
 login=aliases.get(item['name'])
 if not login and not args.offline and item['commit']:
  try:
   info=json.loads(subprocess.check_output(['gh','api','repos/smartThise/OneTHU/commits/'+item['commit']],text=True,stderr=subprocess.DEVNULL,timeout=20));login=(info.get('author') or {}).get('login')
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired,FileNotFoundError,json.JSONDecodeError):pass
 key=('github:'+login.lower()) if login else ('name:'+item['name'].casefold())
 public=people.setdefault(key,{'name':login or item['name'],'github':('https://github.com/'+login) if login else None,'commits':0,'codeAdded':0,'codeDeleted':0})
 for field in ['commits','codeAdded','codeDeleted']:public[field]+=item[field]
# Coauthor records often repeat a GitHub login without a resolvable commit.
for key,person in list(people.items()):
 target=people.get('github:'+person['name'].lower())
 if key.startswith('name:') and target is not None:
  for field in ['commits','codeAdded','codeDeleted']:target[field]+=person[field]
  del people[key]
for person in people.values():person['major']=person['codeAdded']>10000
report={'ref':git('rev-parse',args.ref).strip(),'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'majorThreshold':10000,'metric':'Cumulative added source-code lines in reachable dev3 history; non-merge commits, excluding generated/vendor/locales/fixtures and non-code files. GitHub account aliases combined when resolvable. Coauthors and merge-only authors are listed alongside commit authors. Line counts serve as a scale indicator alongside design, testing, and feedback contributions.','contributors':sorted(people.values(),key=lambda item:(-item['codeAdded'],item['name'].casefold()))}
(root/'docs/contributors.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for en in [False,True]:
 lines=['# '+('Contributors' if en else '贡献者'),'','[中文](../contributors.md) · English' if en else '中文 · [English](en/contributors.md)','',('Compiled from reachable `dev3` Git history. **Major contributor** recognizes contributors with more than **10,000 cumulative added source-code lines** across non-merge commits (excluding generated or vendor code, localization dictionaries, test fixtures, and non-code files). Resolvable GitHub identities are merged automatically, and all commit authors and credited coauthors are included together. Line counts reflect code volume only—every contribution in design, testing, documentation, and issue reporting matters just as much.' if en else '基于 `dev3` 分支可追溯的 Git 历史汇总。累计新增源码超过 **10,000 行**的贡献者标记为**主要贡献者**（统计非合并提交，排除生成代码、第三方依赖、语言词典、测试夹具与非代码文件）。可识别的同一 GitHub 身份已自动合并，所有提交作者与署名共同作者均完整收录；未关联 GitHub 账号的提交名称会单独列出。代码行数仅作规模参考，每一份设计、测试、文档与反馈贡献都同样珍贵。'),'','| '+('Contributor | Added code lines | Non-merge commits | Role |' if en else '贡献者 | 新增代码行数 | 非合并提交 | 标记 |'),'|---|---:|---:|---|']
 for p in report['contributors']:
  name=p['name'].replace('|','\\|').replace('<','&lt;').replace('>','&gt;');name=f"[{name}]({p['github']})" if p['github'] else name
  lines.append(f"| {name} | {p['codeAdded']:,} | {p['commits']} | {('Major contributor' if en else '主要贡献者') if p['major'] else '—'} |")
 lines+=['',f"{'Source commit' if en else '统计提交'}: `{report['ref']}`",f"{'Generated' if en else '生成时间'}: {report['generatedAt']}",'',('Regenerate with `python3 tools/contributors-report.py` (emails are omitted for privacy).' if en else '可通过 `python3 tools/contributors-report.py` 更新统计（为保护隐私，公开清单已隐去邮箱地址）。')]
 path=root/'docs'/('en/contributors.md' if en else 'contributors.md');path.parent.mkdir(exist_ok=True);path.write_text('\n'.join(lines)+'\n')
print(json.dumps({'contributors':len(people),'major':[p['name'] for p in report['contributors'] if p['major']]}))
