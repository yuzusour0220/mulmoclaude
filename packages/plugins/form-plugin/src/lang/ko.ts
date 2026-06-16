import type { Messages } from "./messages";

const ko: Messages = {
  errorSummary: "다음 오류를 수정해주세요",
  requiredMarker: "*",
  selectOption: "선택하세요",
  charactersCount: (current, max) => `${current} / ${max} 자`,
  charactersCountNoMax: (current) => `${current} 자`,
  submitted: "제출됨",
  submit: "제출",
  progress: (filled, total) => `필수 항목 ${total}개 중 ${filled}개 입력됨`,
  fallbackTitle: "양식",
  fieldCount: (count) => `${count}개 항목`,
};

export default ko;
