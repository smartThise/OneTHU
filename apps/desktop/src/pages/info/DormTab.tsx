import type { ReactElement } from "react";
import { ElectricityTab } from "./ElectricityTab.js";
import { WaterTab } from "./WaterTab.js";

/** 兼容白板卡片/旧调用：无 section 时组合两块；生活页已拆成两个独立 tab。 */
export function DormTab({ section }: { section?: "ele" | "water" } = {}): ReactElement {
  if (section === "ele") return <ElectricityTab />;
  if (section === "water") return <WaterTab />;
  return <><ElectricityTab /><WaterTab /></>;
}
