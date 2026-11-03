import { t as i18n, useLocale as useUiLocale } from "../i18n/index.js";
/**
 * 「搜索与胶囊」设置分节（dev-explorer，explorer-oh 专属）：
 *  - 点击胶囊默认打开：搜索 / OH（explorerPrefs.capsuleTap）
 *  - 最近搜索记录：条数展示 + 两次点击确认清空（超时反悔回落，原 UX 保留）
 *
 * 2026-10-14 换血：骨架改为 OneGUI（SettingsList / SettingsRow / Segment / Btn），
 * 不再写 .setting-row / .ohx-prefseg / .btn 这些页面私有类；行为与文案一字未改。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Btn, Section, Segment, SettingsList, SettingsRow } from "@onethu/gui";
import {
  useExplorerPrefs, setExplorerPrefs, useSearchHistory, clearSearchHistory,
  type CapsuleDefault,
} from "../state/explorerPrefs.js";

export function ExplorerPrefsSection({ hideCapsule = false }: { hideCapsule?: boolean } = {}): ReactNode {
  const uiLocale = useUiLocale();

  const prefs = useExplorerPrefs();
  const hist = useSearchHistory();
  const [arming, setArming] = useState(false);
  const armTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (armTimer.current) window.clearTimeout(armTimer.current);
  }, []);

  const onClear = (): void => {
    if (!arming) {
      setArming(true);
      if (armTimer.current) window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArming(false), 2600); // 超时反悔回落
      return;
    }
    if (armTimer.current) window.clearTimeout(armTimer.current);
    setArming(false);
    clearSearchHistory();
  };

  return (
    <>
      {/* 小标题只对完整模式有用（那里第一次出现「搜索与胶囊」这个概念）；实用模式只剩搜索记录一行，
          页面上已经有「工作空间」分节标题，再来一个「搜索与胶囊」会指向一个不存在的控件。 */}
      {hideCapsule ? null : <Section title={i18n("components.explorerprefssection.faa18ef93208")} hint={i18n("components.explorerprefssection.2c2a533ac8e4")} />}
      <SettingsList>
        {/* 「点击胶囊默认打开」只对完整模式的 OneShot 胶囊有意义：实用模式没有胶囊设置这一层，
            但最近搜索记录与搜索本身仍然存在，所以只摘这一行，不整节删掉。 */}
        {hideCapsule ? null : <SettingsRow id="row-set-capsule-tap"
          title={i18n("components.explorerprefssection.464f0207d4ff")}
          sub={i18n("components.explorerprefssection.48875ae74158")}
          control={
            <Segment
              value={prefs.capsuleTap}
              onChange={(v) => setExplorerPrefs({ capsuleTap: v as CapsuleDefault })}
              options={[{ value: "search", label: i18n("components.explorerprefssection.44ce7ae909bb") }, { value: "oh", label: "OH" }]}
            />
          }
        />}
        {/* voiceTarget 已废弃（用户定案）：胶囊/语音只产生文字，送谁由小窗内的搜索|OH 切换决定 */}
        <SettingsRow id="row-set-search-history"
          title={i18n("components.explorerprefssection.461301d93770")}
          sub={hist.length > 0 ? i18n("components.explorerprefssection.26b3d168dbfe", { length: String(hist.length) }) : i18n("components.explorerprefssection.46ca86da52b3")}
          control={
            <Btn variant="ghost" size="sm" disabled={hist.length === 0} onClick={onClear}>
              {arming ? i18n("components.explorerprefssection.563b252befe6") : i18n("components.explorerprefssection.80e015bfff38")}
            </Btn>
          }
        />
      </SettingsList>
    </>
  );
}
