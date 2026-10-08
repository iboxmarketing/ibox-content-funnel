/**
 * First workflow fixture: a deliberately partial example for the
 * "Qoldiq noto'g'ri" problem category -- Problem Split through Blog, plus
 * Blog's parallel branches, through the Sprint 4 content-decision layer
 * (Destination Decision, Repurpose Map). This does not model the whole
 * final production chain (Reel/Carousel/Text Post/YouTube themselves stay
 * outside this WorkflowTemplate -- they're generated directly from a
 * confirmed format preview, not from a template step; see
 * content-workflow.ts).
 *
 * Sprint 4 (section 11): Destination Decision waits on Blog + Angle +
 * Performance Consultation (not SEO), so Angle and Performance
 * Consultation now need `blocking: true` -- Destination Decision is the
 * first real dependent either of them has. Repurpose Map now waits on
 * BOTH Head Review and Destination Decision.
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

  // Blog follow-up: Head Review blocks future Repurpose; SEO never blocks
  // anything; Angle and Performance Consultation feed Destination
  // Decision (section 11), so they must block it.
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
    blocking: true,
    skippable: true,
  }, now);
  const angleId = template.steps[6].id;

  template = addStep(template, {
    taskTypeId: taskTypeId("Performance Consultation"),
    nameTemplate: "Qoldiq noto'g'ri — Performance Consultation",
    dependsOn: [blogId],
    blocking: true,
    skippable: true,
  }, now);
  const performanceConsultationId = template.steps[7].id;

  // Destination Decision (section 7): waits on Blog + Angle + Performance
  // Consultation -- explicitly does NOT depend on SEO.
  template = addStep(template, {
    taskTypeId: taskTypeId("Destination Decision"),
    nameTemplate: "Qoldiq noto'g'ri — Destination Decision",
    dependsOn: [blogId, angleId, performanceConsultationId],
    blocking: true,
    skippable: false,
  }, now);
  const destinationDecisionId = template.steps[8].id;

  // Repurpose Map (section 11): eligible only once Head Review AND
  // Destination Decision have both settled.
  template = addStep(template, {
    taskTypeId: taskTypeId("Repurpose Map"),
    nameTemplate: "Qoldiq noto'g'ri — Repurpose Map",
    dependsOn: [headReviewId, destinationDecisionId],
    blocking: false,
    skippable: true,
  }, now);

  return template;
}

export const QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE: WorkflowTemplate = buildQoldiqNotogriWorkflow();

export const WORKFLOW_TEMPLATE_FIXTURES: readonly WorkflowTemplate[] = [QOLDIQ_NOTOGRI_WORKFLOW_FIXTURE];
