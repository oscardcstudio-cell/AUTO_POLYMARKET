
/**
 * Semantic Arbitrage Scanner
 *
 * Détecte les incohérences de prix entre marchés LIÉS sur Polymarket.
 * Fonctionne sans API externe — basé sur l'extraction d'entités clés.
 *
 * Deux règles détectées :
 *
 * 1. MUTUAL_EXCLUSION — Deux marchés qui ne peuvent pas être vrais simultanément
 *    mais dont les prix YES additionnés dépassent 100%.
 *    → Signal : Parier NO sur le marché surcoté
 *    Exemple : "Trump wins" 55% + "Harris wins" 60% → impossible → l'un est trop cher
 *
 * 2. IMPLICATION_GAP — Marché A à haute confiance, marché B lié à faible confiance.
 *    Si A est probable, B (logiquement lié) devrait l'être aussi.
 *    → Signal : Parier YES sur le marché sous-coté
 *    Exemple : "Ceasefire en Gaza" 75% → "Libération otages Gaza" 30% → trop bas ?
 *
 * Nécessite 100+ marchés pour être efficace (utiliser lors du deep scan).
 */

import { CONFIG } from '../config.js';

// ─── Entités clés suivies sur Polymarket ────────────────────────────────────
// Chaque entité peut lier plusieurs marchés entre eux
const TRACKED_ENTITIES = [
    // Politique US
    'trump', 'biden', 'harris', 'musk', 'elon', 'rfk', 'desantis',
    'congress', 'senate', 'republican', 'democrat', 'gop',
    // Dirigeants internationaux
    'zelensky', 'putin', 'netanyahu', 'modi', 'xi jinping', 'macron',
    'erdogan', 'kim', 'khamenei', 'rouhani',
    // Pays / régions géopolitiques
    'iran', 'russia', 'ukraine', 'china', 'israel', 'taiwan',
    'north korea', 'gaza', 'lebanon', 'syria', 'venezuela', 'turkey',
    'pakistan', 'india', 'saudi', 'nato',
    // Crypto
    'bitcoin', 'btc', 'ethereum', 'eth', 'solana', 'sol', 'crypto',
    'coinbase', 'binance', 'xrp', 'ripple',
    // Économie / marchés
    'fed', 'federal reserve', 'interest rate', 'tariff', 'recession',
    'inflation', 'gdp', 'nasdaq', 'dow', 'sp500', 's&p',
    // Entreprises
    'tesla', 'nvidia', 'apple', 'meta', 'google', 'microsoft', 'openai',
    'spacex', 'amazon', 'tiktok', 'x.com',
    // Événements / termes
    'election', 'ceasefire', 'nuclear', 'invasion', 'sanction',
    'default', 'imf', 'opec', 'oil', 'deal', 'treaty',
    // Sports haute visibilité
    'lebron', 'curry', 'mahomes', 'messi', 'ronaldo', 'djokovic',
    'super bowl', 'nba finals', 'world cup', 'champions league',
];

// ─── Patterns de question "compétitive" (un seul gagnant possible) ──────────
const COMPETITIVE_PATTERNS = [
    /\bwin\b/i, /\bwinner\b/i, /\belect/i, /\bpresident\b/i,
    /\bchampion/i, /\bfirst\b/i, /\bnom[iin]/i, /\bgop\b/i,
    /\bbeat\b/i, /\bdefeat\b/i, /\bvictory\b/i,
];

// ─── Extraction d'entités ────────────────────────────────────────────────────
/**
 * Extrait les entités trackées présentes dans une question de marché
 * @param {string} question
 * @returns {string[]}
 */
function extractEntities(question) {
    const q = (question || '').toLowerCase();
    return TRACKED_ENTITIES.filter(entity => q.includes(entity));
}

// ─── Regroupement par entités (Union-Find) ───────────────────────────────────
/**
 * Groupe les marchés en "familles" basées sur les entités partagées.
 * Deux marchés partageant au moins 1 entité trackée sont dans la même famille.
 *
 * @param {Object[]} markets — tableau de marchés Polymarket
 * @returns {{ markets: Object[], entities: string[] }[]}
 */
function buildMarketFamilies(markets) {
    const n = markets.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    const entityMap = {}; // entity → [indices]

    // Indexer les marchés par entité
    for (let i = 0; i < n; i++) {
        const entities = extractEntities(markets[i].question);
        for (const entity of entities) {
            if (!entityMap[entity]) entityMap[entity] = [];
            entityMap[entity].push(i);
        }
    }

    // Union-Find : relier les marchés qui partagent une entité
    function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
    function union(a, b) { parent[find(a)] = find(b); }

    for (const indices of Object.values(entityMap)) {
        for (let k = 1; k < indices.length; k++) {
            union(indices[0], indices[k]);
        }
    }

    // Collecter les familles
    const familyMap = {};
    for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!familyMap[root]) familyMap[root] = [];
        familyMap[root].push(i);
    }

    // Retourner seulement les familles avec ≥2 marchés et ≥1 entité tracée
    return Object.values(familyMap)
        .filter(indices => indices.length >= 2)
        .map(indices => {
            const fMarkets = indices.map(i => markets[i]);
            const combinedText = fMarkets.map(m => m.question || '').join(' ');
            const entities = extractEntities(combinedText);
            return { markets: fMarkets, entities };
        })
        .filter(f => f.entities.length >= 1);
}

