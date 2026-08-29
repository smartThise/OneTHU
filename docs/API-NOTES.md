# OneTHU · API / 解密 / 授权 知识库

> 本文收录 OneTHU 依赖的全部已验证结论。来源：thu-learn-lib、thu-info-lib、
> webvpn-poc 实测（与真实门户返回 URL 完全一致）、agentverse-tools（SM2 交叉验证）。
> 修改 core 实现前，先对照本文。

## 1. 统一身份认证（CAS · id.tsinghua.edu.cn）

登录密码 **必须 SM2 加密**，公钥从登录页动态抓取：

```
1. GET  https://id.tsinghua.edu.cn/do/off/ui/auth/login/form/bb5df85216504820be7bba2b0ae1535b/0
   → HTML 内 #sm2publicKey 文本即公钥（04 开头 hex）
2. POST https://id.tsinghua.edu.cn/do/off/ui/auth/login/check
   multipart/form-data:
     i_user          = 学号
     i_pass          = "04" + SM2Encrypt(password, pubKey)   // C1C3C2, sm-crypto cipherMode=1
     singleLogin     = "on"
     fingerPrint     = 设备指纹（随机 hex，首次生成后持久保存）
     fingerGenPrint  = ""
     fingerGenPrint3 = ""
     i_captcha       = ""
   → 返回 HTML 中第一个 <a href="...ticket=XXXX">，XXXX 即 ticket
```

- 登录前建议清掉 id 域的 JSESSIONID（learn-lib 的做法），避免残留会话串号。
- 2FA（双因子）：`https://id.tsinghua.edu.cn/b/doubleAuth/login`，验证码可走 wx/sms；
  信任设备走 `saveFinger`。core 预留 `onTwoFactor` 钩子。
- 常见失败文案：用户名或密码错误 / 验证码错误 / 需要双因子认证。

### ticket 漫游（登录各子系统）

| 目标 | URL |
|---|---|
| 网络学堂 | `https://learn.tsinghua.edu.cn/b/j_spring_security_thauth_roaming_entry?ticket=` |
| 登出网络学堂 | `https://learn.tsinghua.edu.cn/f/j_spring_security_logout` |

## 2. 网络学堂（learn.tsinghua.edu.cn）

登录漫游后，从课程列表页 HTML 用正则提取 `_csrf`（形如 `...&_csrf=xxx"`），
后续 `/b/wlxt/**` JSON 接口带 cookie 即可。

| 功能 | 方法 | 端点 |
|---|---|---|
| 学期列表 | GET | `/b/wlxt/kc/v_wlkc_xs_xktjb_coassb/queryxnxq` |
| 当前学期 | GET | `/b/kc/zhjw_v_code_xnxq/getCurrentAndNextSemester` |
| 课程列表 | GET | `/b/wlxt/kc/v_wlkc_xs_xkb_kcb_extend/student/loadCourseBySemesterId/{semester}/{lang}` |
| 课程时间地点 | GET | `/b/kc/v_wlkc_xk_sjddb/detail?id={wlkcid}` |
| 课程文件 | GET | `/b/wlxt/kj/wlkc_kjxxb/student/kjxxbByWlkcidAndSizeForStudent?wlkcid=&size=200` |
| 文件下载 | GET | `/b/wlxt/kj/wlkc_kjxxb/student/downloadFile?sfgk=0&wjid=` |
| 通知列表(未过期) | POST | `/b/wlxt/kcgg/wlkc_ggb/student/pageListXsbyWgq`（aoData 表单） |
| 通知列表(已过期) | POST | `/b/wlxt/kcgg/wlkc_ggb/student/pageListXsbyYgq` |
| 作业-未交 | POST | `/b/wlxt/kczy/zy/student/zyListWj` |
| 作业-已交未批 | POST | `/b/wlxt/kczy/zy/student/zyListYjwg` |
| 作业-已批 | POST | `/b/wlxt/kczy/zy/student/zyListYpg` |

- POST 类接口 body 为 DataTables `aoData`：`JSON.stringify([{name:"wlkcid", value:id}, ...])`。
- 作业响应 `object.aaData[]`：`zyid/wz/bt(标题)/nr(内容,Base64)/fbsj(发布)/jzsj(截止)/bjjzsj(补交截止)`。
- 会话失效特征：接口返回登录页 HTML 或 302 到 id → 触发重登录重放（retryAfterLogin 模式）。

## 3. 信息门户 / 教务（info.tsinghua.edu.cn · zhjw.cic.tsinghua.edu.cn）

