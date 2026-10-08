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
const { createTaskInstance, markTaskInstanceDone, skipTaskInstance } = require(join(dir, "task-instance.js"));
const {
  getEligibleNextSteps,
  getImmediateNextStepsAfterSettlement,
  getStartableSteps,
  buildTaskInstanceSeed,
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
const blogStep = step({ id: "step-blog", nameTemplate: "Blog", dependsOn: [], blocking: true, skippable: false });
const headReviewStep = step({ id: "step-head-review", nameTemplate: "Head Review", dependsOn: ["step-blog"], blocking: true, skippable: false });
const seoStep = step({ id: "step-seo", nameTemplate: "SEO", dependsOn: ["step-blog"], blocking: false, skippable: true });
const angleStep = step({ id: "step-angle", nameTemplate: "Angle", dependsOn: ["step-blog"], blocking: false, skippable: true });
const repurposeStep = step({ id: "step-repurpose", nameTemplate: "Repurpose Map", dependsOn: ["step-head-review"], blocking: false, skippable: true });
const TEMPLATE = { id: TEMPLATE_ID, name: "Fixture", description: "", moduleType: "OTHER", version: 1, isActive: true, steps: [blogStep, headReviewStep, seoStep, angleStep, repurposeStep], createdAt: "", updatedAt: "" };

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

test("getStartableSteps returns only dependency-free steps with no instance yet", () => {
  assert.deepEqual(getStartableSteps(TEMPLATE, []).map((s) => s.id), ["step-blog"]);
  const blogInstance = instanceFor(blogStep);
  assert.deepEqual(getStartableSteps(TEMPLATE, [blogInstance]), []);
});

test("before Blog is done, none of its dependents are eligible", () => {
  assert.deepEqual(getEligibleNextSteps(TEMPLATE, []).map((s) => s.id), ["step-blog"]);
});

test("once Blog is DONE, Head Review / SEO / Angle all become eligible in parallel -- Repurpose does not", () => {
  const blogInstance = markTaskInstanceDone(instanceFor(blogStep), fixedNow);
  const eligible = getEligibleNextSteps(TEMPLATE, [blogInstance]).map((s) => s.id).sort();
  assert.deepEqual(eligible, ["step-angle", "step-head-review", "step-seo"]);
});

test("getImmediateNextStepsAfterSettlement scopes to only the steps that depend on the just-settled step", () => {
  const blogInstance = markTaskInstanceDone(instanceFor(blogStep), fixedNow);
  const immediate = getImmediateNextStepsAfterSettlement(TEMPLATE, [blogInstance], "step-blog").map((s) => s.id).sort();
  assert.deepEqual(immediate, ["step-angle", "step-head-review", "step-seo"]);
});

test("Repurpose Map stays ineligible until Head Review is settled, independent of SEO/Angle", () => {
  const blogInstance = markTaskInstanceDone(instanceFor(blogStep), fixedNow);
  const seoInstance = markTaskInstanceDone(instanceFor(seoStep), fixedNow);
  const angleInstance = markTaskInstanceDone(instanceFor(angleStep), fixedNow);
  const eligible = getEligibleNextSteps(TEMPLATE, [blogInstance, seoInstance, angleInstance]).map((s) => s.id);
  assert.ok(!eligible.includes("step-repurpose"), "SEO/Angle completion must not unlock Repurpose");
  assert.ok(eligible.includes("step-head-review"), "Head Review is still outstanding and must remain eligible");
});

test("Repurpose Map becomes eligible once Head Review is DONE", () => {
  const blogInstance = markTaskInstanceDone(instanceFor(blogStep), fixedNow);
  const headReviewInstance = markTaskInstanceDone(instanceFor(headReviewStep), fixedNow);
  const immediate = getImmediateNextStepsAfterSettlement(TEMPLATE, [blogInstance, headReviewInstance], "step-head-review").map((s) => s.id);
  assert.deepEqual(immediate, ["step-repurpose"]);
});

test("a SKIPPED dependency satisfies a blocking dependent exactly like DONE does", () => {
  const blogInstance = skipTaskInstance(instanceFor(blogStep), "Blog not needed this time", fixedNow);
  const eligible = getEligibleNextSteps(TEMPLATE, [blogInstance]).map((s) => s.id).sort();
  assert.deepEqual(eligible, ["step-angle", "step-head-review", "step-seo"]);
});

test("a step that already has an instance (any status) is never re-surfaced as eligible", () => {
  const blogInstance = markTaskInstanceDone(instanceFor(blogStep), fixedNow);
  const headReviewInstance = instanceFor(headReviewStep); // ASSIGNED, not yet settled
  const eligible = getEligibleNextSteps(TEMPLATE, [blogInstance, headReviewInstance]).map((s) => s.id).sort();
  assert.deepEqual(eligible, ["step-angle", "step-seo"]);
});

test("getEligibleNextSteps never surfaces anything beyond one hop (no pre-created future graph)", () => {
  const eligible = getEligibleNextSteps(TEMPLATE, []).map((s) => s.id);
  assert.deepEqual(eligible, ["step-blog"]);
  assert.ok(!eligible.includes("step-repurpose"));
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
});

test("buildTaskInstanceSeed assignee is null for DEFAULT_CONTENT_OWNER/MANUAL -- no real assignee lookup happens", () => {
  const seed = buildTaskInstanceSeed(blogStep, BLOG_TASK_TYPE, null);
  assert.equal(seed.assignee, null);
});

test("buildTransferCandidates only includes fields with a non-empty value, never a generic blob", () => {
  let blogInstance = instanceFor(blogStep, {
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
