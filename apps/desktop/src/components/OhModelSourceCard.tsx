/**
 * 小 OH 模型源卡片（设置里通用，完整/极简/实用模式共用）：
 *  - 选择模型源：学校 MadModel 免费档 / 自己的 API；
 *  - 免费档下显示有效期与「一键续签」（不再等 429 才处理）；
 *  - 自费档下给出 API Key 配置状态与入口。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Btn, Card, Inline, Segment, Stack, Text } from "@onethu/gui";
import { getPlugin, subscribe, updatePlugin } from "../plugins/registry.js";
import { ensureMadModelToken, jwtExpiresAt, madmodelActive } from "../state/madmodel.js";
import { showToast } from "../state/toast.js";
import { t as i18n } from "../i18n/index.js";


const HARNESS_ID = "onethu.harness";

function patchHarnessSettings(patch: Record<string, unknown>): void {
  const rec = getPlugin(HARNESS_ID);
  if (!rec) return;
  updatePlugin(HARNESS_ID, { settings: { ...(rec.settings ?? {}), ...patch } as typeof rec.settings });
}

function expireText(token: string): string {
  const exp = jwtExpiresAt(token);
  if (!exp) return "有效期未知（以服务端为准）";
  if (exp <= Date.now()) return "已过期 · 点一键续签";
  const h = Math.max(1, Math.round((exp - Date.now()) / 3600_000));
  return h >= 24 ? `约 ${Math.floor(h / 24)} 天有效` : `约 ${h} 小时有效`;
}

export function OhModelSourceCard(): ReactNode {
  const [, force] = useState(0);
  useEffect(() => subscribe(() => force((v) => v + 1)), []);
  /* 插件设置是可变单例：订阅 registry 变化后直接读，不用对象快照（快照每次新对象会死循环）。 */
  const settings = (getPlugin(HARNESS_ID)?.settings ?? {}) as Record<string, unknown>;
  const [busy, setBusy] = useState(false);
  const isMad = madmodelActive();
  const token = String(settings.madmodelToken ?? "");
  const apiKey = String(settings.apiKey ?? "");
  const model = String(isMad ? (settings.madmodelModel || "DeepSeek-V4.1-Flash") : (settings.model || "deepseek-chat"));

  const renew = useCallback((): void => {
    setBusy(true);
    void ensureMadModelToken(true)
      .then(() => {
        force((v) => v + 1);
        showToast(i18n("auto.components.OhModelSourceCard.msg1"));
      })
      .catch((e) => {
        showToast(`续签失败：${e instanceof Error ? e.message : String(e)}（可改用自己的 API）`);
      })
      .finally(() => setBusy(false));
  }, []);

  return (
    <Card className="oh-model-source">
      <Stack gap={3}>
        <Inline gap={2} wrap justify="between">
          <Stack gap={1}>
            <Text slot="title">{i18n("auto.components.OhModelSourceCard.1")}</Text>
            <Text slot="micro" tone="faint">
              {isMad ? `当前：学校 MadModel 免费档 · ${model}` : `当前：自己的 API · ${model || "未填模型"}`}
            </Text>
          </Stack>
          {isMad ? (
            <Btn variant="solid" tone="brand" disabled={busy} onClick={renew}>{busy ? "续签中…" : "一键续签"}</Btn>
          ) : (
            <Btn variant="ghost" onClick={() => patchHarnessSettings({ provider: "madmodel" })}>{i18n("auto.components.OhModelSourceCard.2")}</Btn>
          )}
        </Inline>
        <Segment
          value={isMad ? "madmodel" : "custom"}
          onChange={(v) => patchHarnessSettings({ provider: v })}
          options={[
            { value: "madmodel", label: i18n("auto.components.OhModelSourceCard.p1") },
            { value: "custom", label: i18n("auto.components.OhModelSourceCard.p2") },
          ]}
        />
        <Text slot="micro" tone="faint">
          {isMad
            ? `续签后自动生效；${expireText(token)}。遇到 429 就点一键续签或换自己的 API。`
            : apiKey
              ? `已配置 API Key；地址与模型在下方「小 OH · 自己的 API」里调整。`
              : "自己的 API 的地址、Key 与模型在下方「小 OH · 自己的 API」里填写。"}
        </Text>
      </Stack>
    </Card>
  );
}
