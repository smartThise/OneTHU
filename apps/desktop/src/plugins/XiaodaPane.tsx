/**
 * 清小搭小窗（OH 胶囊三态之一：搜索 / OH / 清小搭）—— 2026-10-15。
 *
 * 定位与红线（用户 2026-10-15 口径）：
 *  - **只开新的默认对话**：小窗里不提供历史浏览、不接续既有对话
 *    （要接着聊请到一级功能页「清小搭」→ 历史 → 接着聊）；
 *  - 窗内必须明确标注：清小搭功能仅供实验与参考，无法取代 OneTHU Harness 的作用，也无法调度 OH 功能；
 *  - 与 OH 完全隔离：不读 Harness 会话、不注册工具、不写任何 OH 状态；输入口沿用胶囊（本窗只出发送钮）。
 * 协议：GET /api/conversation/create → POST /api/chats/ 原生 SSE（core/xiaoda/client.ts）。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Avatar, Banner, Btn, Inline, Spinner, Stack, Surface, Text } from "@onethu/gui";
import type { XiaodaChatMessage } from "@onethu/core";
import { xiaodaClient, xiaodaEnsureLogin } from "../lib/xiaoda.js";
import {
  dockInputSnapshot, registerXiaodaSubmit, setDockInputValue, subscribeDockInput,
} from "./ChatDock.js";
import { t as i18n } from "../i18n/index.js";


/** 平台默认助手（清小搭本体）；小窗不提供换智能体，故只有这一个 */
const AGENT_ID = "9999";
const AGENT_NAME = "清小搭";
/** 窗内标注（用户指定口径，逐字照录） */
const DISCLAIMER = "清小搭功能仅供实验与参考：无法取代 OneTHU Harness 的作用，也无法调度 OH 功能。";

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function XiaodaPane({ onNotice }: { onNotice?: (s: string) => void }): ReactNode {
  const [phase, setPhase] = useState<"boot" | "ready" | "error">("boot");
  const [err, setErr] = useState("");
  const [msgs, setMsgs] = useState<XiaodaChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const draft = useSyncExternalStore(subscribeDockInput, dockInputSnapshot, dockInputSnapshot);
  const convIdRef = useRef("");
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  /** 内容滚动容器（把「发送」钉在窗底，消息区自己滚） */
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* 进窗即备好登录状态（与一级页共用 lib/xiaoda.ts 的同一份登录状态） */
  useEffect(() => {
    let alive = true;
    setPhase("boot");
    xiaodaEnsureLogin()
      .then(() => {
        if (alive) setPhase("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setErr(errText(e));
        setPhase("error");
      });
    return () => {
      alive = false;
    };
  }, []);

  const bubble = (partial: Partial<XiaodaChatMessage>): XiaodaChatMessage => ({
    id: "", role: "assistant", content: "", thinkContent: "", agentId: AGENT_ID, agentName: AGENT_NAME, agentIcon: "",
    ...partial,
  });

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || sending) return;
      if (phase !== "ready") {
        onNotice?.(phase === "boot" ? "清小搭还在准备，稍等一下" : `清小搭暂时不可用：${err}`);
        return;
      }
      setMsgs((prev) => [...prev, bubble({ role: "user", content: q, agentName: "我" }), bubble({})]);
      setDockInputValue("");
      setSending(true);
      setErr("");
      stopRef.current = false;
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        /* 只开新对话：小窗内第一次发送时向后端申请对话号，之后沿用 */
        if (!convIdRef.current) {
          const cid = await xiaodaClient.createConversation();
          if (!cid) throw new Error("新建对话失败，请再发一次重试");
          convIdRef.current = cid;
        }
        await xiaodaClient.chatNative({
          agentId: AGENT_ID,
          query: q,
          convId: convIdRef.current,
          signal: ac.signal,
          onDelta: (d) => {
            if (stopRef.current) return;
            setMsgs((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (last && last.role === "assistant") next[next.length - 1] = { ...last, content: last.content + d };
              return next;
            });
          },
        });
      } catch (e) {
        setErr(errText(e));
        setMsgs((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last && last.role === "assistant" && !last.content) next.pop();
          return next;
        });
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [sending, phase, err, onNotice],
  );

  /* 胶囊输入框回车 → 交给本窗（与 OH 的发送互不干扰） */
  useEffect(() => {
    registerXiaodaSubmit((t) => void send(t));
    return () => registerXiaodaSubmit(null);
  }, [send]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [msgs.length, sending]);

  const stop = useCallback(() => {
    stopRef.current = true;
    abortRef.current?.abort();
    if (convIdRef.current) void xiaodaClient.stopChat(convIdRef.current);
  }, []);

  return (
    /* 内容根沿用面板既有契约类 .ohx-searchpane（flex:1 + min-height:0 + 内边距/gap）：
       不这样，面板顶置时的把手（flex order 10）会跟着短内容停在窗中间，内容也挤在左上角。
       内层再套一个自己滚动的区，把「发送」一行钉在窗底。 */
    <div className="ohx-searchpane">
      <div
        ref={scrollRef}
        style={{
          /* 与 OH 消息区（matMsgs）同一套布局契约：吃掉剩余高度、自己滚、touch 行为一致 */
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overscrollBehavior: "contain",
          touchAction: "pan-y",
          display: "flex",
          flexDirection: "column",
          gap: "var(--og-space-3)",
        }}
      >
      <Banner tone="warning" title={i18n("auto.plugins.XiaodaPane.1")}>
        {DISCLAIMER}
      </Banner>
      {phase === "boot" ? (
        <Inline gap={2}>
          <Spinner size="sm" />
          <Text slot="label" tone="faint">
            {i18n("auto.plugins.XiaodaPane.2")}</Text>
        </Inline>
      ) : null}
      {phase === "error" ? (
        <Banner tone="error" title={i18n("auto.plugins.XiaodaPane.3")}>
          {err}
        </Banner>
      ) : null}
      {phase === "ready" && msgs.length === 0 ? (
        <Text slot="label" tone="quiet">
          {i18n("auto.plugins.XiaodaPane.4")}</Text>
      ) : null}
      {msgs.map((m, i) => {
        const isUser = m.role === "user";
        const name = isUser ? "我" : AGENT_NAME;
        const waiting = !isUser && !m.content && sending && i === msgs.length - 1;
        return (
          <Inline key={m.id || `x${i}`} gap={3} vAlign="start" justify={isUser ? "end" : "start"}>
            {!isUser ? <Avatar name={name} size="sm" /> : null}
            <Stack gap={2} align={isUser ? "end" : "start"}>
              <Text slot="micro" tone="faint">
                {name}
              </Text>
              <Surface level={isUser ? 3 : 2} pad="lg" radius="2xl">
                <Stack gap={2}>
                  {m.content ? <Text as="p">{m.content}</Text> : null}
                  {waiting ? (
                    <Inline gap={2}>
                      <Spinner size="sm" />
                      <Text slot="label" tone="faint">
                        {i18n("auto.plugins.XiaodaPane.5")}</Text>
                    </Inline>
                  ) : null}
                </Stack>
              </Surface>
            </Stack>
            {isUser ? <Avatar name={name} size="sm" /> : null}
          </Inline>
        );
      })}
      <div ref={bottomRef} />
      </div>
      {err && phase === "ready" ? (
        <Banner tone="error" title={i18n("auto.plugins.XiaodaPane.6")}>
          {err}
        </Banner>
      ) : null}
      <Inline gap={2}>
        <Btn variant="solid" size="sm" disabled={phase !== "ready" || sending || !draft.trim()} onClick={() => void send(draft)}>
          {i18n("auto.plugins.XiaodaPane.7")}</Btn>
        {sending ? (
          <Btn variant="outline" size="sm" onClick={stop}>
            {i18n("auto.plugins.XiaodaPane.8")}</Btn>
        ) : null}
      </Inline>
    </div>
  );
}
