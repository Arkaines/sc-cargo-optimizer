# Cargo packing rewrite — design

**Status: implemented.** See commits `ed53cc7` (baseline non-regression suite) through the Task 7 wrap-up commit on branch `worktree-cargo-packing-rewrite` for the full sequence (Tasks 2–7). Final measured results: Hull B (16 modules, 10 real contracts) 0 conflicts; Raft (1 module, 10 real contracts) 4 conflicts (down from a pre-rewrite best of 9) — see Section 6 for the full before/after breakdown.

## Context

`js/cargo-packing.js` decides where each mission's cargo goes inside the selected ship's real cargo holds (dimensions from FleetYards.net), so the player never loses track of what's stored where during a route, and — the actual hard requirement — never has to move a crate to reach another one when that's avoidable.

Across the current session, the module went through several iterations (chronological greedy placement, per-mission zone reservation along a single axis, hierarchical position comparison, various 2D floor-plan attempts). Each iteration fixed a real bug, but the fundamental architecture — decide each crate's position one at a time, in route order, checking only crates *currently* on board — kept resurfacing avoidable conflicts that a human packer, who mentally plans the whole load before touching a single crate, would never hit. Best results reached so far on real user data: Hull B (16 modules, 10 contracts) 0 conflicts; Raft (1 module, 10 contracts) 9 conflicts, using only width-based separation between contracts.

This spec replaces that architecture with a static, full-manifest planner, as agreed with the user.

## 1. Core principle: static single-pass planning

The full cargo manifest (every crate's quantity, pickup stop, dropoff stop, owning mission) is known before packing starts — this is not a true online bin-packing problem. The new planner computes the **final position of every crate in one pass**, before simulating the route at all. The existing stop-by-stop route simulation (used to render "plan de chargement arrêt par arrêt" and the 3D viewer) is no longer a search — it becomes a **replay** of the precomputed plan: at each stop it marks crates present/absent per the plan, using the same grid occupancy bookkeeping as today.

## 2. The grid is a real 3D volume: width × height × length

- **Length** (the longest cell dimension, as today) is the access/depth axis: smaller coordinate = closer to the access point, used to judge whether one crate blocks another (unchanged logic from today: `isBlocking`).
- **Width and height together** are the two axes used to separate different missions' cargo in space. Height (Z, the real vertical/gravity axis) is *not* reserved exclusively for one mission's own crate-on-crate stacking — a different mission's crate can occupy the same width position at a different height, subject to the temporal safety rule below.

## 3. Mission zone reservation (before any crate is placed)

Before placing any crate, every mission gets a reserved zone: a block of the ship's volume sized to its real SCU need (never a full axis by default — a previous version that reserved a whole depth-slice per contract wasted most of a ship's real capacity).

**Tier 1 — independent lane:** pack missions (largest total SCU first) into independent width-lanes, each spanning the **full length** of the module (so the mission has room to spread its own crates by dropoff order) and, by default, the full height for its own use. Best-fit: prefer the smallest lane that still fits the mission whole; only share a lane between two missions when no independent lane is left.

**Tier 2 — safe cross-mission stacking:** for a mission that doesn't fit as its own independent lane, look for a mission already placed (a "host" — tier-1 or itself already stacked as a tier-2 guest) whose overall time on board (from its earliest pickup to its latest dropoff) **fully contains** the candidate's time on board. If found, give the candidate a zone at the same width position and length range as the host, at the next height level up. This is only valid because the host is guaranteed present for the candidate's entire stay — the candidate's crates never lose support mid-route. Stacking can go more than one level deep (a guest can itself host a further guest) whenever the containment check passes at each level.

Reserving this zone only guarantees *temporal* safety (the host stays long enough). It does not override the crate-level stacking rule from Section 4 (a crate may only rest on an equal-or-larger crate) — placing the candidate's actual crates inside this zone still goes through the normal search from Section 4, and a position there is only valid if both rules hold. If no position inside the zone satisfies the size rule, that mission falls through to the ship-wide search in Section 5 like any other unfitted mission.

A mission with no valid tier-1 or tier-2 zone falls back to the ship-wide search described in Section 5, exactly like an unzoned mission today.

## 4. Placing crates inside a mission's zone

Unchanged from what's already been verified working this session, just re-homed inside the (now real 3D) zone:

