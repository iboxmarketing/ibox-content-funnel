import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";

const dir = mkdtempSync(join(tmpdir(), "ibox-workflow-runtime-"));
for (const name of ["task-instance", "workflow-runtime"]) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { createTaskInstance, skipTaskInstance } = require(join(dir, "task-instance.js"));
const {
  getStartableSteps,
  getStepsGeneratedBy,
  buildTaskInstanceSeed,
  buildStandaloneTaskInstanceSeed,
  buildTransferCandidates,
  destinationFieldsForTaskType,
  applyContextTransfer,
} = require(join(dir, "workflow-runtime.js"));
after(() => rmSync(dir, { recursive: true, force: true }));

let tick = 0;
const fixedNow = () => `2026-10-08T04:00:${String(tick++).padStart(2, "0")}.000Z`;

// A small fixture mirroring the Qoldiq noto'g'ri branch structure:
// Blog --blocking--> {Head Review (blocking), SEO (non-blocking), Angle (non-blocking)}
// Head Review --blocking--> Repurpose Map
const TEMPLATE_ID = "wf-1";
function step(overrides) {
  return { templateId: TEMPLATE_ID, taskTypeId: "tt-x", order: 0, overrides: undefined, ...overrides };
}
const researchStep = step({ id: "step-research", nameTemplate: "Research", dependsOn: [], blocking: true, skippable: false });
const blogStep = step({ id: "step-blog", nameTemplate: "Blog", dependsOn: ["step-research"], blocking: true, skippable: false });
const headReviewStep = step({ id: "step-head-review", nameTemplate: "Head Review", dependsOn: ["step-blog"], blocking: true, skippable: false });
const seoStep = step({ id: "step-seo", nameTemplate: "SEO", dependsOn: ["step-blog"], blocking: false, skippable: true });
const angleStep = step({ id: "step-angle", nameTemplate: "Angle", dependsOn: ["step-blog"], blocking: false, skippable: true });
const repurposeStep = step({ id: "step-repurpose", nameTemplate: "Repurpose Map", dependsOn: ["step-head-review"], blocking: false, skippable: true });
const TEMPLATE = {
  id: TEMPLATE_ID,
  name: "Fixture",
  description: "",
  moduleType: "OTHER",
  version: 1,
  isActive: true,
  steps: [researchStep, blogStep, headReviewStep, seoStep, angleStep, repurposeStep],
  createdAt: "",
  updatedAt: "",
};

function instanceFor(step_, overrides = {}) {
  return createTaskInstance({
    taskTypeId: step_.taskTypeId,
    workflowTemplateId: TEMPLATE_ID,
    workflowStepId: step_.id,
    title: step_.nameTemplate,
    assignee: null,
    deadline: null,
    fieldValues: {},
    customFields: [],
    links: [],
    sourceTaskId: null,
    ...overrides,
  }, fixedNow);
}

function settled(instance) {
  return { ...instance, status: "DONE", outcome: "COMPLETED" };
}

test("getStartableSteps returns only dependency-free steps with no instance yet", () => {
  assert.deepEqual(getStartableSteps(TEMPLATE, []).map((s) => s.id), ["step-research"]);
  const researchInstance = instanceFor(researchStep);
  assert.deepEqual(getStartableSteps(TEMPLATE, [researchInstance]), []);
});

test("getStepsGeneratedBy returns [] for a sourceInstance with no workflowStepId", () => {
  const instance = settled(instanceFor(researchStep, { workflowStepId: null }));
  assert.deepEqual(getStepsGeneratedBy(TEMPLATE, [], instance), []);
});

// --- Multiplicity: one WorkflowStep, many TaskInstances ---

test("one WorkflowStep (Blog) can have multiple TaskInstances, each with its own unique runtime identity", () => {
  const research = settled(instanceFor(researchStep));
  const blogA = instanceFor(blogStep, { sourceTaskId: research.id, title: "Blog A" });
  const blogB = instanceFor(blogStep, { sourceTaskId: research.id, title: "Blog B" });
  const blogC = instanceFor(blogStep, { sourceTaskId: research.id, title: "Blog C" });
  assert.notEqual(blogA.id, blogB.id);
  assert.notEqual(blogB.id, blogC.id);
  const allSameStep = [blogA, blogB, blogC].every((b) => b.workflowStepId === "step-blog");
  assert.ok(allSameStep);
});

