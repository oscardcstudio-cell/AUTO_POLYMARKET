# 🔮 FUTURE CONCEPT: The "Global Neural Pulse"

**Goal:** Prove the bot is "listening to the world" and scanning broadly, without clogging the UI with repetitive logs or enforcing sub-optimal trades just for the sake of diversity.

## 1. The Core Philosophy
> "Scanning is Broad, Trading is Sniper."

- **Visuals (The Pulse):** The UI should show *activity* in all sectors (Politics, Eco, Tech, Sports). When an API fetch happens, the sector "pulses" or lights up. This proves the bot is awake and looking.
- **Logs (The Filter):** We only log *significant* events. No more "Scanning..." loops. Only "News Detected: [Title]" if it matches a high relevance score.
- **Trading (The Sniper):** We do *not* force 1 trade per sector if the opportunities aren't there. We let the "Alpha Score" decide. If Tech is dead to rights, we don't trade it, but we *show we checked it*.

## 2. UI/UX Refinements
### A. The "Pulse" Animation
- **Current State:** Static card update.
- **Target State:**
    - Background "heartbeat" animation when API requests go out.
    - Color coding intensity based on volume of data found (e.g., lots of crypto news = bright green Economics card).

### B. "Smart Feed" Filtering
- **Problem:** Repeating the same news or low-quality updates.
- **Solution:**
    - Implement a `SignificanceScore` for news items (based on source reliability + sentiment magnitude).
    - **Display Strategy:** "Top 3 Headlines per Hour" per sector in the expandable card.
    - **Anti-Repetition:** Store hashes of displayed headlines. Never show the same headline twice in the main feed.

## 3. Implementation Roadmap
- [ ] **Refine `getRelevantMarkets`:**
    - Separate the *fetching* (which triggers the Pulse UI) from the *selection* (which triggers logs/trades).
    - `botState.sectorPulses`: New state object just for UI animations.
- [ ] **Update Dashboard:**
    - Add CSS animations for the "Pulse" (glow effects).
    - Create a "High Value News" filter in `unified_bot.js` before sending to the UI.
- [ ] **Refactor into Modules:**
    - Essential for managing this complexity.
    - `src/ui/dashboard_feeder.js`: Logic for what gets sent to the frontend.
    - `src/engine/scanner.js`: Logic for fetching and "pulsing".

## 4. Why this matches the User Vision
- "Montre que tu t'étales à la base partout" -> The Pulse shows the spread.
- "Évite de répéter tout le temps la même ligne" -> The Smart Filter cleans the logs.
- "La meilleure méthode c'est pas forcément de diversifier par thème" -> We decouple the *visual scan* (diversified) from the *money* (based on pure Alpha).

## 5. Visual Ground Truth Verification (The "Reality Check")
**Goal:** Ensure the bot's internal data matches the actual Polymarket website.
- **Mechanism:** Periodically use a browser agent to capture screenshots of the active trade's chart on Polymarket.com.
- **Comparison:**
    - **Bot Chart:** The mini-chart generated in the dashboard (from API data).
    - **Real Chart:** The screenshot from the website.
    - **Verification:** Side-by-side display in a "Auditing" tab. If they diverge, the bot pauses and alerts "DATA MISMATCH".
- **User Request:** "Tu peux faire des screenshots de site comme ça t'es sur de bien comparer le resultat." -> This feature directly answers this need for visual proof.