- Crate footprint/height are FleetYards-verified real dimensions, never guessed. A crate only rotates flat (yaw), never on its side.
- **Stacking rule (corrected this session):** a crate may only rest on a crate of **equal or larger** SCU size — never a smaller one. (Previously implemented backwards as "strictly smaller only", which wrongly forbade stacking two crates of the same size.)
- Ideal depth-position for a crate = its rank among its *own* mission's crates by dropoff order, rescaled to its zone's actual depth range (not a fraction of the whole route) — this is what fixed intra-mission self-conflicts earlier this session and must carry over.
- Candidate positions are compared with a **strict hierarchical (lexicographic) ordering**, never an additive score: safety first, then delivery-order fit, then floor-before-stacked, then same-mission clustering, then general compactness. An additive score was tried and measurably regressed a real scenario (a compactness bonus outweighed a delivery-order constraint) — this must not be reintroduced.

## 5. Last resort: only when the entire ship is genuinely full

If, after trying every position within a mission's own zone (tiers 1 and 2), a crate still doesn't fit, the planner must search **the entire ship** — every module, every zone, every safe cross-mission stacking option — before accepting any conflict. A conflict is only ever accepted when this ship-wide search confirms there is truly no free position anywhere, not merely that the crate's own zone is full.

When a genuine conflict is unavoidable, the planner keeps whichever position delays the conflict the latest (the blocking crate leaves as late in the route as possible) and reports it clearly to the user (which crate, which stop, blocked by what) — computed up front, before the route simulation runs, not discovered mid-route.

## 6. Verification

Before considering this done, re-run the real data already gathered this session and require these to hold:
- Hull B (10 real contracts, 16 modules): 0 conflicts (already the current best; must not regress).
- Raft (10 real contracts, 1 module): must at least match 9 conflicts; expected to improve now that height is available for cross-mission stacking and the stacking rule is corrected.
- The 60-mission adversarial stress test (all missions' pickup/dropoff intervals crossing) and the existing realistic-scenario tests: no regression.
- Every improvement claim must be backed by an actual before/after run of these scenarios, not assumed from the design alone.

**Final measured results (Task 7, `node scripts/cargo-packing-tests.cjs`, 22/22 passing):**
- Hull B: **0 conflicts** — unchanged; already 0 before this rewrite too (Hull B has enough modules that the pre-existing bugs never bit it).
- Raft: **4 conflicts** — down from a pre-rewrite baseline of 9. Both numbers are enforced as assertions in `scripts/cargo-packing-tests.cjs` (not just narrative claims); see that file's own comments for the intermediate measurements taken after each task in the rewrite.
- **`worstConflictDropoff` polarity fix (Task 6bis):** during verification, a second real bug was found beyond the rewrite's original scope — `worstConflictDropoff`'s comparison of blocker-vs-candidate dropoff order was inverted, so a position that was actually risky could score `Infinity` (falsely "safe") and be preferred over a genuinely safe one. This wasn't part of the design gap this rewrite originally targeted (Sections 1–4 above), but it directly serves Section 5's requirement to "never accept an avoidable conflict" — the ship-wide last-resort search is only as good as its severity scoring, and an inverted polarity there could silently accept an avoidable conflict while reporting the wrong crate as the blocker. Fixing it took Raft from 9 to 4 conflicts with no further architecture change.
- Browser-level verification (the 60-mission adversarial stress test and small realistic scenarios, both originally run ad hoc in a browser via Puppeteer during this session) could not be re-run for Task 7's final wrap-up: no Puppeteer-capable browser launch succeeded in that verification environment (see the Task 7 report for what was attempted). Only the Node-based `scripts/cargo-packing-tests.cjs` suite is re-verified as of the final commit; the browser-level scenarios remain the one outstanding verification gap.

## 7. Scope

Rewrite `js/cargo-packing.js` in place (same file). Its integration points — `js/app.js` (`runCargoPacking`, `buildCargoItemStopIndex`) and `js/cargo-viewer.js` (3D rendering) — are not expected to need changes; `simulateRoutePacking`'s external inputs/outputs (cargo entries in, `{ placements, unplaced, conflicts, peakStepIndex }` out) stay the same shape. No other part of the app changes for this work.