// ─── Règle 1 : Exclusion mutuelle ───────────────────────────────────────────
/**
 * Détecte quand deux marchés liés sont tous les deux >50% YES
 * mais représentent des outcomes mutuellement exclusifs.
 *
 * Signal : Parier NO sur le marché avec le prix le plus élevé.
 */
function detectMutualExclusion(family, minGap) {
    const { markets, entities } = family;
    const opportunities = [];

    // Filtrer seulement les marchés "compétitifs" (win/election/champion)
    const competitive = markets.filter(m =>
        COMPETITIVE_PATTERNS.some(p => p.test(m.question || ''))
    );
    if (competitive.length < 2) return [];

    for (let i = 0; i < competitive.length; i++) {
        for (let j = i + 1; j < competitive.length; j++) {
            const mA = competitive[i];
            const mB = competitive[j];
            const pA = parseFloat(mA.price || 0.5);
            const pB = parseFloat(mB.price || 0.5);

            // Les deux sont >50% et leur somme dépasse 105%
            if (pA >= 0.48 && pB >= 0.48 && (pA + pB) > 1.05) {
                const strength = Math.round((pA + pB - 1.0) * 100);
                if (strength < minGap) continue;

                // Parier NO sur le plus surcoté
                const [target, other] = pA >= pB ? [mA, mB] : [mB, mA];
                const targetP = Math.max(pA, pB);
                const otherP = Math.min(pA, pB);

                // Vérification liquidité minimale
                const liq = parseFloat(target.liquidityNum || target.liquidity || 0);
                if (liq < 300) continue;

                opportunities.push({
                    type: 'MUTUAL_EXCLUSION',
                    entity: entities.slice(0, 2).join('+'),
                    signal: target,
                    side: 'NO',
                    relatedMarket: { question: other.question?.substring(0, 60), price: otherP },
                    reason: `🔗 Exclusion [${entities.slice(0, 2).join('+')}]: ${(targetP * 100).toFixed(0)}% + ${(otherP * 100).toFixed(0)}% = ${((pA + pB) * 100).toFixed(0)}% > 100%`,
                    strength,
                });
            }
        }
    }
    return opportunities;
}

// ─── Règle 2 : Gap d'implication ────────────────────────────────────────────
/**
 * Détecte quand un marché A est à haute confiance (>65%) et un marché B lié
 * est à basse confiance (<38%), alors que B devrait être tiré par A.
 *
 * Signal : Parier YES sur le marché sous-côté B.
 */
function detectImplicationGap(family, minGap) {
    const { markets, entities } = family;
    const opportunities = [];

    const highConf = markets.filter(m => parseFloat(m.price || 0.5) > 0.65);
    const lowConf  = markets.filter(m => parseFloat(m.price || 0.5) < 0.38);

    if (highConf.length === 0 || lowConf.length === 0) return [];

    for (const mA of highConf) {
        for (const mB of lowConf) {
            if (mA.id === mB.id) continue;

            const pA = parseFloat(mA.price || 0.5);
            const pB = parseFloat(mB.price || 0.5);
            const strength = Math.round((pA - pB) * 100);
            if (strength < minGap) continue;

            // Même fenêtre temporelle (différence < 45 jours)
            const expA = new Date(mA.endDate || 0).getTime();
            const expB = new Date(mB.endDate || 0).getTime();
            if (Math.abs(expA - expB) > 45 * 24 * 60 * 60 * 1000) continue;

            // Liquidité suffisante sur B (sinon c'est juste un marché mort)
            const liqB = parseFloat(mB.liquidityNum || mB.liquidity || 0);
            if (liqB < 500) continue;

            opportunities.push({
                type: 'IMPLICATION_GAP',
                entity: entities.slice(0, 2).join('+'),
                signal: mB,
                side: 'YES',
                relatedMarket: { question: mA.question?.substring(0, 60), price: pA },
                reason: `🔗 Gap [${entities.slice(0, 2).join('+')}]: A=${( pA * 100).toFixed(0)}% tire B=${(pB * 100).toFixed(0)}% — B potentiellement sous-coté`,
                strength,
            });
        }
    }
    return opportunities;
}

// ─── Export principal ─────────────────────────────────────────────────────────
/**
 * Scanner principal d'arbitrage sémantique.
 * Doit être appelé avec 100+ marchés pour être efficace (deep scan).
 *
 * @param {Object[]} markets — tableau de marchés Polymarket (100+ recommandé)
 * @returns {Object[]} opportunités triées par force décroissante
 */
export function scanSemanticArbitrage(markets) {
    if (!markets || markets.length < 10) return [];

    const SA = CONFIG.SEMANTIC_ARB || {};
    const MIN_GAP = SA.MIN_GAP_PERCENT || 8; // % minimum d'écart pour signaler

    try {
        const families = buildMarketFamilies(markets);
        const opportunities = [];

        for (const family of families) {
            opportunities.push(...detectMutualExclusion(family, MIN_GAP));
            opportunities.push(...detectImplicationGap(family, MIN_GAP));
        }

        // Dédoublonner par market ID + side
        const seen = new Set();
        const unique = opportunities.filter(o => {
            const key = `${o.signal?.id}-${o.side}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        // Retourner les 25 meilleures opportunités
        return unique.sort((a, b) => b.strength - a.strength).slice(0, 25);

    } catch (e) {
        console.error('[SemanticArb] Erreur:', e.message);
        return [];
    }
}
