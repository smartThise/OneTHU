/** 讨论区（learnX bbs_tltb）：课程详情「讨论区」tab 列表 + 话题阅读/回复页。
 *  2026-09 逆向自 讨论区示例/learn.tsinghua.edu.cn.har（viewTlById 页 + pageViewTlById 分页 JSON
 *  + saveEdit 回帖表单）。列表页站点为服务端渲染，解析宽容（标题必有，作者/回复数尽力）。
 *  发新话题的表单 schema 未采样（仅知入口 beforeEditTl），站外浏览器完成，回 App 刷新可见。 */
import { useCallback, useEffect, useState } from "react";
import type { LearnBbsBoard, LearnBbsPost, LearnBbsThreadDetail, LearnBbsThreadSummary } from "@onethu/core";
import { learnUrls } from "@onethu/core";
import { Card, Empty, ErrorNote, PageHead, SkeletonRows } from "../../components/Layout.js";
import { IconDownload, IconRefresh } from "../../components/Icons.js";
import { learn, downloadLearnUrl } from "../../lib/clients.js";
import { explainNetworkError } from "../../lib/transport.js";
import { useApp } from "../../state/context.js";
import { BackButton, RichContent, fmtDateTime } from "./shared.js";
import { openExternal } from "../info/openExternal.js";

/* ══════════ 列表（课程详情 → 讨论区 tab） ══════════ */

type BbsKind = "yb" | "jh" | "cy";

const KINDS: Array<{ key: BbsKind; label: string }> = [
  { key: "yb", label: "全部" },
  { key: "jh", label: "精华" },
  { key: "cy", label: "参与" },
];

