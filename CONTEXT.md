
# 📘 Auto-Polymarket Bot - Context & Handover

**Version:** 2.1 (Post-Revert Stable)
**Date:** February 7, 2026

## 🎯 Status Overview
The project is currently in a **STABLE** state after a major revert to fix a "White Screen of Death" issue. 
We have successfully re-implemented:
1.  **Dashboard UI Fixes:** Active trades display, decimal removal, blue badges.
2.  **Reset Functionality:** Working button to reset wallet to $1000.
3.  **Persistence:** Logic confirmed (no random resets to $0).

## 📂 Key Files
*   **`unified_bot.js`**: The BRAIN. Contains the Express server, API endpoints (`/api/bot-data`, `/api/reset`), trade logic, and auto-sync to GitHub.
*   **`bot_dashboard.html`**: The FRONTEND. Single HTML file serving the UI. Contains complex JS for rendering charts and lists. **Handle with care.**
*   **`bot_data.json`**: The STATE. Persists capital, trades, and logs. Ignored by Git to prevent overwrites, but synced via code for backup.
*   **`CONFIG.js`** (or config section in `unified_bot.js`): Contains API keys (Gamma, CLOB, PizzINT) and thresholds.

## ⚠️ "Do Not Touch" / Critical Rules
1.  **Do NOT Refactor the Dashboard blindly:** The `bot_dashboard.html` logic for `activeTrades` and `closedTrades` is fragile. Always use defensive coding (`|| 0`) when accessing properties like `size`, `shares`, or `priceHistory`.
2.  **State Management:** The `saveState()` function in `unified_bot.js` is critical. It must be called after *every* trade or balance change.
3.  **Reset Logic:** The `/api/reset` endpoint works perfectly. Do not change it unless necessary.
4.  **Formatting:** The user prefers **Integers** (no decimals) for large dollar amounts (Equity, Invested, Profit). Keep decimals for Unit Prices ($0.55).

## 🧙 Wizard Long Shots
*   Logic is in `detectWizards()` in `unified_bot.js`.
*   Criteria were relaxed in Version 2.1 to find more opportunities (Price < 0.35, Liq > 500, Alpha > 30).

## 📈 Trade Logic Update (v2.2)
*   **Smart Momentum:** Replaced "Contrarian Bias" with "Trend Following" for Vol > 1000.
*   **Behavior:** Now bets **YES** on favorites (Price 0.55 - 0.85), instead of Shorting them.
*   **Goal:** Balance the YES/NO ratio.

## 🚀 Next Steps (Backlog)
*   **Smart Exit:** Implement trailing stop-loss logic in `unified_bot.js`.
*   **PizzINT Integration:** Deepen the integration with the news API for better Alpha scores.
*   **Mobile View:** The dashboard is Desktop-first; mobile responsiveness is a nice-to-have.

---
*Created by Antigravity Agent for seamless handover.*
