import { useEffect, useState } from "react";
import { Card, PageHead, SectionHead } from "../components/Layout.js";
import { clearRemembered, loadRemembered } from "../lib/clients.js";
import { useApp } from "../state/context.js";

export function SettingsPage() {
  const { user, logout } = useApp();
  const [hasSaved, setHasSaved] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void loadRemembered().then((r) => setHasSaved(!!r));
  }, []);

  const onClear = async () => {
    setClearing(true);
    try {
      await clearRemembered();
      setHasSaved(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <PageHead title="设置" meta="OneTHU 0.1.0" />

      <SectionHead title="账户" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">统一认证</div>
            <div className="setting-desc">{user?.displayName || user?.username || "未登录"}</div>
          </div>
          <button className="btn" onClick={() => void logout()}>
            退出登录
          </button>
        </div>
      </Card>

      <SectionHead title="安全" />
      <Card>
        <div className="setting-row">
          <div>
            <div className="setting-title">记住的密码</div>
            <div className="setting-desc">
              {hasSaved
                ? "已在本机保存（混淆存储，应用数据目录，非明文）；刷新/重启后自动登录。"
                : "未保存。登录页勾选「记住密码」即可启用。"}
            </div>
          </div>
          {hasSaved ? (
            <button className="btn" disabled={clearing} onClick={() => void onClear()}>
              {clearing ? "清除中…" : "清除"}
            </button>
          ) : null}
        </div>
      </Card>
    </>
  );
}
