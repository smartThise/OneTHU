//! 清华邮箱（IMAP 收 / SMTP 发）—— 复用云日历的邮箱 + 授权码。
//!
//! 服务器（learnX 同款）：
//! - IMAP: mails.tsinghua.edu.cn:993 (implicit TLS)
//! - SMTP: smtp.tsinghua.edu.cn:465  (implicit TLS)
//!
//! 会话策略：每条命令独立连接（IMAP 会话短命干净，学生量级毫秒级握手成本），
//! 不在 Rust 侧持有任何登录态。

use serde::{Deserialize, Serialize};

const IMAP_HOST: &str = "mails.tsinghua.edu.cn";
const SMTP_HOST: &str = "smtp.tsinghua.edu.cn";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailListOut {
    /// 文件夹总封数（分页头「已显示 X / 共 Y 封」用）
    pub total: u32,
    /// 本批最小序列号（下一页 beforeSeq；到 1 即到底）
    pub min_seq: u32,
    pub heads: Vec<MailHead>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailHead {
    pub uid: u32,
    pub subject: String,
    pub from: String,
    pub date_ms: i64,
    pub seen: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailBody {
    pub subject: String,
    pub from: String,
    pub to: String,
    pub date_ms: i64,
    pub text: String,
    pub html: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendArgs {
    pub email: String,
    pub auth: String,
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    pub subject: String,
    pub body: String,
}

type ImapSession = imap::Session<rustls_connector::TlsStream<std::net::TcpStream>>;

fn imap_connect(email: &str, auth: &str) -> Result<ImapSession, String> {
    let stream = std::net::TcpStream::connect((IMAP_HOST, 993)).map_err(|e| format!("无法连接邮箱服务器：{}", e))?;
    stream.set_read_timeout(Some(std::time::Duration::from_secs(30))).ok();
    stream.set_write_timeout(Some(std::time::Duration::from_secs(30))).ok();
    let tls = rustls_connector::RustlsConnectorConfig::new_with_webpki_root_certs()   // 0.23：roots_certs→root_certs，connect 配置不再可失败
        .connector_with_no_client_auth()
        .map_err(|e| format!("TLS 初始化失败：{}", e))?;
    let stream = tls.connect(IMAP_HOST, stream).map_err(|e| format!("TLS 握手失败：{}", e))?;
    let client = imap::Client::new(stream);
    client.login(email, auth).map_err(|(e, _)| format!("登录失败（检查邮箱与授权码）：{}", tidy_imap_err(&e)))
}

/** Address 枚举 → 第一个 Addr（List/Group 两形态） */
fn first_addr<'a>(a: Option<&'a mail_parser::Address<'a>>) -> Option<&'a mail_parser::Addr<'a>> {
    match a? {
        mail_parser::Address::List(v) => v.first(),
        mail_parser::Address::Group(g) => g.first().map(|g| &g.addresses[0] as &mail_parser::Addr).or(None).or_else(|| None),
    }
}

/** 解析头部字节 →（主题、发件人、日期 ms）；mail-parser 统一处理编码字 */
fn parse_head(raw: &[u8]) -> (String, String, i64) {
    let Some(msg) = mail_parser::MessageParser::default().parse(raw) else {
        return ("(无法解析)".into(), String::new(), 0);
    };
    let subject = msg.subject().unwrap_or("(无主题)").trim().to_string();
    let from = first_addr(msg.from())
        .map(|a| match (&a.name, &a.address) {
            (Some(n), Some(addr)) if !n.is_empty() => format!("{} <{}>", n, addr),
            (_, Some(addr)) => addr.to_string(),
            _ => String::new(),
        })
        .unwrap_or_default();
    let date_ms = msg.date().map(|d| d.to_timestamp() * 1000).unwrap_or(0);
    (subject, from, date_ms)
}

/// 收件列表（最新 limit 封，只取头 + 已读标记；不动服务器状态）
#[tauri::command]
pub fn mail_list(email: String, auth: String, folder: String, limit: u32, before_seq: Option<u32>) -> Result<MailListOut, String> {
    let mut sess = imap_connect(&email, &auth)?;
    let total = sess
        .select(&folder)
        .map_err(|e| format!("打开「{}」失败：{}", folder, tidy_imap_err(&e)))?
        .exists;
    let (heads, min_seq) = if total == 0 {
        (Vec::new(), 0)
    } else {
        // 分页：不带 beforeSeq = 最新一页；带 = 该序列号之前的更旧一页
        let (from_seq, to_seq) = match before_seq {
            Some(b) if b >= 1 => (b.saturating_sub(limit).max(1), b - 1),
            _ => (total.saturating_sub(limit).max(1), total),
        };
        let range = if to_seq < from_seq { "1:1".to_string() } else { format!("{}:{}", from_seq, to_seq) };
        let fetches = sess
            .fetch(&range, "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
            .map_err(|e| format!("拉取失败：{}", tidy_imap_err(&e)))?;
        let mut out: Vec<MailHead> = fetches
            .iter()
            .filter_map(|f| {
                let uid = f.uid?;
                let (subject, from, date_ms) = parse_head(f.header()?);
                let seen = f.flags().iter().any(|fl| matches!(fl, imap::types::Flag::Seen));
                Some(MailHead { uid, subject, from, date_ms, seen })
            })
            .collect();
        // 服务器按 seq 升序给：翻成最新在前
        out.reverse();
        (out, from_seq)
    };
    sess.logout().ok();
    Ok(MailListOut { total, min_seq, heads })
}

/// 全箱搜索（主题 OR 发件人；返回最新在前，最多 limit 封）
#[tauri::command]
pub fn mail_search(email: String, auth: String, folder: String, query: String, limit: u32) -> Result<Vec<MailHead>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // IMAP 字符串字面量转义（引号/反斜杠），拼 OR 查询
    let esc = q.replace("\\", "\\\\").replace("\"", "\\\"");
    let criteria = format!("OR SUBJECT \"{}\" FROM \"{}\"", esc, esc);
    let mut sess = imap_connect(&email, &auth)?;
    sess.select(&folder).map_err(|e| format!("打开「{}」失败：{}", folder, tidy_imap_err(&e)))?;
    let uids = sess
        .uid_search(&criteria)
        .map_err(|e| format!("搜索失败：{}", tidy_imap_err(&e)))?;
    let mut heads: Vec<MailHead> = Vec::new();
    if !uids.is_empty() {
        let mut sorted: Vec<u32> = uids.into_iter().collect();
        sorted.sort_unstable();
        let from = sorted.len().saturating_sub(limit as usize);
        let set: Vec<String> = sorted[from..].iter().map(|u| u.to_string()).collect();
        let fetches = sess
            .uid_fetch(set.join(","), "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
            .map_err(|e| format!("拉取失败：{}", tidy_imap_err(&e)))?;
        for f in fetches.iter() {
            let Some(uid) = f.uid else { continue };
            let Some(raw) = f.header() else { continue };
            let (subject, from, date_ms) = parse_head(raw);
            let seen = f.flags().iter().any(|fl| matches!(fl, imap::types::Flag::Seen));
            heads.push(MailHead { uid, subject, from, date_ms, seen });
        }
        heads.reverse(); // uid 降序 = 最新在前
    }
    sess.logout().ok();
    Ok(heads)
}

/// 读一封（UID 定位；text/html 分开给，前端优先文本后 iframe 沙箱渲染）
#[tauri::command]
pub fn mail_read(email: String, auth: String, folder: String, uid: u32) -> Result<MailBody, String> {
    let mut sess = imap_connect(&email, &auth)?;
    let _ = sess
        .select(&folder)
        .map_err(|e| format!("打开「{}」失败：{}", folder, tidy_imap_err(&e)))?;
    let fetches = sess
        .uid_fetch(uid.to_string(), "(BODY.PEEK[])")
        .map_err(|e| format!("读取失败：{}", tidy_imap_err(&e)))?;
    let raw = fetches
        .iter()
        .find_map(|f| f.body().map(|b| b.to_vec()))
        .ok_or("邮件不存在（可能已被移动或删除）")?;
    let Some(msg) = mail_parser::MessageParser::default().parse(&raw) else {
        return Err("邮件解析失败".into());
    };
    let subject = msg.subject().unwrap_or("(无主题)").trim().to_string();
    let from = first_addr(msg.from())
        .and_then(|a| a.address.clone())
        .map(|s| s.to_string())
        .unwrap_or_default();
    let to = match msg.to() {
        Some(mail_parser::Address::List(v)) => v.iter().filter_map(|x| x.address.clone()).collect::<Vec<_>>().join(", "),
        _ => String::new(),
    };
    let date_ms = msg.date().map(|d| d.to_timestamp() * 1000).unwrap_or(0);
    // 文本体：优先 text/plain，退而求其次从 text/html 剥标签
    let text = msg
        .body_text(0)
        .map(|s| s.to_string())
        .unwrap_or_default();
    let html = msg
        .body_html(0)
        .map(|s| s.to_string());
    let text = if text.is_empty() && html.is_some() {
        strip_html(html.as_deref().unwrap_or(""))
    } else {
        text
    };
    sess.logout().ok();
    Ok(MailBody { subject, from, to, date_ms, text, html })
}

/// 标记已读（读信的伴随动作；单独命令便于失败静默重试）
#[tauri::command]
pub fn mail_mark_seen(email: String, auth: String, folder: String, uid: u32) -> Result<(), String> {
    let mut sess = imap_connect(&email, &auth)?;
    sess.select(&folder).map_err(|e| tidy_imap_err(&e).to_string())?;
    sess.uid_store(uid.to_string(), "+FLAGS (\\Seen)").map_err(|e| tidy_imap_err(&e).to_string())?;
    sess.logout().ok();
    Ok(())
}

/// 发信（SMTP 465 implicit TLS）
#[tauri::command]
pub fn mail_send(args: SendArgs) -> Result<(), String> {
    use lettre::message::header::ContentType;
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Message, SmtpTransport, Transport};

    let mut builder = Message::builder().from(
        args.email
            .parse()
            .map_err(|_| "发件人地址不合法".to_string())?,
    );
    for t in &args.to {
        builder = builder.to(t.parse().map_err(|_| format!("收件人不合法：{}", t))?);
    }
    for c in &args.cc {
        builder = builder.cc(c.parse().map_err(|_| format!("抄送不合法：{}", c))?);
    }
    let mail = builder
        .subject(&args.subject)
        .header(ContentType::TEXT_PLAIN)
        .body(args.body.clone())
        .map_err(|e| format!("组装邮件失败：{}", e))?;

    let creds = Credentials::new(args.email.clone(), args.auth.clone());
    // 465 = implicit TLS（SmtpTransport::relay 是 587 STARTTLS 语义；relayed() 之后再
    // 明确 port(465) 会握手错误）——用 smtps 专用构造 + rustls
    let mailer = SmtpTransport::relay(SMTP_HOST)
        .map_err(|e| format!("SMTP 连接失败：{}", e))?
        .port(465)
        .credentials(creds)
        .build();
    mailer
        .send(&mail)
        .map_err(|e| format!("发送失败：{}", tidy_smtp_err(&e)))?;
    Ok(())
}

/** IMAP 错误降噪：把 Debug 恐怖输出收成人话 */
fn tidy_imap_err(e: &imap::error::Error) -> String {
    match e {
        imap::error::Error::Bad(s) | imap::error::Error::No(s) => s.clone(),
        imap::error::Error::ConnectionLost => "连接中断".into(),
        imap::error::Error::Io(e) => e.to_string(),
        other => format!("{}", other),
    }
}

fn tidy_smtp_err(e: &lettre::transport::smtp::Error) -> String {
    format!("{}", e)
}

/** 极简 HTML → 文本（仅 html-only 邮件兜底显示用） */
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            c if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_email() -> String {
        std::env::var("TSINGHUA_EMAIL").unwrap()
    }
    fn env_auth() -> String {
        std::env::var("TSINGHUA_AUTH").unwrap()
    }

    /// 真连测试：TSINGHUA_EMAIL + TSINGHUA_AUTH 环境变量给号才跑（--ignored）
    #[test]
    #[ignore]
    fn live_list_and_read() {
        let email = std::env::var("TSINGHUA_EMAIL").unwrap();
        let auth = std::env::var("TSINGHUA_AUTH").unwrap();
        let p1 = mail_list(email.clone(), auth.clone(), "INBOX".into(), 3, None).unwrap();
        assert!(!p1.heads.is_empty(), "收件箱几百封，至少 3 封");
        assert!(p1.total > 100, "总数应远超一页：{}", p1.total);
        for h in &p1.heads {
            println!("uid={} seen={} {} | {}", h.uid, h.seen, h.date_ms, h.subject);
            println!("  from: {}", h.from);
        }
        let p2 = mail_list(email.clone(), auth.clone(), "INBOX".into(), 3, Some(p1.min_seq)).unwrap();
        assert!(!p2.heads.is_empty() && p2.min_seq < p1.min_seq, "第二页应更旧且 min_seq 递减");
        println!("分页无缝：p1 头 uid={} p2 尾 uid={}（不同批）", p1.heads[0].uid, p2.heads.last().unwrap().uid);
        let heads = p1.heads.clone();
        let body = mail_read(email, auth, "INBOX".into(), heads[0].uid).unwrap();
        println!("首封正文前 200 字：{}", body.text.chars().take(200).collect::<String>());
        println!("html 部分：{}", body.html.is_some());
    }

    /// 38 封之谜：exists 总数 vs FETCH 返回条数 vs 可解析条数（--ignored）
    #[test]
    #[ignore]
    fn live_count() {
        let email = std::env::var("TSINGHUA_EMAIL").unwrap();
        let auth = std::env::var("TSINGHUA_AUTH").unwrap();
        let mut sess = imap_connect(&email, &auth).unwrap();
        let mb = sess.select("INBOX").unwrap();
        println!("EXISTS = {}", mb.exists);
        let total = mb.exists;
        let from_seq = total.saturating_sub(50) + 1;
        let fetches = sess.fetch(format!("{}:{}", from_seq, total), "(UID FLAGS BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])").unwrap();
        println!("fetch 返回 {} 条", fetches.len());
        let with_uid = fetches.iter().filter(|f| f.uid.is_some()).count();
        let with_header = fetches.iter().filter(|f| f.header().is_some()).count();
        println!("有 UID {} 条，有 header {} 条", with_uid, with_header);
        for f in fetches.iter().take(60) {
            if f.uid.is_none() || f.header().is_none() {
                println!("  丢失项: uid={:?} header={:?}", f.uid, f.header().map(|h| h.len()));
            }
        }
    }

    /// 全箱搜索（--ignored）：GitHub 通知必在收件箱
    #[test]
    #[ignore]
    fn live_search() {
        let email = std::env::var("TSINGHUA_EMAIL").unwrap();
        let auth = std::env::var("TSINGHUA_AUTH").unwrap();
        let heads = mail_search(email, auth, "INBOX".into(), "GitHub".into(), 10).unwrap();
        assert!(!heads.is_empty(), "收件箱应有 GitHub 通知");
        assert!(heads.len() <= 10);
        assert!(heads.iter().all(|h| h.subject.to_lowercase().contains("github") || h.from.to_lowercase().contains("github")));
        println!("搜索命中 {} 封，最新主题：{}", heads.len(), heads[0].subject);
        let empty = mail_search(env_email(), env_auth(), "INBOX".into(), "  ".into(), 10).unwrap();
        assert!(empty.is_empty());
    }

    /// 发给自己一封，然后列表 3 封里必须能找到它（--ignored；标题带时间戳防重复）
    #[test]
    #[ignore]
    fn live_send() {
        let email = std::env::var("TSINGHUA_EMAIL").unwrap();
        let auth = std::env::var("TSINGHUA_AUTH").unwrap();
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs();
        mail_send(SendArgs {
            email: email.clone(),
            auth: auth.clone(),
            to: vec![email.clone()],
            cc: vec![],
            subject: format!("OneTHU 邮箱链路自检 {}", stamp),
            body: "这是 OneTHU 邮箱 tab 的发送链路自检邮件，收到即忽略。".into(),
        })
        .unwrap();
        // 服务器入箱延迟不定（实测 1~20s）：轮询最多 20 秒找自己那封
        let mut arrived = false;
        for _ in 0..10 {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let heads = mail_list(email.clone(), auth.clone(), "INBOX".into(), 10, None).unwrap().heads;
            if heads.iter().any(|h| h.subject.contains(&format!("OneTHU 邮箱链路自检 {}", stamp))) {
                arrived = true;
                break;
            }
        }
        assert!(arrived, "发出的邮件 20 秒内未回到收件箱前 10（stamp={}）", stamp);
        println!("发送 OK 且已回到收件箱，stamp={}", stamp);
    }
}
