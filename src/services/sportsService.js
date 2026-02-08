
// src/services/sportsService.js

/**
 * Service to validate sports bets using external data (Mocked for now)
 * Real API targets: API-Football, TheRundown, or scraping.
 */
export const sportsService = {

    /**
     * Validates a sports market and returns confidence adjustments.
     * @param {Object} market - The market object from Polymarket
     * @returns {Object} { adjustment: number, reasons: string[] }
     */
    async validateBet(market) {
        // 1. Check if it's a sports market
        const isSports = (market.category === 'sports') ||
            (market.question && (market.question.includes(' vs ') || market.question.includes('NBA') || market.question.includes('NFL')));

        if (!isSports) return { adjustment: 0, reasons: [] };

        // 2. Extract Teams/Players
        const teams = this.extractTeams(market.question);
        if (!teams) return { adjustment: 0, reasons: [] };

        const adjustment = 0;
        const reasons = [];

        // 3. MOCK VALIDATION LOGIC
        // In real implementation, fetch API data here.
        // E.g. const stats = await api.getMatch(teams.teamA, teams.teamB);

        // Simulation: Random "Smart Money" check
        // If "Lakers" are playing, check "LeBron James" status
        if (market.question.includes('Lakers')) {
            // Mock API call
            const lebronStatus = await this.mockPlayerStatus('LeBron James');
            if (lebronStatus === 'INJURED') {
                return { adjustment: -0.20, reasons: ['⚠️ Star Player INJURED: LeBron James'] };
            }
        }

        // Simulation: If value on Underdog is too good
        // Mock "Real Win Probability" vs "Implied Probability"
        // Let's say Team A has 60% real chance, but priced at 0.50 -> +EV

        // Return 0 adjustment if no strong signal
        return { adjustment: 0, reasons: [] };
    },

    extractTeams(question) {
        // Simple "Team A vs Team B" parser
        if (question.includes(' vs ')) {
            const parts = question.split(' vs ');
            // Clean up date/time often appended
            const teamA = parts[0].trim();
            const teamB = parts[1].split('?')[0].trim(); // Remove ? and trailing text
            return { teamA, teamB };
        }
        return null;
    },

    async mockPlayerStatus(player) {
        // Randomly return INJURED for demo purposes (10% chance)
        return Math.random() < 0.1 ? 'INJURED' : 'ACTIVE';
    }
};
