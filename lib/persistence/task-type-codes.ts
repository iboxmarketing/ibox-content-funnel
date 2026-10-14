/**
 * Stable machine codes for Task Types (persisted as content_task_types.code,
 * write-once since draft migration 06). Persistence and the Task Bot
 * transition contract bind to these codes, never to display names. The
 * mapping from the current fixture names is used ONLY at the seeding /
 * migration boundary; a later step moves `code` onto TaskType itself
 * (contract §S5) so a rename can no longer detach anything.
 */
export const TASK_TYPE_CODE_BY_FIXTURE_NAME = {
  "Problem Split": "PROBLEM_SPLIT",
  "Knowledge Discovery": "KNOWLEDGE_DISCOVERY",
  Research: "RESEARCH",
  Blog: "BLOG",
  "Head Review": "HEAD_REVIEW",
  SEO: "SEO",
  Angle: "ANGLE",
  "Performance Consultation": "PERFORMANCE_CONSULTATION",
  "Destination Decision": "DESTINATION_DECISION",
  "Repurpose Map": "REPURPOSE_MAP",
  "Reel Script": "REEL_SCRIPT",
  Carousel: "CAROUSEL",
  "Text Post": "TEXT_POST",
  Planning: "PLANNING",
  Shoot: "SHOOT",
  Edit: "EDIT",
  Cover: "COVER",
  Caption: "CAPTION",
  "Distribution Plan": "DISTRIBUTION_PLAN",
  "Publish / Schedule": "PUBLISH_SCHEDULE",
  "Publish Check": "PUBLISH_CHECK",
  Learning: "LEARNING",
  "Republish / Fix Publish": "REPUBLISH_FIX_PUBLISH",
  YouTube: "YOUTUBE",
  "YouTube Outline": "YOUTUBE_OUTLINE",
  "Checklist / PDF Creation": "CHECKLIST_PDF_CREATION",
  "External Tool Setup": "EXTERNAL_TOOL_SETUP",
} as const;

export type TaskTypeCode = (typeof TASK_TYPE_CODE_BY_FIXTURE_NAME)[keyof typeof TASK_TYPE_CODE_BY_FIXTURE_NAME];

/** The two codes the Blog revision contract depends on (same literals as the SQL predicates). */
export const BLOG_TASK_TYPE_CODE = "BLOG" satisfies TaskTypeCode;
export const HEAD_REVIEW_TASK_TYPE_CODE = "HEAD_REVIEW" satisfies TaskTypeCode;

/** Same rule as the content_task_types.code CHECK. */
export const TASK_TYPE_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/;
