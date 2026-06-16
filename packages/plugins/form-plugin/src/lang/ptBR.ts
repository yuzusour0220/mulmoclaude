import type { Messages } from "./messages";

const ptBR: Messages = {
  errorSummary: "Por favor, corrija os seguintes erros",
  requiredMarker: "*",
  selectOption: "Selecione uma opção",
  charactersCount: (current, max) => `${current} / ${max} caracteres`,
  charactersCountNoMax: (current) => `${current} caracteres`,
  submitted: "Enviado",
  submit: "Enviar",
  progress: (filled, total) => `${filled} de ${total} campos obrigatórios preenchidos`,
  fallbackTitle: "Formulário",
  fieldCount: (count) => (count === 1 ? `${count} campo` : `${count} campos`),
};

export default ptBR;
