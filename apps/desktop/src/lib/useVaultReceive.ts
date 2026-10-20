import { useCallback, useState } from 'react';
import { openFormModal } from './formModal.js';
import { pickAndReceiveQr, receivePastedCode } from './contentExchange.js';
import { showToast } from '../state/toast.js';
import { t as i18n } from "../i18n/index.js";


/**
 * 暂存箱各形态（整页/雷达/抽屉）共用的「收进来」：粘贴口令 + 扫码。
 * 统一走 contentExchange 的接收入口，因此新旧口令、箱子/名片/组织/碰一碰全都认。
 */
export function useVaultReceive(): { busy: boolean; paste: () => Promise<void>; scan: () => Promise<void> } {
  const [busy, setBusy] = useState(false);
  const paste = useCallback(async (): Promise<void> => {
    const f = await openFormModal('接收分享口令', [{ key: 'code', label: i18n("auto.lib.useVaultReceive.p1"), kind: 'textarea', required: true }]);
    if (!f?.code) return;
    setBusy(true);
    try { showToast(await receivePastedCode(f.code)); }
    catch (e) { showToast(e instanceof Error ? e.message : '接收失败，请重试'); }
    finally { setBusy(false); }
  }, []);
  const scan = useCallback(async (): Promise<void> => {
    setBusy(true);
    try { const message = await pickAndReceiveQr(); if (message) showToast(message); }
    catch (e) { showToast(e instanceof Error ? e.message : '扫码失败，请换一张清晰的二维码图片'); }
    finally { setBusy(false); }
  }, []);
  return { busy, paste, scan };
}
