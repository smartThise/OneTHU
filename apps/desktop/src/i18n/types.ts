/** 一份语言的完整定义：显示名 + 文案表。新增语言只需在 locales/ 下新建一个同结构的文件。 */
export interface LocaleDef {
  /** 语言选择器里显示的名字（用该语言自己的写法，例如「日本語」）。 */
  label: string;
  /** 键 → 文案。键集合必须与 zh-CN 一致（tools/i18n-test.mjs 守）。 */
  messages: Record<string, string>;
}
