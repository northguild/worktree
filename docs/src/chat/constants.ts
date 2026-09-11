export const ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
] as const;

export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export const FREE_MODELS: ReadonlyArray<{
  label: string;
  value: AllowedModel;
}> = [
  { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
  { label: "Gemini 2.5 Flash Lite (fastest)", value: "gemini-2.5-flash-lite" },
  { label: "Gemini 3 Flash (preview)", value: "gemini-3-flash-preview" },
];

export const DEFAULT_MODEL: AllowedModel = FREE_MODELS[0].value;

/**
 * Hard cap on a single message, in characters.
 *
 * Shared on purpose. The Worker rejects anything longer with a 400
 * (`docs/worker/worker.ts`) and the compose field stops the value ever reaching
 * that length, so the two have to be the same number — and a literal in each
 * runtime had nothing keeping them in step.
 */
export const MAX_MESSAGE_LENGTH = 20_000;
