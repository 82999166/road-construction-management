import { inspectPublishedOfficialAccountTemplateCapability, testPublishedOfficialAccountConfiguration } from "../server/services/officialAccountNotifier.ts";

const credential = await testPublishedOfficialAccountConfiguration();
const template = await inspectPublishedOfficialAccountTemplateCapability();

console.log(JSON.stringify({ credential, template }, null, 2));
