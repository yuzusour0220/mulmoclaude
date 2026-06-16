import type { Messages } from "./messages";

const zh: Messages = {
  errorSummary: "请修正以下错误",
  requiredMarker: "*",
  selectOption: "请选择",
  charactersCount: (current, max) => `${current} / ${max} 字符`,
  charactersCountNoMax: (current) => `${current} 字符`,
  submitted: "已提交",
  submit: "提交",
  progress: (filled, total) => `已填写 ${filled} / ${total} 个必填字段`,
  fallbackTitle: "表单",
  fieldCount: (count) => `${count} 个字段`,
};

export default zh;
