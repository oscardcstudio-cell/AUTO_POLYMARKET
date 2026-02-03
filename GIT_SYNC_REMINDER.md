# ⚠️ GIT SYNC REMINDER

**Status:** PENDING
**Due:** Tomorrow (Next Session)

## Context
The user has uncommitted/unpushed changes on another computer (using Antigravity clone) from ~18:30.
These changes need to be retrieved and merged with the work done in this session.

## Action Plan
1. **DO NOT** force push from this machine yet if you are unsure.
2. On this machine (Oscar's current PC):
   - Commit all current changes locally (already done via auto-save scripts, but double check).
   - Create a backup branch just in case: `git checkout -b backup_session_feb02`
3. Tomorrow:
   - Pull changes from the *other* computer first: `git pull origin main`
   - If there are conflicts, resolve them carefully, keeping the Turbo Mode improvements from today.
   - Push the merged state.

## Specific Changes to Preserve from Today
- **Turbo Mode Fixes:** Minimum price logic (0.05 min), Cooldown map.
- **Diversification:** Stratified fetching (Politics, Eco, Tech) in `getRelevantMarkets`.
- **Dashboard:** New Turbo Table layout.
- **Logs:** Rate-limiting of "expired" messages.
