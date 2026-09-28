/**
 * 技术细节折叠区（§4.5 遗留）：正文只说人话，状态码 / 原始报错 / 链接收进「详情」。
 *
 * 用原生 <details>/<summary>：键盘可达、无脚本也能开、内容能选中复制，不值得自己造一套开合状态。
 *
 * ErrorLine 是配套的「一句话 + 原始串」渲染器，只有**尾巴真的像技术串**时才折叠——
 * 「未读满 5 个」「网络不通」这类人话不该被塞进详情里，那是把人话也藏起来。
 */
import type { CSSProperties, ReactNode } from "react";

export function Details({
  children,
  label = "详情",
}: {
  children: ReactNode;
  label?: string;
}): ReactNode {
  return (
    <details className="tech-details">
      <summary>{label}</summary>
      <div className="tech-details-body">{children}</div>
    </details>
  );
}

/** 什么算「技术串」：HTTP 状态码、常见网络/类型错误名、URL、英文 Error 前缀 */
const TECH =
  /(HTTP\s*\d|\b\d{3}\b|\b(?:TypeError|NetworkError|ReferenceError|SyntaxError|RangeError|ECONN[A-Z]*|ENOTFOUND|ETIMEDOUT|fetch failed|timed? ?out)\b|https?:\/\/|[A-Za-z]+Error:)/i;

/** 把「人话：原始报错」拆开渲染：人话留着，原始串折进详情 */
export function ErrorLine({
  text,
  label = "详情",
  style,
}: {
  text: string;
  label?: string;
  style?: CSSProperties;
}): ReactNode {
  const i = text.search(/[：:]/);
  const head = i > 0 ? text.slice(0, i) : text;
  const tail = i > 0 ? text.slice(i + 1).trim() : "";
  if (tail !== "" && TECH.test(tail)) {
    return (
      <div className="error-line" style={style}>
        <span>{head}</span>
        <Details label={label}>{tail}</Details>
      </div>
    );
  }
  return (
    <div className="error-line" style={style}>
      <span>{text}</span>
    </div>
  );
}
