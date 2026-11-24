import type { ReactElement } from "react";
import { t as i18n } from "../../i18n/index.js";
import { Btn, Input, Select } from "@onethu/gui";
import { WATER_BRANDS, getWaterUserInformation, submitWaterOrder } from "@onethu/core";
import { Card, ErrorNote, SectionHead } from "../../components/Layout.js";
import { logLine } from "../../lib/clients.js";
import { explainNetworkError, universalFetch } from "../../lib/transport.js";
import { useState } from "react";

function logErr(tag: string, err: unknown): void {
  void logLine("PAGE-ERR " + tag + " " + (err instanceof Error ? err.message : String(err))).catch(() => undefined);
}

export function WaterTab(): ReactElement {
  /* 清华水站订水：公开接口，不依赖网络学堂/家园网登录。 */
  const [waterId, setWaterId] = useState("");
  const [contact, setContact] = useState("");
  const [address, setAddress] = useState("");
  const [brand, setBrand] = useState("6");
  const [num, setNum] = useState("1");
  const [num1, setNum1] = useState("0");
  const [waterState, setWaterState] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [waterMsg, setWaterMsg] = useState("");

  const queryWater = async (): Promise<void> => {
    if (!waterId.trim()) {
      setWaterState("error");
      setWaterMsg(i18n("pages.info.dormtab.e115f82b905e"));
      return;
    }
    setWaterState("busy");
    setWaterMsg("");
    try {
      const u = await getWaterUserInformation(universalFetch, waterId);
      setContact(u.name ?? "");
      setAddress(u.address ?? "");
      setWaterState("ok");
      setWaterMsg(u.name || u.address ? i18n("pages.info.dormtab.3dd6c0cbae44") : i18n("pages.info.dormtab.dd57d5ccb2f3"));
    } catch (err) {
      logErr("WATER-Q", err);
      setWaterState("error");
      setWaterMsg(explainNetworkError(err));
    }
  };

  const submitWater = async (): Promise<void> => {
    if (!waterId.trim() || !address.trim()) {
      setWaterState("error");
      setWaterMsg(i18n("pages.info.dormtab.cdf03a9a9579"));
      return;
    }
    setWaterState("busy");
    setWaterMsg("");
    try {
      await submitWaterOrder(universalFetch, { id: waterId, num, num1, lid: brand, address });
      setWaterState("ok");
      setWaterMsg(i18n("pages.info.dormtab.40819c08f4e1"));
    } catch (err) {
      logErr("WATER-SUB", err);
      setWaterState("error");
      setWaterMsg(explainNetworkError(err));
    }
  };

  return (
    <>
      <div data-sec="water">
        <SectionHead title={i18n("pages.info.dormtab.bb8c939d0fcd")} aside={i18n("pages.info.dormtab.8d6ebc4e3453")} />
      </div>
      <Card className="dorm-water-card">
        <div className="field">
          <label htmlFor="water-id">{i18n("pages.info.dormtab.fbfad2e4053e")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>{<Input value={waterId} onChange={(value) => setWaterId(value)} placeholder={i18n("pages.info.dormtab.c3fc6114b55c")} />}</div>
            <Btn variant="outline" onClick={() => void queryWater()} disabled={waterState === "busy"}>{i18n("pages.info.dormtab.bcd6771e08ec")}</Btn>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 14px" }}>
          <div className="field">
            <label htmlFor="water-contact">{i18n("pages.info.dormtab.3303b56982a0")}</label>
            <Input value={contact} onChange={(value) => setContact(value)} />
          </div>
          <div className="field">
            <label htmlFor="water-num">{i18n("pages.info.dormtab.6cb5a329f274")}</label>
            <input id="water-num" className="input" type="number" min={1} value={num} onChange={(e) => setNum(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="water-num1">{i18n("pages.info.dormtab.e7d4e116f779")}</label>
            <input id="water-num1" className="input" type="number" min={0} value={num1} onChange={(e) => setNum1(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="water-brand">{i18n("pages.info.dormtab.3a37484d933f")}</label>
          <Select id="water-brand" value={brand} onChange={(value) => setBrand(value)}>{Object.entries(WATER_BRANDS).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}</Select>
        </div>
        <div className="field">
          <label htmlFor="water-addr">{i18n("pages.info.dormtab.d872b26584ac")}</label>
          <Input value={address} onChange={(value) => setAddress(value)} placeholder={i18n("pages.info.dormtab.b09dff2cb1cb")} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Btn variant="solid" tone="brand" onClick={() => void submitWater()} disabled={waterState === "busy"}>{waterState === "busy" ? i18n("pages.info.dormtab.18931020ad52") : i18n("pages.info.dormtab.d189e0a2a1c5")}</Btn>
          {waterMsg ? (
            <span className={waterState === "error" ? "t-red" : ""} style={{ fontSize: 13 }}>
              {waterMsg}
            </span>
          ) : null}
        </div>
      </Card>
    </>
  );
}