test("Research completion generates the Blog step as a candidate, independent of how many Blog instances already exist for it", () => {
  const research = settled(instanceFor(researchStep));
  const existingBlog = instanceFor(blogStep, { sourceTaskId: research.id });
  // Even though a Blog instance already exists from this same Research,
  // getStepsGeneratedBy must still report Blog as a generatable step --
  // Sprint 2's "already has an instance -> never again" rule does not
  // apply once multiple occurrences are expected.
  const generated = getStepsGeneratedBy(TEMPLATE, [existingBlog], research).map((s) => s.id);
  assert.deepEqual(generated, ["step-blog"]);
});

test("a downstream task depends on the SPECIFIC source TaskInstance that generated it, not merely on the WorkflowStep", () => {
  const research1 = settled(instanceFor(researchStep, { title: "Research 1" }));
  const research2 = settled(instanceFor(researchStep, { title: "Research 2" }));
  const blogFromResearch2 = instanceFor(blogStep, { sourceTaskId: research2.id, title: "Blog from R2" });

  // A Reel generated "from Blog" must resolve relative to blogFromResearch2
  // specifically -- getStepsGeneratedBy(template, allInstances, blogFromResearch2settled)
  // must only ever consider blogFromResearch2's own lineage (research2),
  // never research1, regardless of research1's settlement state.
  const settledBlog = settled(blogFromResearch2);
  const allInstances = [research1, research2, settledBlog];
  const headReview = getStepsGeneratedBy(TEMPLATE, allInstances, settledBlog).find((s) => s.id === "step-head-review");
  assert.ok(headReview, "Head Review must be generated from this specific settled Blog");
});

test("an unrelated instance/chain never blocks or affects another chain's eligibility", () => {
  // Chain A: research settled, blog NOT settled yet.
  const researchA = settled(instanceFor(researchStep, { title: "Research A" }));
  const blogA = instanceFor(blogStep, { sourceTaskId: researchA.id, title: "Blog A" }); // not settled

  // Chain B: a completely separate Research+Blog+HeadReview chain, fully settled.
  const researchB = settled(instanceFor(researchStep, { title: "Research B" }));
  const blogB = settled(instanceFor(blogStep, { sourceTaskId: researchB.id, title: "Blog B" }));

  const allInstances = [researchA, blogA, researchB, blogB];
  // Chain A's Blog is not settled, so nothing downstream of IT should be
  // generated by blogA regardless of chain B's state.
  const generatedFromBlogA = getStepsGeneratedBy(TEMPLATE, allInstances, settled(blogA)).map((s) => s.id).sort();
  assert.deepEqual(generatedFromBlogA, ["step-angle", "step-head-review", "step-seo"]);
  // And chain B's settlement must not have produced a phantom dependency
  // satisfaction for research A's lineage.
  const generatedFromResearchA = getStepsGeneratedBy(TEMPLATE, allInstances, researchA).map((s) => s.id);
  assert.deepEqual(generatedFromResearchA, ["step-blog"]);
});

test("once Blog is DONE, Head Review / SEO / Angle all become eligible in parallel -- Repurpose does not", () => {
  const research = settled(instanceFor(researchStep));
  const blogInstance = settled(instanceFor(blogStep, { sourceTaskId: research.id }));
  const generated = getStepsGeneratedBy(TEMPLATE, [research, blogInstance], blogInstance).map((s) => s.id).sort();
  assert.deepEqual(generated, ["step-angle", "step-head-review", "step-seo"]);
});

test("Repurpose Map stays ineligible until Head Review is settled in the SAME lineage, independent of SEO/Angle", () => {
  const research = settled(instanceFor(researchStep));
  const blogInstance = settled(instanceFor(blogStep, { sourceTaskId: research.id }));
  const seoInstance = settled(instanceFor(seoStep, { sourceTaskId: blogInstance.id }));
  const angleInstance = settled(instanceFor(angleStep, { sourceTaskId: blogInstance.id }));
  const allInstances = [research, blogInstance, seoInstance, angleInstance];
  const generatedFromBlog = getStepsGeneratedBy(TEMPLATE, allInstances, blogInstance).map((s) => s.id);
  assert.ok(!generatedFromBlog.includes("step-repurpose"));
});

