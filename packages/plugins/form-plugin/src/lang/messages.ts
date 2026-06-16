export interface Messages {
  errorSummary: string;
  requiredMarker: string;
  selectOption: string;
  charactersCount(current: number, max: number): string;
  charactersCountNoMax(current: number): string;
  submitted: string;
  submit: string;
  progress(filled: number, total: number): string;
  fallbackTitle: string;
  fieldCount(count: number): string;
}
