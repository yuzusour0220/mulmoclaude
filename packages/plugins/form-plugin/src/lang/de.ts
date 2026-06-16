import type { Messages } from "./messages";

const de: Messages = {
  errorSummary: "Bitte korrigieren Sie die folgenden Fehler",
  requiredMarker: "*",
  selectOption: "Bitte auswählen",
  charactersCount: (current, max) => `${current} / ${max} Zeichen`,
  charactersCountNoMax: (current) => `${current} Zeichen`,
  submitted: "Gesendet",
  submit: "Senden",
  progress: (filled, total) => `${filled} von ${total} Pflichtfeldern ausgefüllt`,
  fallbackTitle: "Formular",
  fieldCount: (count) => (count === 1 ? `${count} Feld` : `${count} Felder`),
};

export default de;
