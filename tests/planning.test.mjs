import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const dir = mkdtempSync(join(tmpdir(), 'ibox-planning-'));
for (const name of ['work-calendar', 'planning-config', 'scheduling-engine']) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), 'utf8');
  writeFileSync(join(dir, `${name}.js`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText);
}
const require = createRequire(import.meta.url);
const { allocateWork, parseWorkWindows, wallClock } = require(join(dir, 'work-calendar.js'));
const { recalculateSchedule, calculateWorkflowDates, calculateRoleCapacity, applyScheduleOverrides, generatePublishingSlots, findNextAvailableSlot, slotKey } = require(join(dir, 'scheduling-engine.js'));
const { validatePlanningConfig } = require(join(dir, 'planning-config.js'));
after(() => rmSync(dir, { recursive: true, force: true }));
const calendar = { timezone: 'Asia/Tashkent', days: ['MON','TUE','WED','THU','FRI'], windows: parseWorkWindows('09:00-13:00|14:00-18:00'), holidays: [] };
const instant = (day, hour) => wallClock(day, hour * 60, calendar.timezone);
const rule = { ruleId: 'test-rule', platform: 'test-platform', contentType: 'DEFAULT', language: 'UZ', postsPerWeek: 5, preferredWeekdays: calendar.days, preferredTimes: ['11:00'], minimumGapHours: 4, priority: 1, active: true };
const item = { productionId: 'test-content', nodeId:'test-node', primaryContentType:'DEFAULT', primaryPlatform:'test-platform', language:'UZ', productionStatus:'backlog', publishability:'Publishable candidate', priorityBand:'P1', priorityScore:10, contentApprovalStatus:'Approved', targetPublishDate:'', productionStartDate:'', scheduleLocked:false, assignee:'', researchStatus:'', writingStatus:'', reviewStatus:'', deadline:'', clusterId:'', funnelStage:'', nodeRole:'', publishDate:'', sourceArticleNodeId:'' };
function dataset() {
  return { items: [structuredClone(item)], settings: Object.entries({TIMEZONE:'Asia/Tashkent', DEFAULT_WORKING_DAYS:calendar.days.join(','), WORK_INTERVALS:'09:00-13:00|14:00-18:00', GLOBAL_WORK_CALENDAR:'TRUE', HOURS_PER_WORKDAY:'8', DEFAULT_BUFFER_DAYS:'0', PUBLISH_BUFFER_DAYS:'0', PLANNING_START_DATE:'2026-10-01', PLANNING_HORIZON_DAYS:'30', DEFAULT_REVIEW_DAYS:'1'}).map(([key,value])=>({key,value,active:true})), team:[{employeeId:'test-owner', employeeName:'Test', role:'Writer', weeklyCapacityHours:40,maxParallelTasks:5,workingDays:calendar.days,workStart:'09:00',workEnd:'18:00',active:true}], workflow:[{stageId:'WRITING',stageName:'Writing',contentType:'DEFAULT',ownerRole:'Writer',stageOrder:1,durationWorkdays:1,dependencyStageIds:[],active:true},{stageId:'REVIEW',stageName:'Review',contentType:'DEFAULT',ownerRole:'Writer',stageOrder:2,durationWorkdays:-1,dependencyStageIds:['WRITING'],active:true}], publishingRules:[structuredClone(rule)], holidays:[], taskOverrides:[],channels:[],meta:{spreadsheetId:'test-only',loadedAt:'',warnings:[]},tools:[],contentNodes:[],canonicalProblems:[],contentClusters:[] };
}
test('lunch is excluded, exact 13:00 boundary is preserved',()=>{
  const a=allocateWork(instant('2026-10-01',9),240,calendar);assert.equal(a.endAt,new Date(instant('2026-10-01',13)).toISOString());
  const b=allocateWork(Date.parse(a.endAt),60,calendar);assert.equal(b.startAt,new Date(instant('2026-10-01',14)).toISOString());assert.equal(b.endAt,new Date(instant('2026-10-01',15)).toISOString());
});
test('weekends, holidays and reverse planning use identical work minutes',()=>{
  const c={...calendar,holidays:['2026-10-05']};
  const a=allocateWork(instant('2026-10-02',17),120,c);assert.equal(a.endAt,new Date(instant('2026-10-06',10)).toISOString());
  const b=allocateWork(Date.parse(a.endAt),120,c,-1);assert.equal(b.startAt,a.startAt);
});
test('overlapping windows and empty workdays fail without an unbounded loop',()=>{
  assert.throws(()=>parseWorkWindows('09:00-14:00|13:00-18:00'));
  assert.throws(()=>allocateWork(instant('2026-10-01',9),60,{...calendar,days:[]}));
});
test('dependency ordering is topological; parallel work joins at latest completion',()=>{
  const d=dataset(); d.workflow=[{...d.workflow[1],dependencyStageIds:['WRITING','VISUAL'],stageOrder:0},{...d.workflow[0],stageOrder:9},{...d.workflow[0],stageId:'VISUAL',durationWorkdays:2,stageOrder:8}];
  const stages=calculateWorkflowDates(item,d,'2026-10-01');const review=stages.find(s=>s.stageId==='REVIEW');
  assert.ok(Date.parse(review.startAt)>=Math.max(...stages.filter(s=>s.stageId!=='REVIEW').map(s=>Date.parse(s.endAt))));
  assert.equal(stages.find(s=>s.stageId==='WRITING').startAt,stages.find(s=>s.stageId==='VISUAL').startAt);
  d.workflow[1].dependencyStageIds=['REVIEW'];assert.throws(()=>calculateWorkflowDates(item,d),'cycle must fail');
});
test('custom windows and review defaults recalculate all dependent dates without mutation',()=>{
  const d=dataset();const before=JSON.stringify(d);const baseline=calculateWorkflowDates(item,d,'2026-10-01');
  const changed=applyScheduleOverrides(d,{settings:{WORK_INTERVALS:'09:00-13:00',DEFAULT_REVIEW_DAYS:'2'}});
  const next=calculateWorkflowDates(item,changed,'2026-10-01');assert.ok(next.at(-1).endAt>baseline.at(-1).endAt);assert.equal(JSON.stringify(d),before);
  const hours=calculateRoleCapacity([{item,stages:next}],changed).reduce((n,w)=>n+w.scheduledHours,0);assert.equal(hours,24);
});
test('cadence, active range, account limits and locked reservations are respected',()=>{
  const r={...rule,channelAccountId:'account',validFrom:'2026-10-06',validTo:'2026-10-09'};
  const channel={channelAccountId:'account',platform:rule.platform,accountName:'Test',timezone:'Asia/Tashkent',weeklyMax:2,minimumGapMinutes:240,active:true,publicUrl:''};
  const locked={...r,startsAt:new Date(instant('2026-10-06',11)).toISOString(),locked:true};
  const slots=generatePublishingSlots([r],'2026-10-05','2026-10-11',[locked],[channel]);assert.equal(slots.length,2);assert.equal(slots[0].startsAt,locked.startsAt);assert.ok(slots[1].startsAt>locked.startsAt);
  assert.equal(generatePublishingSlots([{...rule,postsPerWeek:3}],'2026-10-05','2026-10-11').length,3);
  assert.equal(generatePublishingSlots([rule],'2026-10-05','2026-10-11').length,5);
});
test('different accounts can share a time and content never publishes before ready',()=>{
  const rules=[rule,{...rule,ruleId:'second',platform:'second-platform'}];const slots=generatePublishingSlots(rules,'2026-10-05','2026-10-05');assert.equal(slots.length,2);
  assert.ok(findNextAvailableSlot('2026-10-05T04:00:00Z',rules[1],slots,new Set([slotKey(slots.find(s=>s.ruleId===rule.ruleId))])));
  assert.equal(findNextAvailableSlot('2026-10-05T12:00:00Z',rule,slots,new Set()),null);
});
test('shared schedule preserves locked date under cadence and calendar changes',()=>{
  const d=dataset();d.items[0]={...item,scheduleLocked:true,targetPublishDate:'2026-10-09T11:00:00+05:00'};
  const a=recalculateSchedule(d);const b=recalculateSchedule(d,{postsPerWeek:{'test-rule':1},settings:{WORK_INTERVALS:'09:00-12:00'}});
  assert.equal(a.plans[0].scheduledPublishDate,b.plans[0].scheduledPublishDate);assert.equal(b.plans[0].scheduledPublishDate,d.items[0].targetPublishDate);
});
test('configuration validation catches malformed input; blanks are allowed for optional channel data',()=>{
  const d=dataset();assert.deepEqual(validatePlanningConfig(d),[]);
  assert.ok(validatePlanningConfig(applyScheduleOverrides(d,{settings:{DEFAULT_WORKING_DAYS:''}})).length);
  assert.ok(validatePlanningConfig(applyScheduleOverrides(d,{weeklyCapacityHours:{'test-owner':NaN}})).length);
});
