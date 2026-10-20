/**
 * 临时来访人员报备（预约页 · 来访报备栏）。
 *
 * 官方出处：行在清华小程序的「临时来访人员报备」入口 → visit.tsinghua.edu.cn/visitor/mobile
 * 里的「亲友来访报备」。本页把那份表单搬到应用内：登录用统一身份直连（与清小搭同一套凭据），
 * 表单结构、下拉选项、必填要求都以服务端下发的表单模型为准，不自己编。
 *
 * 三条守则：
 *  ① 提交是**真写**（校外人员据此可入校）：默认只有用户点「提交报备」并在确认框里再点一次才会发出；
 *     OH 默认只填草稿（见 state/visitDraft.ts）；用户显式要求「自动报备」时，OH 可带 submit 请求，
 *     本页在草稿填好后自动提交（2026-10-19 用户拍板）；OH 侧工具为 Harness 的 visit_fill。
 *  ② 样式零旁路：全部 @onethu/gui 组件 —— 无页面 CSS、无内联样式、无自造控件。
 *  ③ 卡片区只读官方：我的报备列表按服务端返回原样显示，不做状态文案推测。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  Banner, Btn, Card, Checkbox, Divider, EmptyState, Field, Inline, Input, Modal, NumberField,
  Row, Select, Stack, Text, TextArea,
} from "@onethu/gui";
import {
  VISIT_MOBILE_ENTRY, VISIT_REPORT_FLOW, VisitApiError, VisitAuthRequiredError, VisitLoginError,
  type VisitFormModel, type VisitOption, type VisitReportDraft, type VisitReportRow, type VisitVisitorInput,
} from "@onethu/core";
import { clearVisitDraft, peekVisitAutoSubmit, peekVisitDraft, subscribeVisitDraft, visitDraftVersion } from "../../state/visitDraft.js";
import { visitClient, visitEnsureLogin, visitHasSession } from "../../lib/visit.js";
import { logLine } from "../../lib/clients.js";
import { openExternal } from "./openExternal.js";
import { t as i18n } from "../../i18n/index.js";


const PAGE_HINT = "亲友来访报备与「我的报备」都在这里完成，数据直接送往学校来访报备系统。";
const LOGIN_HINT = "本页要用统一身份登录一次；本机记住过密码就会自动完成，不会再问密码。";
const LOGIN_HINT_2 = "没记住密码时，也可以先到官方页面登录一次，再回到这里刷新。";
const SUBMIT_HINT = "提交后学校系统会生成报备记录，来访亲友凭身份证件从所选校门入校。";
const DRAFT_FROM_OH = "已按你的说明填好草稿：核对后点「提交报备」。";
const AUTO_SUBMIT_FROM_OH = "已按你的要求填好并自动提交报备。";
const CONFIRM_TITLE = "确认提交这条报备？";
const LOAD_FAIL = "读取报备信息失败：请点「重新加载」再试一次。";
const SUBMIT_FAIL = "提交没有成功：请检查填写内容后重试，或到官方页面提交。";

type Phase = "need_login" | "loading" | "ready" | "error";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function prettyTime(raw: string): string {
  return raw.length >= 16 ? raw.slice(0, 16) : raw;
}
function emptyVisitor(): VisitVisitorInput {
  return { idCard: "", mobile: "" };
}
function emptyDraft(): VisitReportDraft {
  return { visitDate: today(), category: "2", reason: "5", visitors: [emptyVisitor()], confirmed: false };
}

export function VisitTab() {
  const [phase, setPhase] = useState<Phase>(() => (visitHasSession() ? "loading" : "need_login"));
  const [model, setModel] = useState<VisitFormModel | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, VisitOption[]>>({});
  const [rows, setRows] = useState<VisitReportRow[] | null>(null);
  const [mineNote, setMineNote] = useState<string | null>(null);
  const [form, setForm] = useState<VisitReportDraft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askSubmit, setAskSubmit] = useState(false);
  /** OH 请求了自动提交：等表单/模型就绪后直接走 submit()，不弹确认框 */
  const [autoSubmit, setAutoSubmit] = useState(false);

  /** OH 送来的草稿：只填不提交；勾选确认一律由用户自己完成 */
  const draftVersion = useSyncExternalStore(subscribeVisitDraft, visitDraftVersion);
  useEffect(() => {
    const patch = peekVisitDraft();
    const wantAuto = peekVisitAutoSubmit();
    if (!patch) return;
    setForm((f) => ({
      ...f,
      ...patch,
      /* 自动报备：勾选确认由系统代表用户完成（用户已显式要求自动提交） */
      confirmed: wantAuto ? true : false,
      visitors: patch.visitors?.length ? patch.visitors : f.visitors,
    }));
    setNote(wantAuto ? AUTO_SUBMIT_FROM_OH : DRAFT_FROM_OH);
    if (wantAuto) setAutoSubmit(true);
    clearVisitDraft();
  }, [draftVersion]);

  const load = useCallback(async (): Promise<void> => {
    setPhase("loading");
    setError(null);
    try {
      await visitEnsureLogin();
      const m = await visitClient.formModel(VISIT_REPORT_FLOW.formDid, {
        mBizId: VISIT_REPORT_FLOW.mBizId,
        pdid: VISIT_REPORT_FLOW.pdid,
        adid: VISIT_REPORT_FLOW.adid,
      });
      setModel(m);
      // 服务端预填值（preLoad 给的）优先：这几项官方页面也是预置好的，别让用户重挑一遍
      setForm((f) => ({
        ...f,
        category: m.prefilled.mfield1 ?? f.category,
        reason: m.prefilled.mfield16 ?? f.reason,
        area: m.prefilled.mfield13 ?? f.area,
      }));
      const wanted = [...m.fields, ...m.visitorFields].filter((f) => f.catalogId);
      const pairs = await Promise.all(
        wanted.map(async (f) => [f.key, await visitClient.catalogOptions(f.key, String(f.catalogId))] as const),
      );
      setCatalogs(Object.fromEntries(pairs));
      setPhase("ready");
      try {
        const mine = await visitClient.myReports();
        setRows(mine.rows);
      } catch (e) {
        setRows([]);
        setMineNote(`「我的报备」暂时读不到：${e instanceof Error ? e.message : "稍后再试"}。`);
      }
    } catch (e) {
      if (e instanceof VisitLoginError) {
        setPhase("need_login");
        setNote(e.message);
        return;
      }
      if (e instanceof VisitAuthRequiredError) {
        setPhase("need_login");
        setNote(e.message);
        return;
      }
      setPhase("error");
      setError(e instanceof VisitApiError ? e.message : LOAD_FAIL);
      void logLine(`[VISIT-TAB] 读取失败：${String(e)}`);
    }
  }, []);

  useEffect(() => {
    if (phase === "loading" && !model) void load();
  }, [phase, model, load]);

  const options = useMemo(() => ({
    category: catalogs.mfield1 ?? [],
    area: catalogs.mfield13 ?? [],
    reason: catalogs.mfield16 ?? [],
    personType: catalogs.mfield4 ?? [],
    gate: catalogs.sfield6 ?? [],
  }), [catalogs]);

  const setVisitor = (i: number, patch: Partial<VisitVisitorInput>): void => {
    setForm((f) => ({ ...f, visitors: f.visitors.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
  };

  const submit = async (): Promise<void> => {
    if (!model) return;
    setAskSubmit(false);
    setBusy(true);
    setNote(null);
    try {
      await visitClient.submitReport(form, model);
      setNote("报备已提交，学校系统会同步生成记录。");
      setForm(emptyDraft());
      const mine = await visitClient.myReports();
      setRows(mine.rows);
      setMineNote(null);
    } catch (e) {
      setError(e instanceof VisitApiError ? e.message : SUBMIT_FAIL);
    } finally {
      setBusy(false);
    }
  };

  /** 草稿要求自动提交：模型就绪后提交一次（submit 内部会 setAskSubmit(false)/清理提示） */
  useEffect(() => {
    if (!autoSubmit || phase !== "ready" || !model || busy) return;
    setAutoSubmit(false);
    void submit();
  }, [autoSubmit, phase, model, busy, submit]);

  if (phase === "need_login") {
    return (
      <Stack gap={3}>
        <Banner tone="info" title={i18n("auto.pages.info.VisitTab.1")}>
          {LOGIN_HINT}
        </Banner>
        <Card>
          <Stack gap={2}>
            <Text>{LOGIN_HINT_2}</Text>
            <Inline gap={2}>
              <Btn variant="solid" onClick={() => void load()}>{i18n("auto.pages.info.VisitTab.2")}</Btn>
              <Btn onClick={() => void openExternal(VISIT_MOBILE_ENTRY)}>{i18n("auto.pages.info.VisitTab.3")}</Btn>
            </Inline>
            {note ? <Text tone="quiet">{note}</Text> : null}
          </Stack>
        </Card>
      </Stack>
    );
  }

  if (phase === "loading" && !model) {
    return (
      <Card>
        <Text>{i18n("auto.pages.info.VisitTab.4")}</Text>
      </Card>
    );
  }

  if (phase === "error") {
    return (
      <Card>
        <Stack gap={2}>
          <Text>{error ?? LOAD_FAIL}</Text>
          <Inline gap={2}>
            <Btn variant="solid" onClick={() => void load()}>{i18n("auto.pages.info.VisitTab.5")}</Btn>
            <Btn onClick={() => void openExternal(VISIT_MOBILE_ENTRY)}>{i18n("auto.pages.info.VisitTab.3")}</Btn>
          </Inline>
        </Stack>
      </Card>
    );
  }

  const gateOptions = options.gate;
  const visitors = form.visitors;

  return (
    <Stack gap={3}>
      <Banner tone="info" title={i18n("auto.pages.info.VisitTab.6")}>{PAGE_HINT}</Banner>
      {note ? <Banner tone="success" title={i18n("auto.pages.info.VisitTab.7")}>{note}</Banner> : null}

      <Card>
        <Stack gap={3}>
          <Text weight="semibold">{model?.formName ?? "亲友来访报备"}</Text>

          <Inline gap={3} align="start">
            <Field label={i18n("auto.pages.info.VisitTab.8")} required>
              <Input value={form.visitDate} placeholder="2026-10-16" onChange={(v) => setForm((f) => ({ ...f, visitDate: v }))} />
            </Field>
            <Field label={i18n("auto.pages.info.VisitTab.9")}>
              <Select value={form.category ?? ""} options={options.category} placeholder={i18n("auto.pages.info.VisitTab.10")} onChange={(v) => setForm((f) => ({ ...f, category: v }))} aria-label={i18n("auto.pages.info.VisitTab.9")} />
            </Field>
          </Inline>

          <Inline gap={3} align="start">
            <Field label={i18n("auto.pages.info.VisitTab.11")}>
              <Select value={form.area ?? ""} options={options.area} placeholder={i18n("auto.pages.info.VisitTab.12")} onChange={(v) => setForm((f) => ({ ...f, area: v }))} aria-label={i18n("auto.pages.info.VisitTab.11")} />
            </Field>
            <Field label={i18n("auto.pages.info.VisitTab.13")}>
              <Select value={form.reason ?? ""} options={options.reason} placeholder={i18n("auto.pages.info.VisitTab.14")} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} aria-label={i18n("auto.pages.info.VisitTab.13")} />
            </Field>
          </Inline>

          <Field label={i18n("auto.pages.info.VisitTab.15")}>
            <TextArea value={form.reasonText ?? ""} rows={2} placeholder={i18n("auto.pages.info.VisitTab.16")} onChange={(v) => setForm((f) => ({ ...f, reasonText: v }))} />
          </Field>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Text weight="semibold">{i18n("auto.pages.info.VisitTab.17")}</Text>
          <Inline gap={3} align="start">
            <Field label={i18n("auto.pages.info.VisitTab.18")}>
              <Input value={form.inviterName ?? ""} onChange={(v) => setForm((f) => ({ ...f, inviterName: v }))} />
            </Field>
            <Field label={i18n("auto.pages.info.VisitTab.19")}>
              <Input value={form.inviterMobile ?? ""} type="tel" onChange={(v) => setForm((f) => ({ ...f, inviterMobile: v }))} />
            </Field>
          </Inline>
          <Inline gap={3} align="start">
            <Field label={i18n("auto.pages.info.VisitTab.20")}>
              <Input value={form.inviterIdCard ?? ""} onChange={(v) => setForm((f) => ({ ...f, inviterIdCard: v }))} />
            </Field>
            <Field label={i18n("auto.pages.info.VisitTab.21")}>
              <NumberField value={form.quota ?? 1} min={1} max={20} onChange={(n) => setForm((f) => ({ ...f, quota: n }))} />
            </Field>
          </Inline>
          <Field label={i18n("auto.pages.info.VisitTab.22")} hint={i18n("auto.pages.info.VisitTab.23")}>
            <Input value={form.passcode ?? ""} onChange={(v) => setForm((f) => ({ ...f, passcode: v }))} />
          </Field>
        </Stack>
      </Card>

      <Card>
        <Stack gap={3}>
          <Inline justify="between" align="center">
            <Text weight="semibold">{i18n("auto.pages.info.VisitTab.24")}</Text>
            <Btn size="sm" onClick={() => setForm((f) => ({ ...f, visitors: [...f.visitors, emptyVisitor()] }))}>{i18n("auto.pages.info.VisitTab.25")}</Btn>
          </Inline>
          {visitors.map((v, i) => (
            <Stack key={i} gap={2}>
              {i > 0 ? <Divider /> : null}
              <Inline gap={3} align="start">
                <Field label={i18n("auto.pages.info.VisitTab.26")}>
                  <Input value={v.name ?? ""} onChange={(x) => setVisitor(i, { name: x })} />
                </Field>
                <Field label={i18n("auto.pages.info.VisitTab.27")} required>
                  <Input value={v.idCard} onChange={(x) => setVisitor(i, { idCard: x })} />
                </Field>
              </Inline>
              <Inline gap={3} align="start">
                <Field label={i18n("auto.pages.info.VisitTab.19")} required>
                  <Input value={v.mobile} type="tel" onChange={(x) => setVisitor(i, { mobile: x })} />
                </Field>
                <Field label={i18n("auto.pages.info.VisitTab.28")} hint={i18n("auto.pages.info.VisitTab.29")}>
                  <Input value={v.plate ?? ""} onChange={(x) => setVisitor(i, { plate: x })} />
                </Field>
              </Inline>
              <Inline gap={3} align="start">
                <Field label={i18n("auto.pages.info.VisitTab.30")}>
                  <Select value={v.gate ?? ""} options={gateOptions} placeholder={i18n("auto.pages.info.VisitTab.31")} onChange={(x) => setVisitor(i, { gate: x })} aria-label={i18n("auto.pages.info.VisitTab.30")} />
                </Field>
                <Field label={i18n("auto.pages.info.VisitTab.32")}>
                  <Input value={v.org ?? ""} onChange={(x) => setVisitor(i, { org: x })} />
                </Field>
              </Inline>
              {visitors.length > 1 ? (
                <Inline>
                  <Btn size="sm" onClick={() => setForm((f) => ({ ...f, visitors: f.visitors.filter((_, j) => j !== i) }))}>{i18n("auto.pages.info.VisitTab.33")}</Btn>
                </Inline>
              ) : null}
            </Stack>
          ))}
          <Checkbox
            checked={form.confirmed}
            onChange={(on) => setForm((f) => ({ ...f, confirmed: on }))}
            label={model?.confirmLabel || "本人确认来访亲友关系属实、身份真实、来访事由合理。"}
          />
          <Inline gap={2}>
            <Btn variant="solid" disabled={!form.confirmed || busy} loading={busy} onClick={() => setAskSubmit(true)}>{i18n("auto.pages.info.VisitTab.34")}</Btn>
            <Btn onClick={() => void openExternal(VISIT_MOBILE_ENTRY)}>{i18n("auto.pages.info.VisitTab.3")}</Btn>
          </Inline>
          <Text tone="quiet" size="sm">{SUBMIT_HINT}</Text>
          {error ? <Text tone="error">{error}</Text> : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={2}>
          <Text weight="semibold">{i18n("auto.pages.info.VisitTab.35")}</Text>
          {mineNote ? <Text tone="quiet">{mineNote}</Text> : null}
          {rows === null ? (
            <Text tone="quiet">{i18n("auto.pages.info.VisitTab.36")}</Text>
          ) : rows.length === 0 ? (
            <EmptyState title={i18n("auto.pages.info.VisitTab.37")} hint={i18n("auto.pages.info.VisitTab.38")} />
          ) : (
            <Stack gap={1}>
              {rows.map((r) => (
                <Row
                  key={r.mBizId}
                  title={prettyTime(r.visitDate)}
                  sub={`提交时间 ${prettyTime(r.createdAt)}`}
                  trailing={<Text tone="quiet">{i18n("auto.pages.info.VisitTab.39")}{r.status}</Text>}
                />
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      <Modal
        open={askSubmit}
        onClose={() => setAskSubmit(false)}
        title={CONFIRM_TITLE}
        foot={
          <Inline gap={2} justify="end">
            <Btn onClick={() => setAskSubmit(false)}>{i18n("auto.pages.info.VisitTab.40")}</Btn>
            <Btn variant="solid" onClick={() => void submit()}>{i18n("auto.pages.info.VisitTab.41")}</Btn>
          </Inline>
        }
      >
        <Stack gap={2}>
          <Text>{`来访日期：${form.visitDate}，来访人 ${form.visitors.length} 位。`}</Text>
          <Text tone="quiet">{SUBMIT_HINT}</Text>
        </Stack>
      </Modal>
    </Stack>
  );
}
