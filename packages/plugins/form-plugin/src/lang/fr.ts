import type { Messages } from "./messages";

const fr: Messages = {
  errorSummary: "Veuillez corriger les erreurs suivantes",
  requiredMarker: "*",
  selectOption: "Sélectionnez une option",
  charactersCount: (current, max) => `${current} / ${max} caractères`,
  charactersCountNoMax: (current) => `${current} caractères`,
  submitted: "Envoyé",
  submit: "Envoyer",
  progress: (filled, total) => `${filled} sur ${total} champs obligatoires remplis`,
  fallbackTitle: "Formulaire",
  fieldCount: (count) => (count === 1 ? `${count} champ` : `${count} champs`),
};

export default fr;
