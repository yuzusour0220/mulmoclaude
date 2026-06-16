import type { Messages } from "./messages";

const ja: Messages = {
  errorSummary: "次のエラーを修正してください",
  requiredMarker: "*",
  selectOption: "選択してください",
  charactersCount: (current, max) => `${current} / ${max} 文字`,
  charactersCountNoMax: (current) => `${current} 文字`,
  submitted: "送信済み",
  submit: "送信",
  progress: (filled, total) => `必須項目 ${total} 件中 ${filled} 件入力済み`,
  fallbackTitle: "フォーム",
  fieldCount: (count) => `${count} 項目`,
};

export default ja;