| 功能 | 端点（直连） |
|---|---|
| 个人信息 | `https://info.tsinghua.edu.cn/b/info/gxfw_fg/common/grjbxx`（HTML） |
| 校历 | `.../b/info/gxfw_fg/common/xl` |
| 倒计时 | `.../b/info/gxfw_fg/common/deadline/list` |
| 课表漫游 | `.../f/info/gxfw_fg/common/cardRoaming/JXRL_BKS`（先访问，建立教务会话） |
| 课表 JSONP | `https://zhjw.cic.tsinghua.edu.cn/jxmh_out.do?m=bks_jxrl_all&p_start_date={d}&p_end_date={d}&jsoncallback=m` |
| 成绩 | `https://zhjw.cic.tsinghua.edu.cn/cj.cjCjbAll.do?m=bks_cjdcx&cjdlx=zw`（HTML 表格） |
| 二级课表 | `https://zhjw.cic.tsinghua.edu.cn/portal3rd.do?m=bks_ejkbSearch` |

- 课表 JSONP 返回 `m([...])`，去掉包装即 JSON 数组；字段含课程名/教师/周次/节次等。
- 本科生课表：研究生把 `bks_jxrl_all` 换 `yjs_jxrl_all`、`bks_cjdcx` 换 `yjs_cjdcx`。

## 4. WebVPN（webvpn.tsinghua.edu.cn · 网瑞达 Wrdvpn）—— 已完全破解

- 算法：**AES-128-CFB**（CFB-128，非 CFB-8）
- Key = IV = `wrdvpnisthebest!`（16 字节 ASCII）
- 编码主机名：明文（hostname）末尾补 `'0'` 至 16 的倍数 → 加密 →
  `hex(IV) + hex(密文).slice(0, 2 × 原始长度)`
- 最终 URL：`https://webvpn.tsinghua.edu.cn/{http|https}/{编码后主机名}{path}{query}`
- 例：`http://zhjw.cic.tsinghua.edu.cn/xklogin.do` 编码后与门户真实链接逐字符一致。
- 解码：跳过前 32 个 hex 字符（IV），密文补零到整块后解密，取前 `len/2` 字节，去尾部 `'0'`。
- **OneTHU 的改进**：不再像 thu-info-lib 那样硬编码 hex 前缀，`webvpnWrap(url)` 运行时动态生成。

### WebVPN 链路上的 CAS 大坑（webvpn-poc REPORT）

WebVPN 服务器端自己跟踪 302，用户 CAS cookie 不会参与 → 直连环路断裂。
解法：**后端/客户端直连 CAS 拿 ticket，再经 WebVPN 编码 URL 带 ticket 访问目标系统**。
部署两模式：校内直连（推荐）/ 任意位置走 WebVPN。

## 5. SM2 国密（选课系统等）

- 选课系统（zhjwxk）登录密码同为 SM2 加密（`04 + C1C3C2` hex）。
- 纯 Python SM2/SM3 零依赖实现（agentverse-tools/thu_agent.py）与 JS `sm-crypto`
  已交叉验证互通；JS 侧统一用 `sm-crypto`（cipherMode=1）。
- 选课会话流：login（出 cookies）→ 2FA（wx|sms 发码 / 校验 / trust=1 信任设备）
  → selected / queue(候补) / program / catalog，cookies 以 JSON 字符串跨段共享。

## 6. 凭证与授权系统的保存

- **绝不明文落盘密码**（默认只存会话）。持久化结构 `SessionData`：
  `{ username, fingerprint, cookiesJson, learnCsrf?, savedAt }`
- 存储 IO 抽象为 `CredentialStore` 接口：
  - Web 预览：`LocalStorageCredentialStore`
  - Tauri 桌面：接系统钥匙串（stronghold / keyring 插件）——待接
  - RN 移动端：Keychain / Keystore ——待接
- 会话过期自动重登录：HttpClient 捕获 `AuthRequiredError` → 用 CredentialProvider 重放原请求。

## 7. 端点速查（其他系统，未整合，结论先存档）

- 饭卡：`card.tsinghua.edu.cn`（getUserInfoFromToken / querySelfTradeList / moblieRecharge）
- 宿舍电费：`weixin_user_authenticate.aspx` 链（独立宿舍密码）+ `Netweb_Home_electricity_Detail.aspx`
- 图书馆：`catalog.tsinghua.edu.cn`（thu-info-lib reserves-lib.ts 有验证过的实现）
- 体育场馆：`77726476706e69737468656265737421a5a7.../gymbook/gymBookAction.do`（WebVPN 硬编码时代样本）
- 应用侧服务：`app.cs.tsinghua.edu.cn/api/*`（公告/校历/二维码/版本）
- 校内 GitLab：`git.tsinghua.edu.cn/api/v4`（thuid OAuth）
