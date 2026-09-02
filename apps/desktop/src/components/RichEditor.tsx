import ReactQuill from "react-quill-new";
import "react-quill-new/dist/quill.snow.css";

const MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ color: [] }, { background: [] }],
    [{ list: "ordered" }, { list: "bullet" }],
    ["blockquote", "code-block"],
    ["link", "image"],
    ["clean"],
  ],
};

const FORMATS = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "color",
  "background",
  "list",
  "bullet",
  "blockquote",
  "code-block",
  "link",
  "image",
];

/** 讨论区发帖/回帖富文本编辑器（Quill）：格式能力对齐站点 CKEditor
 *  （标题/加粗斜体下划线删除线/颜色/列表/引用/代码/链接图片），产物即 HTML。
 *  站点字数上限 5000（CKEditor wordcount 插件实测配置）。 */
export function RichEditor(props: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  maxHeight?: number;
}) {
  return (
    <div className="rich-editor" style={{ maxHeight: props.maxHeight ?? 320, overflowY: "auto" }}>
      <ReactQuill
        theme="snow"
        value={props.value}
        onChange={props.onChange}
        modules={MODULES}
        formats={FORMATS}
        placeholder={props.placeholder ?? "输入正文，支持格式与图片"}
      />
    </div>
  );
}
