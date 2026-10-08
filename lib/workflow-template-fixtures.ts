/**
 * First workflow fixture: a deliberately partial example for the
 * "Qoldiq noto'g'ri" problem category -- Problem Split through Blog, plus
 * Blog's parallel branches. This does not model the whole final production
 * flow (per sprint instruction); Repurpose Map is included only to show
 * the "blocking on Head Review" relationship in configuration, not as a
 * runtime-generated step.
 */
import { addStep, createWorkflowTemplate, type WorkflowTemplate } from "./workflow-template";
import { findTaskTypeFixtureByName } from "./task-type-fixtures";

const FIXTURE_EPOCH_MS = Date.UTC(2026, 9, 8, 1);
let counter = 0;
function now(): string {
  counter += 1;
  return new Date(FIXTURE_EPOCH_MS + counter * 1000).toISOString();
}

function taskTypeId(name: string): string {
  const taskType = findTaskTypeFixtureByName(name);
  if (!taskType) throw new Error(`Fixture Task Type not found: "${name}". This is a fixture bug, not a runtime user error.`);
  return taskType.id;
}

function buildQoldiqNotogriWorkflow(): WorkflowTemplate {
  let template = createWorkflowTemplate(
    {
      name: "Qoldiq noto'g'ri — boshlang'ich zanjir",
      description: "Problem Split → Knowledge Discovery → Research → Blog, so'ng Blog'dan parallel tarmoqlar.",
      moduleType: "KNOWLEDGE_DEVELOPMENT",
    },
    now,
  );

  template = addStep(template, {
    taskTypeId: taskTypeId("Problem Split"),
    nameTemplate: "Qoldiq noto'g'ri — Problem Split",
    dependsOn: [],
    blocking: true,
    skippable: false,
  }, now);
  const problemSplitId = template.steps[0].id;

  template = addStep(template, {
    taskTypeId: taskTypeId("Knowledge Discovery"),
    nameTemplate: "Qoldiq noto'g'ri — Knowledge Discovery",
    dependsOn: [problemSplitId],
    blocking: true,
    skippable: false,
  }, now);
  const knowledgeDiscoveryId = template.steps[1].id;

  template = addStep(template, {
    taskTypeId: taskTypeId("Research"),
    nameTemplate: "Qoldiq noto'g'ri — Research",
    dependsOn: [knowledgeDiscoveryId],
    blocking: true,
    skippable: false,
  }, now);
  const researchId = template.steps[2].id;

  template = addStep(template, {
    taskTypeId: taskTypeId("Blog"),
    nameTemplate: "Qoldiq noto'g'ri — Blog",
    dependsOn: [researchId],
    blocking: true,
    skippable: false,
  }, now);
  const blogId = template.steps[3].id;

  // Blog follow-up: Head Review blocks future Repurpose; SEO/Angle/
  // Performance Consultation do not wait for Head Review -- all three
  // depend only on Blog, matching the spec's BLOG FOLLOW-UP rules exactly.
  template = addStep(template, {
    taskTypeId: taskTypeId("Head Review"),
    nameTemplate: "Qoldiq noto'g'ri — Head Review",
    dependsOn: [blogId],
    blocking: true,
    skippable: false,
  }, now);
  const headReviewId = template.steps[4].id;

  template = addStep(template, {
    taskTypeId: taskTypeId("SEO"),
    nameTemplate: "Qoldiq noto'g'ri — SEO",
    dependsOn: [blogId],
    blocking: false,
    skippable: true,
  }, now);

  template = addStep(template, {
    taskTypeId: taskTypeId("Angle"),
    nameTemplate: "Qoldiq noto'g'ri — Angle",
    dependsOn: [blogId],
    blocking: false,
    skippable: true,
  }, now);

  template = addStep(template, {
    taskTypeId: taskTypeId("Performance Consultation"),
    nameTemplate: "Qoldiq noto'g'ri — Performance Consultation",
    dependsOn: [blogId],
    blocking: false,
    skippable: true,
  }, now);

  // Modeled in configuration only, per instruction -- Repurpose Map is not
  // runtime-generated this sprint. It depends on Head Review (not merely
  // Blog), matching "Repurpose Map cannot start until the Blog is
  // Head-approved." Nothing currently depends on this step, so it is
  // marked non-blocking (blocking:true with no dependents is flagged by
  // validateWorkflowTemplate as a likely mistake).
  template = addStep(template, {
    taskTypeId: taskTypeId("Repurpose Map"),
    nameTemplate: "Qoldiq noto'g'ri — Repurpose Map",
    dependsOn: [headReviewId],
    blocking: false,
    skippable: true,
  }, now);

  return template;
}

export const QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE: WorkflowTemplate = buildQoldiqNotogriWorkflow();

export const WORKFLOW_TEMPLATE_FIXTURES: readonly WorkflowTemplate[] = [QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE];
