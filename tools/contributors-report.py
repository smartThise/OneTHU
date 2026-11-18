#!/usr/bin/env python3
"""Public contributor snapshot across official Git branches. Emails are never published."""
import argparse,datetime,json,pathlib,re,subprocess
parser=argparse.ArgumentParser()
parser.add_argument('--ref',default=None)
parser.add_argument('--branches',nargs='*',default=None)
parser.add_argument('--offline',action='store_true')
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
def git(*argv):return subprocess.check_output(['git',*argv],cwd=root,text=True)
def existing_refs(candidates):
 out=[]
 for ref in candidates:
  if subprocess.call(['git','rev-parse','--verify','--quiet',ref],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)==0:
   out.append(ref)
 return out

if args.branches:
 refs=existing_refs(args.branches) or ['HEAD']
elif args.ref:
 refs=[args.ref]
else:
 refs=existing_refs(['main','dev3','web','origin/main','origin/dev3','origin/web','github/main','github/dev3','github/web']) or ['HEAD']

latest_sha=git('log','-1','--format=%H',*refs).strip()
raw=git('log',*refs,'--no-merges','--numstat','--format=%x1e%aN%x1f%aE%x1f%H%x1d%B%x1c')
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
for row in git('log',*refs,'--format=%aN%x1f%aE%x1f%H').splitlines():
 name,email,sha=row.split('\x1f');identities.setdefault(email.lower(),{'name':name,'commit':sha,'commits':0,'codeAdded':0,'codeDeleted':0})
for name,email in credit:identities.setdefault(email.lower(),{'name':name,'commit':None,'commits':0,'codeAdded':0,'codeDeleted':0})
alias_path=root/'docs/contributor-identities.json'
raw_aliases=json.loads(alias_path.read_text()) if alias_path.exists() else {}
aliases={k.casefold():v for k,v in raw_aliases.items()}
people={}
for email,item in identities.items():
 login=raw_aliases.get(item['name']) or aliases.get(item['name'].casefold())
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
report={'ref':latest_sha,'generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'majorThreshold':10000,'metric':'Cumulative added source-code lines across reachable official branches (main, dev3, web); non-merge commits, excluding generated/vendor/locales/fixtures and non-code files. GitHub account aliases combined when resolvable. Coauthors and merge-only authors are listed alongside commit authors. Line counts serve as a scale indicator alongside design, testing, and feedback contributions.','contributors':sorted(people.values(),key=lambda item:(-item['codeAdded'],item['name'].casefold()))}
(root/'docs/contributors.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
for en in [False,True]:
 lines=['# '+('Contributors' if en else '贡献者'),'','[中文](../contributors.md) · English' if en else '中文 · [English](en/contributors.md)','',('Compiled automatically across official Git branches (`main`, `dev3`, `web`) and refreshed live on the website and online docs via GitHub API and scheduled CI builds. **Major contributor** recognizes contributors with more than **10,000 cumulative added source-code lines** across non-merge commits (excluding generated or vendor code, localization dictionaries, test fixtures, and non-code files). Resolvable GitHub identities are merged automatically, and all commit authors and credited coauthors are included together. Line counts reflect code volume only—every contribution in design, testing, documentation, and issue reporting matters just as much.' if en else '基于官方分支（`main`、`dev3`、`web`）可追溯的 Git 历史自动汇总，并在官网与在线文档站通过 GitHub 接口及定时构建实时刷新。累计新增源码超过 **10,000 行**的贡献者标记为**主要贡献者**（统计非合并提交，排除生成代码、第三方依赖、语言词典、测试夹具与非代码文件）。可识别的同一 GitHub 身份已自动合并，所有提交作者与署名共同作者均完整收录。代码行数仅作规模参考，每一份设计、测试、文档与反馈贡献都同样珍贵。'),'','| '+('Contributor | Added code lines | Non-merge commits | Role |' if en else '贡献者 | 新增代码行数 | 非合并提交 | 标记 |'),'|---|---:|---:|---|']
 for p in report['contributors']:
  name=p['name'].replace('|','\\|').replace('<','&lt;').replace('>','&gt;');name=f"[{name}]({p['github']})" if p['github'] else name
  lines.append(f"| {name} | {p['codeAdded']:,} | {p['commits']} | {('Major contributor' if en else '主要贡献者') if p['major'] else '—'} |")
 lines+=['',f"{'Source commit' if en else '统计提交'}: `{report['ref']}`",f"{'Generated' if en else '更新时间'}: {report['generatedAt']}",'',('Live stats update automatically on [Developers](https://onethu.github.io/en/developers.html#contributors) and in online docs (emails are omitted for privacy).' if en else '官网 [开发者页](https://onethu.github.io/developers.html#contributors) 与在线文档会自动拉取最新提交实时更新（为保护隐私，公开清单已隐去邮箱地址）。')]
 path=root/'docs'/('en/contributors.md' if en else 'contributors.md');path.parent.mkdir(exist_ok=True);path.write_text('\n'.join(lines)+'\n')
print(json.dumps({'ref':latest_sha[:8],'contributors':len(people),'major':[p['name'] for p in report['contributors'] if p['major']]}))
