
import { botState } from '../state.js';
import { addLog } from '../utils.js';

// --- ROBUST FETCH WRAPPER (Inlined for now or move to utils if needed globally) ---
// Using standard fetch for simplicity as Node 18+ has it.
// If robust retry is needed, we should export fetchWithRetry from utils.

async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeout = 20000;
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            if (attempt === retries) throw error;
            await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
        }
    }
}

export async function getPizzaData() {
    try {
        // En prod, utiliser l'API réelle. Ici on simule ou on fetch.
        // URL from legacy code:
        const response = await fetchWithRetry('https://www.pizzint.watch/api/dashboard-data');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();

        // Data shaping to match legacy expectations
        return {
            index: data.globalIndex || 50,
            defcon: data.defconLevel || 5,
            trends: data.trends || []
        };
    } catch (e) {
        // Fallback Mock Data if API fails
        // console.error("PizzInt API Error:", e.message); 
        // Silent fail or return null to trigger offline mode
        return null;
    }
}