test("Repurpose Map becomes eligible once Head Review (in the same lineage) is DONE", () => {
  const research = settled(instanceFor(researchStep));
  const blogInstance = settled(instanceFor(blogStep, { sourceTaskId: research.id }));
  const headReviewInstance = settled(instanceFor(headReviewStep, { sourceTaskId: blogInstance.id }));
  const allInstances = [research, blogInstance, headReviewInstance];
  const generated = getStepsGeneratedBy(TEMPLATE, allInstances, headReviewInstance).map((s) => s.id);
  assert.deepEqual(generated, ["step-repurpose"]);
});

test("a SKIPPED dependency satisfies a blocking dependent exactly like DONE does", () => {
  const research = settled(instanceFor(researchStep));
  const blogInstance = skipTaskInstance(instanceFor(blogStep, { sourceTaskId: research.id }), "Not needed", fixedNow);
  const generated = getStepsGeneratedBy(TEMPLATE, [research, blogInstance], blogInstance).map((s) => s.id).sort();
  assert.deepEqual(generated, ["step-angle", "step-head-review", "step-seo"]);
});

test("getStepsGeneratedBy never surfaces anything beyond one hop", () => {
  const research = settled(instanceFor(researchStep));
  const generated = getStepsGeneratedBy(TEMPLATE, [research], research).map((s) => s.id);
  assert.deepEqual(generated, ["step-blog"]);
  assert.ok(!generated.includes("step-repurpose"));
});

// --- seed / context transfer ---

const BLOG_TASK_TYPE = {
  id: "tt-blog",
  requiredFields: [{ id: "blog-link", label: "Blog Link", type: "URL", required: true }, { id: "blog-title", label: "Blog Title", type: "TEXT", required: true }],
  optionalFields: [],
  defaultAssigneeRule: { kind: "DEFAULT_CONTENT_OWNER" },
};
const SEO_TASK_TYPE = {
  id: "tt-seo",
  requiredFields: [{ id: "seo-notes", label: "SEO Notes", type: "LONG_TEXT", required: true }],
  optionalFields: [],
  defaultAssigneeRule: { kind: "FIXED_ROLE", role: "SEO" },
};

test("buildTaskInstanceSeed leaves deadline null and uses a FIXED_ROLE as a placeholder assignee", () => {
  const seed = buildTaskInstanceSeed(seoStep, SEO_TASK_TYPE, "ti-source");
  assert.equal(seed.deadline, null);
  assert.equal(seed.assignee, "SEO");
  assert.equal(seed.sourceTaskId, "ti-source");
  assert.equal(seed.title, "SEO");
  assert.equal(seed.contentRef, null);
  assert.deepEqual(seed.relatedEntityRefs, []);
});

test("buildTaskInstanceSeed accepts an explicit contentRef and relatedEntityRefs", () => {
  const contentRef = { entityType: "KNOWLEDGE_NODE", entityId: "node-1" };
  const related = [{ entityType: "KNOWLEDGE_NODE", entityId: "node-2" }];
  const seed = buildTaskInstanceSeed(blogStep, BLOG_TASK_TYPE, "ti-source", contentRef, related);
  assert.deepEqual(seed.contentRef, contentRef);
  assert.deepEqual(seed.relatedEntityRefs, related);
});

test("buildTaskInstanceSeed assignee is null for DEFAULT_CONTENT_OWNER/MANUAL -- no real assignee lookup happens", () => {
  const seed = buildTaskInstanceSeed(blogStep, BLOG_TASK_TYPE, null);
  assert.equal(seed.assignee, null);
});

test("buildTransferCandidates only includes fields with a non-empty value, never a generic blob", () => {
  const blogInstance = instanceFor(blogStep, {
    taskTypeId: "tt-blog",
    fieldValues: { "blog-link": "https://example.com/post", "blog-title": "" },
  });
  const candidates = buildTransferCandidates(blogInstance, BLOG_TASK_TYPE);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].sourceFieldId, "blog-link");
  assert.equal(candidates[0].value, "https://example.com/post");
});

test("destinationFieldsForTaskType exposes mappable target fields", () => {
  const fields = destinationFieldsForTaskType(SEO_TASK_TYPE).map((f) => f.id);
  assert.deepEqual(fields, ["seo-notes"]);
});

