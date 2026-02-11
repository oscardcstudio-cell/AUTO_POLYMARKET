# 🐞 DEBUG PROTOCOL & SYSTEM HEALTH
> **MANDATORY READ FOR AI AGENTS** before starting any debugging task.

## 🔍 Core Philosophy
1.  **Local First**: Always try to reproduce the bug locally before assuming it's a cloud/deployment issue.
2.  **Supabase as Source of Truth**: Since we cannot access Railway console logs directly, we rely on Supabase tables (`system_logs`, `bot_state`) to infer the remote state.
3.  **Visual Verification**: Screenshots are possible locally, but impossible on Railway. Use `diagnose_railway_state.js` to "see" what Railway is doing.

---

## 🛠️ Debugging Workflow (Step-by-Step)

### Phase 1: Local Replication 🏠
**Goal**: Confirm if the code itself is broken.
1.  **Kill port 3000** (to ensure no zombies):
    ```powershell
    netstat -ano | findstr :3000
    taskkill /F /PID <PID>
    ```
2.  **Start Server Locally**:
    ```powershell
    node server.js
    ```
3.  **Trigger the Action**:
    -   If it's an API bug, use `scripts/test_reset.js` or `curl`.
    -   If it's a logic bug, wait for the loop to run.
4.  **Analyze Local Logs**:
    -   Check the terminal output.
    -   Check `logs.txt` (if written).
    -   If it crashes locally -> **FIX CODE**.
    -   If it works locally -> **DEPLOYMENT/ENV ISSUE**.

### Phase 2: Database Integrity 🗄️
**Goal**: Ensure schema matches code expectations.
1.  **Run Audit Script**:
    ```powershell
    npm run debug  # (Runs scripts/audit_system.js)
    ```
    -   Checks if Supabase tables exist.
    -   Checks if columns match (basic check).
    -   Checks API keys.
2.  **Verify Schema Fixes**:
    -   Always check `SUPABASE_FIX.sql`. If columns are missing in errors (e.g. "Could not find column 'logs'"), UPDATE this SQL file and ask user to run it.

### Phase 3: Railway Inference ☁️
**Goal**: specific diagnosis of the Remote Bot without console access.
1.  **Run Diagnosis Script**:
    ```powershell
    npm run diagnose # (Runs scripts/diagnose_railway_state.js)
    ```
    -   Compares **State Timestamp** vs **Current Time**. (Is the bot frozen?)
    -   Compares **DB State** vs **Memory State**. (Is saving working?)
    -   Compares **Capital/Trades**. (Did the reset work?)
2.  **Check Remote Logs**:
    -   The bot writes critical logs to Supabase `system_logs` or `debug_logs`.
    -   Query them via SQL or Supabase Client if needed.

### Phase 4: Forced Recovery ☢️
**Goal**: Unstuck a frozen or broken deployment.
1.  **Version Bump**:
    -   Change `console.log("Version: ...")` in `server.js`.
    -   Push to GitHub. This forces Railway to rebuild/restart.
2.  **Nuclear Option** (If API fails):
    -   Add `stateManager.reset()` in `server.js` startup sequence.
    -   Push code.
    -   Wait 3 mins.
    -   **REMOVE** the nuclear code after success (to prevent loops).

---

## 📂 Toolbox

| Script | Command | Purpose |
| :--- | :--- | :--- |
| **System Audit** | `node scripts/audit_system.js` | Check Env, API keys, DB connectivity. |
| **Railway Diagnosis** | `node scripts/diagnose_railway_state.js` | Check if Railway bot is alive & writing state. |
| **Test Reset API** | `node scripts/test_reset.js` | Test the reset endpoint locally. |
| **Sync History** | `node scripts/sync_local_history.js` | Push local `bot_data.json` to Supabase. |

## 📸 Screenshots?
-   **Local**: You can use `screenshotService` or Puppeteer to take snaps of the dashboard if running locally.
-   **Railway**: IMPOSSIBLE. Don't ask. Rely on `diagnose_railway_state.js` output.

---
**Last Updated**: 2026-02-11
