### 🔴 Critical Gaps (must fix before implementation)

 1. render-goal location & distribution
 The plan says "TypeScript/Node script" but doesn't define where it lives. Is it:
 - Part of open-ralph-wiggum repo?
 - A standalone npm package?
 - A script in ~/.local/bin/?
 - Built into ralph-dev itself?

 This determines how users access it across projects.
 
 >Wire these into the ralph-dev / ralph itself. Under a utils. Ex: ralph-dev utils <cmd>

 2. render-goal output path → ralph integration
 The plan shows render-goal → _GOAL_rendered.md but doesn't specify:
 - Does render-goal overwrite the base file or write to a new path?
 - How does the ralph-run command use the rendered output?
 - Is the rendered file committed or is it a temp artifact?

 Current pattern: --prompt-template "./_GOAL_xxx.md"
 With injection: --prompt-template "./_GOAL_xxx.md" (render-goal runs first, overwrites?)

 > It is NOT override. It is like the handler bar getting replaced with if else and correct content then forward to the sub agents itself. 
 > Isn't we already having this implemented ? If not then do it. 

 3. Inventory format adapter missing
 The plan says source: inventory but inventory files vary wildly:
 - 3rd-parties-inventory.yml (beet-orches) — flat YAML list with status fields
> make it default name file , which can be override (like the ralph state-dir)
> make it to be inside of the state directory. 
 - bd JSONL — structured issues with deps, priority, status
> bd style , but just jsonl for now. 
 - Custom per-project


 "Next/prev tasks" has no deterministic ordering without knowing the schema. Need either:
 - A pluggable adapter (bd, yaml, jsonl)
 - Or the user specifies the sort field in .ralph-state.yml

> whenever creating the task , the sub agents / or you already inputting the dependencies / task id. 
> iteration worker will pick them up by these orders. 

Related to this: 
- add the intention file about this: 
We are NOT trying to designing a 100% perfect tasks DAG. 
We are covering that by the forward-backward thing. 
It is a non-deterministic DAG. 

 4. {{inject:*}} collision with ralph's {{iteration}}
 The _GOAL already uses {{iteration}} which ralph injects at runtime. The render-goal script must:
 - Resolve {{inject:*}} (render-time)
 - Pass through {{iteration}} untouched (runtime)

 This distinction is not stated in the plan.

> If the template file (_GOAL_) having any section should be inject , JUST inject it. 
> DO NOT try to smartly remove / update other parts. 
> FOLLOW templating AS-IS without any further logic apply. 
> we can do calculating on templating variable (like the mod value) , THEN find the part to inject it in. Nothing else. 

 ### 🟡 Missing Details (should clarify)

 5. Fallback when config files don't exist
 If .ralph-modulo.yml is missing, what happens?
 - Error? Pass through {{inject:modulo}} unresolved? (bad — exposes placeholder to agent)
 - Default to empty injection?

 Same for .ralph-state.yml.

 state: scalfold with schema + comment for others to remember to  put in. 
 modulo (also rename this , later on we will have more rules like iteration < x ; iteration >= y; ):
 - if we identified any inject:<rules> BUT not having that one in ralph-<name>.yml: 
 -- a. INIT that section with PLACEHOLDER prompt. 
 -- b. THEN before the running of the first iteration , IF IT still containing PLACEHOLDER. Raise exception. Stop immediately. 
 This is having 2 purpose: 
 a: reminds user on it schema and auto populate the needed fields; b: gate the run if it not defined. 

 6. Reminder: defined in config OR in _GOAL?
 The plan shows the reminder text in BOTH .ralph-state.yml AND inline in the _GOAL example. Which is the source of truth? If both, it's duplicated.

> As said. templating JUST blindly replaced. 
> if _GOAL fixed the % in once places , then templating in another places. YOUR implement just need to take care of the templating stuffs. 
    Leave the rest as-is. 

 7. Duplicate at values
 What if two modulos have at: 7? Error? Merge prompts? Last-wins?

Keep all. 

 8. T7 test criterion is vague
 "Verify output matches original" — the original is a monolithic _GOAL. The rendered output from base + configs should produce equivalent content, but line ordering
 and whitespace will differ. Need a diff-based or semantic comparison, not string equality.

Same as (6). Follow templating. 

 9. No global defaults location
 Where are the default .ralph-modulo.yml and .ralph-state.yml templates stored? Per-project? Or in a shared location (e.g., ~/.config/open-ralph-wiggum/defaults/)?

No global for now. 
Usually it is per project , per worktree / _GOAL file itself. 

---

REMEMBER to update these intention of mine into document as well ;
