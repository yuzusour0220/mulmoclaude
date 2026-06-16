import type { Messages } from "./messages";

const es: Messages = {
  errorSummary: "Por favor, corrija los siguientes errores",
  requiredMarker: "*",
  selectOption: "Seleccione una opción",
  charactersCount: (current, max) => `${current} / ${max} caracteres`,
  charactersCountNoMax: (current) => `${current} caracteres`,
  submitted: "Enviado",
  submit: "Enviar",
  progress: (filled, total) => `${filled} de ${total} campos obligatorios completados`,
  fallbackTitle: "Formulario",
  fieldCount: (count) => (count === 1 ? `${count} campo` : `${count} campos`),
};

export default es;
