import { listPublishedOfficialAccountPrivateTemplates, loadPublishedOfficialAccountConfig } from "../server/services/officialAccountNotifier.ts";

const [configResult, templateResult] = await Promise.all([
  loadPublishedOfficialAccountConfig(),
  listPublishedOfficialAccountPrivateTemplates(),
]);

console.log(JSON.stringify({
  configuredTemplateId: configResult.config?.templateId ?? null,
  templateLibrary: templateResult.templates.map(template => ({
    templateId: template.templateId,
    title: template.title,
    fieldNames: Object.keys(template.fieldMapping),
  })),
  libraryMessage: templateResult.message,
}, null, 2));