test("applyContextTransfer transfers only explicitly selected+mapped fields and records provenance", () => {
  const blogInstance = instanceFor(blogStep, { taskTypeId: "tt-blog", fieldValues: { "blog-link": "https://example.com/post", "blog-title": "How to X" } });
  const seed = buildTaskInstanceSeed(seoStep, SEO_TASK_TYPE, blogInstance.id);
  const { fieldValues, fieldProvenance } = applyContextTransfer(seed, blogInstance, [{ sourceFieldId: "blog-link", destinationFieldId: "seo-notes" }]);
  assert.equal(fieldValues["seo-notes"], "https://example.com/post");
  assert.equal("blog-title" in fieldValues, false, "an unselected candidate must never be transferred");
  assert.deepEqual(fieldProvenance, [{ fieldId: "seo-notes", sourceTaskId: blogInstance.id, sourceFieldId: "blog-link" }]);
});

test("applyContextTransfer with no selections transfers nothing -- there is no automatic transfer", () => {
  const blogInstance = instanceFor(blogStep, { taskTypeId: "tt-blog", fieldValues: { "blog-link": "https://example.com/post" } });
  const seed = buildTaskInstanceSeed(seoStep, SEO_TASK_TYPE, blogInstance.id);
  const { fieldValues, fieldProvenance } = applyContextTransfer(seed, blogInstance, []);
  assert.deepEqual(fieldValues, {});
  assert.deepEqual(fieldProvenance, []);
});

// --- Sprint 4 (section 11): sibling convergence via contentRef, e.g.
// Destination Decision waiting on Blog + Angle + Performance Consultation
// (three siblings under one Blog, not ancestors of each other).

const CONVERGE_TEMPLATE_ID = "wf-converge";
function convergeStep(overrides) {
  return { templateId: CONVERGE_TEMPLATE_ID, taskTypeId: "tt-x", order: 0, overrides: undefined, ...overrides };
}
const cBlogStep = convergeStep({ id: "c-blog", nameTemplate: "Blog", dependsOn: [], blocking: true, skippable: false });
const cAngleStep = convergeStep({ id: "c-angle", nameTemplate: "Angle", dependsOn: ["c-blog"], blocking: true, skippable: false });
const cPerfStep = convergeStep({ id: "c-perf", nameTemplate: "Performance Consultation", dependsOn: ["c-blog"], blocking: true, skippable: false });
const cHeadReviewStep = convergeStep({ id: "c-head-review", nameTemplate: "Head Review", dependsOn: ["c-blog"], blocking: true, skippable: false });
const cDestinationDecisionStep = convergeStep({ id: "c-dest-decision", nameTemplate: "Destination Decision", dependsOn: ["c-blog", "c-angle", "c-perf"], blocking: true, skippable: false });
const cRepurposeStep = convergeStep({ id: "c-repurpose", nameTemplate: "Repurpose Map", dependsOn: ["c-head-review", "c-dest-decision"], blocking: false, skippable: true });
const CONVERGE_TEMPLATE = {
  id: CONVERGE_TEMPLATE_ID, name: "Converge", description: "", moduleType: "OTHER", version: 1, isActive: true,
  steps: [cBlogStep, cAngleStep, cPerfStep, cHeadReviewStep, cDestinationDecisionStep, cRepurposeStep], createdAt: "", updatedAt: "",
};

const NODE_REF = { entityType: "KNOWLEDGE_NODE", entityId: "node-1" };
const OTHER_NODE_REF = { entityType: "KNOWLEDGE_NODE", entityId: "node-2" };

function cInstanceFor(step_, overrides = {}) {
  return createTaskInstance({
    taskTypeId: step_.taskTypeId, workflowTemplateId: CONVERGE_TEMPLATE_ID, workflowStepId: step_.id, title: step_.nameTemplate,
    assignee: null, deadline: null, fieldValues: {}, customFields: [], links: [], sourceTaskId: null, contentRef: NODE_REF, ...overrides,
  }, fixedNow);
}

test("Destination Decision stays ineligible until Blog + Angle + Performance Consultation are ALL settled for the same branch", () => {
  const blog = settled(cInstanceFor(cBlogStep));
  const angle = settled(cInstanceFor(cAngleStep, { sourceTaskId: blog.id }));
  // Performance Consultation not done yet.
  const generated = getStepsGeneratedBy(CONVERGE_TEMPLATE, [blog, angle], angle).map((s) => s.id);
  assert.deepEqual(generated, [], "Destination Decision must wait for Performance Consultation too");
});

