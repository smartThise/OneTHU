/** Harness 品牌标识 (OH)：代码风括号 + 衬线 O + 苹方/黑体 H——与 OneTHU (One/THU) 同族混排 */
export function HarnessMark({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={"harness-mark " + className} style={{ fontSize: size }} aria-label="OneTHU Harness">
      <span className="p">(</span>
      <span className="o">O</span>
      <span className="h">H</span>
      <span className="p">)</span>
    </span>
  );
}
