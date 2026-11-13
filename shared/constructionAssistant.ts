export const CONSTRUCTION_ASSISTANT_FIELDS = [
  "workArea",
  "workContent",
  "constructionPlan",
  "safetyNotes",
  "issueNotes",
] as const;
export type ConstructionAssistantField =
  (typeof CONSTRUCTION_ASSISTANT_FIELDS)[number];
export const CONSTRUCTION_ASSISTANT_MODES = [
  "polish",
  "organize",
  "revise",
] as const;
export type ConstructionAssistantMode =
  (typeof CONSTRUCTION_ASSISTANT_MODES)[number];
export const CONSTRUCTION_ASSISTANT_FIELD_LIMITS: Record<
  ConstructionAssistantField,
  number
> = {
  workArea: 200,
  workContent: 8000,
  constructionPlan: 8000,
  safetyNotes: 1000,
  issueNotes: 1000,
};
export type AssistantConfiguration = {
  aiEnabled: boolean;
  aiDailyLimit: number;
  cloudVoiceEnabled: boolean;
  voiceDailyLimit: number;
  speechEndpoint: string;
  speechModel: string;
  historyEnabled: boolean;
  speechKeyConfigured: boolean;
};
export const CONSTRUCTION_ASSISTANT_DEFAULTS: Omit<
  AssistantConfiguration,
  "speechKeyConfigured"
> = {
  aiEnabled: true,
  aiDailyLimit: 20,
  cloudVoiceEnabled: true,
  voiceDailyLimit: 10,
  speechEndpoint: "",
  speechModel: "",
  historyEnabled: true,
};