test("Destination Decision becomes eligible once all three siblings are settled, resolved via shared contentRef (not ancestor lineage)", () => {
  const blog = settled(cInstanceFor(cBlogStep));
  const angle = settled(cInstanceFor(cAngleStep, { sourceTaskId: blog.id }));
  const perf = settled(cInstanceFor(cPerfStep, { sourceTaskId: blog.id }));
  // Whichever of Angle/Performance Consultation completes LAST is the one
  // whose own lineage (blog -> itself) does NOT contain the other sibling --
  // this only works via the contentRef rule, not ancestor walking.
  const generatedFromPerf = getStepsGeneratedBy(CONVERGE_TEMPLATE, [blog, angle, perf], perf).map((s) => s.id);
  assert.deepEqual(generatedFromPerf, ["c-dest-decision"]);
});

test("Destination Decision from a DIFFERENT Blog (different contentRef) never satisfies this Blog's convergence", () => {
  const blog = settled(cInstanceFor(cBlogStep));
  const angle = settled(cInstanceFor(cAngleStep, { sourceTaskId: blog.id }));
  // Performance Consultation exists but for an UNRELATED KnowledgeNode/Blog.
  const otherBlog = settled(cInstanceFor(cBlogStep, { contentRef: OTHER_NODE_REF }));
  const unrelatedPerf = settled(cInstanceFor(cPerfStep, { sourceTaskId: otherBlog.id, contentRef: OTHER_NODE_REF }));
  const generated = getStepsGeneratedBy(CONVERGE_TEMPLATE, [blog, angle, otherBlog, unrelatedPerf], angle).map((s) => s.id);
  assert.deepEqual(generated, [], "a Performance Consultation from a different Blog must never satisfy this branch");
});

test("Repuropse Map waits on BOTH Head Review and Destination Decision, each possibly arriving via a different lineage", () => {
  const blog = settled(cInstanceFor(cBlogStep));
  const angle = settled(cInstanceFor(cAngleStep, { sourceTaskId: blog.id }));
  const perf = settled(cInstanceFor(cPerfStep, { sourceTaskId: blog.id }));
  const headReview = settled(cInstanceFor(cHeadReviewStep, { sourceTaskId: blog.id }));
  // Destination Decision is generated FROM Performance Consultation's lineage (its sourceTaskId), not Head Review's.
  const destinationDecision = settled(cInstanceFor(cDestinationDecisionStep, { sourceTaskId: perf.id }));
  const allInstances = [blog, angle, perf, headReview, destinationDecision];

  // From Head Review's completion: Destination Decision is a SIBLING
  // (different lineage), resolved via contentRef.
  const generatedFromHeadReview = getStepsGeneratedBy(CONVERGE_TEMPLATE, allInstances, headReview).map((s) => s.id);
  assert.deepEqual(generatedFromHeadReview, ["c-repurpose"]);

  // From Destination Decision's completion: Head Review is a cousin
  // (also resolved via contentRef, not lineage).
  const generatedFromDestinationDecision = getStepsGeneratedBy(CONVERGE_TEMPLATE, allInstances, destinationDecision).map((s) => s.id);
  assert.deepEqual(generatedFromDestinationDecision, ["c-repurpose"]);
});

// --- buildStandaloneTaskInstanceSeed (section 9: Destination-creation tasks) ---

test("buildStandaloneTaskInstanceSeed has no workflowStepId/workflowTemplateId -- it is not governed by any WorkflowTemplate", () => {
  const seed = buildStandaloneTaskInstanceSeed(SEO_TASK_TYPE, "Checklist / PDF Creation", "ti-dest-decision-1", { entityType: "DESTINATION", entityId: "dest-1" });
  assert.equal(seed.workflowStepId, null);
  assert.equal(seed.workflowTemplateId, null);
  assert.equal(seed.title, "Checklist / PDF Creation");
  assert.equal(seed.sourceTaskId, "ti-dest-decision-1");
  assert.deepEqual(seed.contentRef, { entityType: "DESTINATION", entityId: "dest-1" });
});
