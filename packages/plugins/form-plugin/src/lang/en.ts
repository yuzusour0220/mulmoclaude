import type { Messages } from "./messages";

const en: Messages = {
  errorSummary: "Please fix the following errors",
  requiredMarker: "*",
  selectOption: "Select an option",
  charactersCount: (current, max) => `${current} / ${max} characters`,
  charactersCountNoMax: (current) => `${current} characters`,
  submitted: "Submitted",
  submit: "Submit",
  progress: (filled, total) => `${filled} of ${total} required fields completed`,
  fallbackTitle: "Form",
  fieldCount: (count) => `${count} field${count === 1 ? "" : "s"}`,
};

export default en;
