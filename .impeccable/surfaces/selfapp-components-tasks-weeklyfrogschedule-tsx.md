---
version: 1
slug: "selfapp-components-tasks-weeklyfrogschedule-tsx"
primary_target: "selfApp/components/tasks/WeeklyFrogSchedule.tsx"
related_targets: []
---

## Scope
WeeklyFrogSchedule (tasks tab course/schedule surface). Visitor mode: Operate.

## Audience / job
Author uses the schedule to see today at a glance and place frogs on a 3-day grid. Success: scan today in one glance; expand and read the grid without visual noise.

## Constraints
UI polish only — no placement, load, copy-week, or completion logic changes. Inherit finance/task design tokens. iOS-first.

## Direction contract
THESIS: A pocket timetable — time leads, today is unmistakable, occupied blocks read as painted hours not bordered chips; refuses same-weight gray cells and pill-cluster chrome.
OWN-WORLD: Restrained palette (Palette primary + muted surfaces); Radius 2xl cards; soft hairlines; placement blocks with left accent rail; tabular time; system SF via RN defaults.
STORY: Collapsed = today agenda with time rail; expanded = clean 3-day grid with strong today column and calm empty slots.
FIRST VIEWPORT: Card header (title + meta + expand); below it either vertical today rows (time | title) or empty invite; no chip wrap grid.
FORM: Extension of Tasks sectionCard world; code-led; no new brand.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
