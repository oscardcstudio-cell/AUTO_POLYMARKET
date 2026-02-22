# AUDIT CHECKLIST — Auto-Polymarket Bot

> Checklist rapide pour auditer le bot sans tout relire.
> Mise a jour : 2026-02-21

---

## 1. Verification Live (Dashboard)

### Endpoint
```
curl -s https://autopolymarket-production.up.railway.app/api/bot-data | node -e "..."
```

### Points a verifier
- [ ] `capital` > 0 et coherent avec les trades
- [ ] `activeTrades.length` <= `BASE_MAX_TRADES` (10)
- [ ] `trackedWallets.length` == 100 (50 weekly + 50 all-time, dedup)
- [ ] `trackedWallets` ont des `source` variees (WEEKLY, ALL_TIME, BOTH)
- [ ] Logs recents montrent des cycles reguliers (~1 min)
- [ ] `[CopyTrade] X signals detected` apparait dans les logs
- [ ] `[Whale] X whale trades` apparait dans les logs
- [ ] `[News] Real news updated` apparait dans les logs
- [ ] Pas de stack traces ou erreurs repetees dans les logs

---

## 2. Config (src/config.js)

| Param | Valeur attendue | Section |
|-------|----------------|---------|
| `STARTING_CAPITAL` | 1000 | root |
| `MIN_TRADE_SIZE` | 10 | root |
| `MIN_PRICE_THRESHOLD` | 0.05 | root |
| `MAX_TRADE_SIZE_PERCENT` | 0.05 (5%) | root |
| `KELLY_FRACTION` | 0.2 | root |
| `TAKE_PROFIT_PERCENT` | 0.15 | root |
| `STOP_LOSS_PERCENT` | 0.08 | root |
| `TRADE_TIMEOUT_HOURS` | 48 | root |
| `DAILY_LOSS_LIMIT` | 0.03 | root |
| `WEEKLY_LOSS_LIMIT` | 0.07 | root |
| `SPECULATIVE_SL_OVERRIDE` | 0.20 | DYNAMIC_SL |
| `TRAILING_ACTIVATION` | 0.10 | DYNAMIC_SL |
| `TRAILING_DISTANCE` | 0.05 | DYNAMIC_SL |
| `MAX_SAME_CATEGORY` | 3 | PORTFOLIO_LIMITS |
| `MAX_SPORTS_CATEGORY` | 5 | PORTFOLIO_LIMITS |
| `MAX_ECONOMIC_CATEGORY` | 2 | PORTFOLIO_LIMITS |
| `MAX_SAME_DIRECTION` | 6 | PORTFOLIO_LIMITS |
| `MAX_TRACKED_WALLETS` | 100 | COPY_TRADING |
| `MIN_WALLET_PNL_7D` | 100 | COPY_TRADING |
| `COPY_SIZE_PERCENT` | 0.015 | COPY_TRADING |
| `WHALE_ALPHA_BONUS` | 35 | WHALE_TRACKING |
| `MIN_WHALE_SIZE` | 500 | WHALE_TRACKING |

---

## 3. Engine (src/logic/engine.js)

### Sizing Guards
- [ ] **Whale cap** : `WHALE_MAX = 12` — trades contenant "Whale" dans les reasons
- [ ] **Economic penalty** : `tradeSize *= 0.6` si categorie == economic
- [ ] **Speculative cap** : `tradeSize *= 0.5` + max $15 si `entryPrice < 0.35`
- [ ] **Max loss cap** : `MAX_LOSS_CAP = -0.15` dans `checkAndCloseTrades`

### Conviction Scoring (calculateConviction)
- [ ] Arbitrage: +40
- [ ] Whale aligned: +15 / opposed: -10
- [ ] Copy aligned: +12 / top5: +8 / multi: +5
- [ ] Fresh+Volume: +20
- [ ] Alpha >75: +20 / >50: +10
- [ ] Wizard: +15
- [ ] Trend UP/DOWN: +15
- [ ] HypeFader: +10
- [ ] Tension graduated: +10/+20/+25
- [ ] News confirm: +8 / conflict: -5
- [ ] **Sports: +15** (category bonus)
- [ ] **Economic: -10** (category penalty)
- [ ] Advanced strategies applied (Anti-Fragility, Calendar, etc.)

### Portfolio Exposure
- [ ] `checkPortfolioExposure` uses per-category max (sports:5, economic:2, other:3)
- [ ] Direction limit: MAX_SAME_DIRECTION (6)
- [ ] Correlation penalty applied
- [ ] Diversity bonus applied

### Trade Flow
- [ ] Re-entry limit: max 2 per market
- [ ] Cooldown: 30 min after closing
- [ ] Daily loss limit checked
- [ ] Speculative exposure: max 20% of starting capital
- [ ] CLOB price fetched before execution (fallback to AMM +1%)
- [ ] Gap protection: >30% move = wait 1 cycle

