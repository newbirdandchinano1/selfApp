---
version: 1
slug: "selfapp-components-tasks-weeklyfrogschedule-tsx"
primary_target: "selfApp/components/tasks/WeeklyFrogSchedule.tsx"
related_targets: []
---

## Scope
WeeklyFrogSchedule (tasks tab schedule surface). Visitor mode: Operate.

## Audience / job
Author uses the schedule to see today at a glance and place frogs on the day timeline. Success: scan today in one glance; expand into the day timeline without visual noise.

## Constraints
Day view is timeline-only (classic pocket grid removed in phase L). Minimal zoom mode stays the legacy compact focus. Slot dual-write may still run under the write flag for desktop compatibility. Inherit finance/task design tokens. iOS-first.

## Direction contract
THESIS: A day timeline — time leads, today is unmistakable, events read as painted spans on a vertical rail (semantic buckets + cards), not same-weight gray cells or pill-cluster chrome.
OWN-WORLD: Restrained palette (Palette primary + muted surfaces); Radius 2xl cards; soft hairlines; event cards with left accent rail + subject icons; tabular time; system SF via RN defaults.
STORY: Collapsed = today agenda with time rail (minimal); expanded = single-day timeline with all-day row + overlapping columns.
FIRST VIEWPORT: Card header (title + meta + 最简/时间线); below it either vertical today rows (time | title) or the day timeline; no chip wrap grid.
FORM: Extension of Tasks sectionCard world; code-led; no new brand.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