export function BbsPanel({ courseId }: { courseId: string }) {
  const { status, navigate } = useApp();
  const [boards, setBoards] = useState<LearnBbsBoard[]>([]);
  const [bqid, setBqid] = useState<string>("INITTL152189643"); // 站点默认板
  const [kind, setKind] = useState<BbsKind>("yb");
  const [threads, setThreads] = useState<LearnBbsThreadSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const [dbgMsg, setDbgMsg] = useState("");

  const PAGE = 30; // 站点 aLengthMenu 同款

  const load = useCallback(
    (append: boolean, start: number) => {
      if (!courseId || status === "demo") {
        if (status === "demo") {
          setBoards([{ bqid: "demo", name: "课程讨论" }]);
          setThreads(DEMO_THREADS(courseId));
          setTotal(3);
          setState("ready");
        }
        return;
      }
      setState("loading");
      setError("");
      const boardsP =
        start === 0
          ? learn.getBbsBoards(courseId).catch(() => [] as LearnBbsBoard[]) // 板块失败不挡列表
          : Promise.resolve(null);
      void Promise.all([boardsP, learn.getBbsThreads(courseId, { bqid, kind, start, length: PAGE })])
        .then(([b, r]) => {
          if (b && b.length > 0) {
            setBoards(b);
            // 默认板 INITTL… 不在站点返回的板块里 → 自动落到第一块（线程挂真实板块下）
            if (!b.some((x) => x.bqid === bqid)) setBqid(b[0]!.bqid);
          }
          setThreads((old) => (append && old ? [...old, ...r.threads] : r.threads));
          setTotal(r.total);
          setState("ready");
        })
        .catch((e: unknown) => {
          setError(explainNetworkError(e));
          setState("error");
        });
    },
    [courseId, bqid, kind, status],
  );

  useEffect(() => {
    load(false, 0);
  }, [load, nonce]);

  const reset = (fn: () => void) => {
    fn();
    setThreads(null);
    setTotal(0);
    setNonce((n) => n + 1);
  };

  return (
    <>
      <PageHead title="讨论区" meta="课程讨论与答疑（实名制）" />
      {boards.length > 1 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
          {boards.map((b) => (
            <button
              key={b.bqid}
              className={"chip" + (bqid === b.bqid ? " chip-blue" : "")}
              onClick={() => reset(() => setBqid(b.bqid))}
            >
              {b.name}
            </button>
          ))}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        {KINDS.map((k) => (
          <button
            key={k.key}
            className={"chip" + (kind === k.key ? " chip-blue" : "")}
            onClick={() => reset(() => setKind(k.key))}
          >
            {k.label}
          </button>
        ))}
        <span style={{ flex: "1 1 auto" }} />
        <button className="btn" onClick={() => reset(() => undefined)} aria-label="刷新讨论列表">
          <IconRefresh />
        </button>
        {status !== "demo" ? (
          <button className="btn" onClick={() => void openExternal(learnUrls.LEARN_BBS_NEW_THREAD_PAGE(courseId))}>
            发新话题
          </button>
        ) : null}
      </div>
      <Card>
        <div className="row-sub">
          讨论、答疑均记录实名日志，请文明发言{total > 0 ? ` · 共 ${total} 条` : ""}
        </div>
      </Card>
      {state === "loading" && threads === null ? (
        <Card>
          <SkeletonRows rows={4} />
        </Card>
      ) : state === "error" && threads === null ? (
        <Card>
          <ErrorNote text={error} onRetry={() => reset(() => undefined)} />
        </Card>
      ) : (threads?.length ?? 0) === 0 ? (
        <Card>
          <Empty text="本板块暂无讨论" />
          {status !== "demo" && learn.lastBbsListDebug ? (
            <div style={{ marginTop: 10 }}>
              <button
                className="btn"
                onClick={() => {
                  const t = learn.lastBbsListDebug;
                  navigator.clipboard?.writeText(t).then(
                    () => setDbgMsg("诊断信息已复制，发给开发者即可修复解析"),
                    () => setDbgMsg(t.slice(0, 600)),
                  );
                }}
              >
                复制诊断信息
              </button>
              {dbgMsg ? (
                <div className="row-sub" style={{ marginTop: 6, wordBreak: "break-all" }}>
                  {dbgMsg}
                </div>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : (
        <Card>
          {(threads ?? []).map((t) => (
            <div
              key={t.id}
              className="row row-click"
              role="button"
              tabIndex={0}
              onClick={() => navigate("learn-forum-thread", { courseId, itemId: t.id })}
              onKeyDown={(e) => e.key === "Enter" && navigate("learn-forum-thread", { courseId, itemId: t.id })}
            >
              <div style={{ minWidth: 0, flex: "1 1 auto" }}>
                <div className="tl-title" style={{ whiteSpace: "normal" }}>
                  {t.pinned ? <Badge text="置顶" tone="red" /> : null}
                  {t.essence ? <Badge text="精华" tone="gold" /> : null}
                  {t.title}
                </div>
                <div className="tl-sub" style={{ whiteSpace: "normal" }}>
                  {[t.author, fmtDateTime(t.time)].filter(Boolean).join(" · ")}
                  {t.replies > 0 ? ` · ${t.replies} 回复` : ""}
                </div>
              </div>
              <svg className="row-caret" width="14" height="14" viewBox="0 0 16 16" aria-hidden>
                <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </div>
          ))}
          {threads && threads.length < total ? (
            <button
              className="btn"
              style={{ width: "100%", marginTop: 10 }}
              disabled={state === "loading"}
              onClick={() => load(true, threads!.length)}
            >
              {state === "loading" ? "加载中…" : `加载更多（已显示 ${threads!.length}/${total}）`}
            </button>
          ) : null}
        </Card>
      )}
    </>
  );
}

function Badge({ text, tone }: { text: string; tone: "red" | "gold" }) {
  const color = tone === "red" ? "#d24545" : "#a8842c";
  return (
    <span
      style={{
        display: "inline-block",
        margin: "0 6px -1px 0",
        padding: "1px 6px",
        borderRadius: 6,
        fontSize: 11,
        lineHeight: "16px",
        color,
        border: `1px solid ${color}`,
      }}
    >
      {text}
    </span>
  );
}

/* ══════════ 话题阅读 + 回复 ══════════ */

export function ForumThreadPage() {
  const { navParams, status } = useApp();
  const courseId = navParams?.courseId ?? "";
  const threadId = navParams?.itemId ?? "";

  const [head, setHead] = useState<LearnBbsThreadDetail | null>(null);
  const [posts, setPosts] = useState<LearnBbsPost[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  const [replyTo, setReplyTo] = useState<{ hhid: string; author: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [dlHint, setDlHint] = useState("");
  const [dbgMsg, setDbgMsg] = useState("");

  const load = useCallback(() => {
    if (!courseId || !threadId) return;
    setState("loading");
    setError("");
    if (status === "demo") {
      setHead(DEMO_HEAD(threadId));
      setPosts(DEMO_POSTS());
      setHasMore(false);
      setState("ready");
      return;
    }
    learn
      .getBbsThread(courseId, threadId)
      .then((h) => {
        setHead(h);
        setPosts(h.posts); // 首屏回复在 viewTlById HTML 里服务端渲染
        setPage(0); // 0 = 已消费 HTML 首屏；ajax 分页从 1 起
        setHasMore(h.posts.length < h.replyCount);
        setState("ready");
      })
      .catch((e: unknown) => {
        setError(explainNetworkError(e));
        setState("error");
      });
  }, [courseId, threadId, status]);

  useEffect(() => {
    load();
  }, [load, nonce]);

  const loadMore = () => {
    if (status === "demo") return;
    const next = page + 1; // ajax 分页页码从 1 起（0 是服务端渲染首屏，接口无效页）
    learn
      .getBbsThreadPosts(courseId, threadId, next)
      .then((p) => {
        setPosts((old) => [...old, ...p]);
        setPage(next);
        setHasMore(p.length > 0 && posts.length + p.length < (head?.replyCount ?? 0));
      })
      .catch((e: unknown) => setError(explainNetworkError(e)));
  };

  const send = () => {
    const nr = draft.trim();
    if (!nr || sending) return;
    setSending(true);
    setSendMsg("");
    learn
      .postBbsReply(courseId, threadId, nr, replyTo?.hhid)
      .then(() => {
        setDraft("");
        setReplyTo(null);
        setSendMsg("已发表");
        setNonce((n) => n + 1); // 重拉话题与首屏回复
      })
      .catch((e: unknown) => setSendMsg(explainNetworkError(e)))
      .finally(() => setSending(false));
  };

  const downloadAtt = (wjid: string, wjmc: string) => {
    if (status === "demo") return;
    setDlHint(`下载 ${wjmc}…`);
    downloadLearnUrl(learnUrls.LEARN_BBS_ATTACHMENT(courseId, wjid), wjmc)
      .then((p) => setDlHint(`已保存：${p}`))
      .catch((e: unknown) => setDlHint(explainNetworkError(e)));
  };

  return (
    <>
      <BackButton to="learn-course" courseId={courseId} label="返回课程" />
      {state === "loading" && !head ? (
        <Card>
          <SkeletonRows rows={5} />
        </Card>
      ) : state === "error" && !head ? (
        <Card>
          <ErrorNote text={error} onRetry={() => setNonce((n) => n + 1)} />
        </Card>
      ) : head ? (
        <>
          <PageHead title={head.title} meta={[head.author, fmtDateTime(head.time)].filter(Boolean).join(" · ")} />
          <Card>
            <RichContent html={head.html} />
            {!head.html && !head.author ? (
              <div className="row-sub" style={{ marginTop: 8 }}>
                正文解析为空（结构异常）——点下方「复制诊断」把服务器原话发给开发者
              </div>
            ) : null}
          </Card>
          <div className="nav-label" style={{ margin: "14px 0 8px" }}>
            回复 · {head.replyCount}
          </div>
          {state === "loading" ? (
            <Card>
              <SkeletonRows rows={3} />
            </Card>
          ) : posts.length === 0 ? (
            <Card>
              <Empty text="还没有回复，抢个沙发" />
              {status !== "demo" && (learn.lastBbsThreadDebug || learn.lastBbsListDebug) ? (
                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn"
                    onClick={() => {
                      const t = learn.lastBbsThreadDebug || learn.lastBbsListDebug;
                      navigator.clipboard?.writeText(t).then(
                        () => setDbgMsg("诊断信息已复制"),
                        () => setDbgMsg(t.slice(0, 600)),
                      );
                    }}
                  >
                    复制诊断信息
                  </button>
                  {dbgMsg ? (
                    <div className="row-sub" style={{ marginTop: 6, wordBreak: "break-all" }}>
                      {dbgMsg}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>
          ) : (
            posts.map((p) => (
              <PostBlock key={p.hhid} post={p} onReply={setReplyTo} onDownload={downloadAtt} />
            ))
          )}
          {hasMore ? (
            <Card>
              <button className="btn" style={{ width: "100%" }} onClick={loadMore}>
                加载更多回复
              </button>
            </Card>
          ) : null}
          {error && head ? (
            <Card>
              <ErrorNote text={error} />
            </Card>
          ) : null}

          <Card>
            {replyTo ? (
              <div className="setting-row" style={{ marginBottom: 8 }}>
                <div className="row-sub">回复 @{replyTo.author || replyTo.hhid}</div>
                <button className="btn" onClick={() => setReplyTo(null)}>
                  取消
                </button>
              </div>
            ) : null}
            <textarea
              className="input"
              style={{ width: "100%", minHeight: 84, resize: "vertical" }}
              placeholder="文明发言（实名制，站点留有日志）…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <button className="btn" disabled={sending || !draft.trim()} onClick={send}>
                {sending ? "发表中…" : "发表回复"}
              </button>
              {sendMsg ? <span className="row-sub">{sendMsg}</span> : null}
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}

function PostBlock({
  post,
  onReply,
  onDownload,
}: {
  post: LearnBbsPost;
  onReply: (t: { hhid: string; author: string }) => void;
  onDownload: (wjid: string, wjmc: string) => void;
}) {
  return (
    <Card>
      <div className="setting-row" style={{ alignItems: "flex-start" }}>
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div className="setting-title" style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            {post.author || "匿名"}
            <span className="row-sub" style={{ fontWeight: 400 }}>
              {fmtDateTime(post.time)}
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <RichContent html={post.html} />
          </div>
          {post.attachments.length > 0 ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
              {post.attachments.map((a) => (
                <button key={a.wjid} className="btn" onClick={() => onDownload(a.wjid, a.wjmc)}>
                  <IconDownload /> {a.wjmc}
                </button>
              ))}
            </div>
          ) : null}
          {post.children.length > 0 ? (
            <div
              style={{
                margin: "10px 0 0 14px",
                borderLeft: "2px solid var(--border, rgba(0,0,0,.1))",
                paddingLeft: 12,
              }}
            >
              {post.children.map((c) => (
                <PostBlock key={c.hhid} post={c} onReply={onReply} onDownload={onDownload} />
              ))}
            </div>
          ) : null}
        </div>
        <button className="btn" onClick={() => onReply({ hhid: post.hhid, author: post.author })}>
          回复
        </button>
      </div>
    </Card>
  );
}

/* ══════════ 演示数据 ══════════ */

function DEMO_THREADS(courseId: string): LearnBbsThreadSummary[] {
  return [
    { id: "demo-tl-1", title: "Agent选题：艰难的实验设计辅助agent", author: "黄梓安", time: "2026-08-31 16:44", replies: 4, essence: true, pinned: false },
    { id: "demo-tl-2", title: "关于作业 3 中 DAG 最短路的一个疑问", author: "顾晓", time: "2026-09-01 20:15", replies: 1, essence: false, pinned: false },
    { id: "demo-tl-3", title: "课程项目分组求助（缺 1 人）", author: "王同学", time: "2026-09-01 15:43", replies: 0, essence: false, pinned: true },
  ].map((t) => ({ ...t, id: `${courseId}#${t.id}` }));
}

function DEMO_HEAD(threadId: string): LearnBbsThreadDetail {
  return {
    id: threadId,
    title: "Agent选题：艰难的实验设计辅助agent",
    author: "黄梓安",
    time: "2026-08-31 16:44",
    html: "<p><b>问题背景</b></p><p>选题灵感来源于一个刚入门的科研菜菜：从模糊的 idea 到可复现的实验结果之间有很大 gap，需要反复试错、与 agent 频繁交互调整来填平。（演示数据）</p>",
    posts: [],
    replyCount: 4,
    tabbh: "2",
    tabid: "demo",
    bqid: "demo",
  };
}

function DEMO_POSTS(): LearnBbsPost[] {
  return [
    {
      hhid: "153664138",
      author: "顾晓",
      time: "2026-08-31 17:47",
      html: "<p>同感。我在想能不能把「实验设计」拆成假设生成 / 变量选择 / 指标定义三段分别给反馈。</p>",
      attachments: [],
      children: [
        {
          hhid: "153666500",
          author: "黄梓安",
          time: "2026-09-01 20:15",
          html: "<p>可以，我下周整理一版拆解模板贴出来。（演示数据）</p>",
          attachments: [],
          children: [],
        },
      ],
    },
    {
      hhid: "153667329",
      author: "李同学",
      time: "2026-09-01 20:15",
      html: "<p>求组队！我对 RL 方向的自动调参也很感兴趣。</p>",
      attachments: [],
      children: [],
    },
  ];
}