---

## 4. Signals (src/logic/signals.js)

### categorizeMarket()
- [ ] **Sports checked FIRST** (before geopolitical) — avoids "counter-strike" -> "strike"
- [ ] Sports keywords include: nba, nfl, hockey, soccer, tennis, lol:, counter-strike:, esports, bo3), bo5), win on 2026, vs.
- [ ] Geopolitical after sports
- [ ] Economic, political, tech, other in that order

### Alpha Scoring (calculateAlphaScore)
- [ ] Whale bonus: +35 alpha
- [ ] Copy bonus: +30 alpha, multi: +15
- [ ] **Sports: +25** alpha
- [ ] **Economic: -30** alpha
- [ ] Tension graduated bonuses (elevated/high/critical)
- [ ] Rising tension bonus

### addLog calls
- [ ] All use `addLog(botState, message, type)` format (2+ args)
- [ ] No bare `addLog(message)` calls (would crash)

### Copy Signal Detection (detectCopySignals)
- [ ] Calls `scanCopySignals()` from wallet_tracker
- [ ] Matches signals to markets via `matchCopySignalToMarket`
- [ ] Stores `_copyMatches` on market objects for alpha scoring

---

## 5. Wallet Tracker (src/api/wallet_tracker.js)

- [ ] `leaderboardCache` is a `Map` (not plain object)
- [ ] `fetchLeaderboard` paginates at 50/page with offset
- [ ] `refreshTrackedWallets` fetches BOTH `WEEK` and `ALL` periods
- [ ] Deduplicates wallets, tags as WEEKLY/ALL_TIME/BOTH
- [ ] `scanCopySignals` batch size = 10
- [ ] `detectNewPositions` checks for NEW and ADD (>20% size increase)
- [ ] Saves to Supabase `tracked_wallets` table

---

## 6. Server (server.js)

- [ ] `refreshTrackedWallets()` called on startup (before main loop)
- [ ] `detectCopySignals(relevantMarkets)` called every cycle
- [ ] Leaderboard refresh every 6h (inside deep scan block)
- [ ] Copy signals added as candidates with priority 'COPY'
- [ ] Deep scan every 30 min
- [ ] Price update loop started
- [ ] AI scheduler started
- [ ] Slug resolution for active trades on startup

---

## 7. State (src/state.js)

- [ ] `INITIAL_STATE` includes `trackedWallets: []` and `lastCopySignals: []`
- [ ] `tryRecovery()` handles desync (local vs Supabase)
- [ ] `save()` syncs to Supabase (fire-and-forget)
- [ ] `closedTrades` capped at 50 entries (memory bound)
- [ ] `capitalHistory` capped at 100 entries

---

## 8. Known Minor Issues (non-critical)

| Issue | Fichier | Severity | Status |
|-------|---------|----------|--------|
| `positionsCache` never cleaned (object grows with wallets) | wallet_tracker.js | LOW | Known |
| Whale emoji mismatch: cap checks for `🐋` but conviction uses `🐳` | engine.js L827 | LOW | Works via "Whale" text fallback |
| `_copyMatches` may persist on cached market objects | signals.js | LOW | Cleared by 60s cache refresh |
| `sportsService.validateBet` is mostly mocked | sportsService.js | LOW | No real API connected |

---

## 9. Performance Stats Template

A remplir apres chaque session de monitoring :

```
Date: ____
Capital: $____
Active Trades: ____
Closed (total): ____
Win Rate (total): ____%
Win Rate (last 24h): ____%
Best Category: ____
Worst Category: ____
Copy Trading Status: ____ wallets tracked
Whale Signals: ____ detected
News Sentiment: ____ topics
Anti-Fragility Tier: ____
```

---

## 10. Supabase Quick Queries

### Trades des dernieres 48h
```sql
SELECT id, question, side, amount, entry_price, exit_price, pnl, pnl_percent, status, strategy, category, created_at
FROM trades
WHERE created_at > NOW() - INTERVAL '48 hours'
ORDER BY created_at DESC;
```

### Win rate par categorie
```sql
SELECT category,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE pnl > 0) as wins,
  ROUND(COUNT(*) FILTER (WHERE pnl > 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as wr
FROM trades WHERE status = 'CLOSED'
GROUP BY category ORDER BY wr DESC;
```

### Win rate par strategie
```sql
SELECT strategy,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE pnl > 0) as wins,
  ROUND(COUNT(*) FILTER (WHERE pnl > 0)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as wr,
  ROUND(SUM(pnl)::numeric, 2) as total_pnl
FROM trades WHERE status = 'CLOSED'
GROUP BY strategy ORDER BY total_pnl DESC;
```

### Top wallet performers (copy trading)
```sql
SELECT wallet_address, username, rank, pnl_7d, volume_7d, last_updated
FROM tracked_wallets
WHERE is_active = true
ORDER BY pnl_7d DESC LIMIT 10;
```
