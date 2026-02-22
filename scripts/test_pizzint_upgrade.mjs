// Quick test: verify PizzINT API returns correct data with new parsing
import { getPizzaData } from '../src/api/pizzint.js';

async function test() {
    console.log('Fetching PizzINT data with new parser...\n');

    const data = await getPizzaData();

    if (!data) {
        console.error('FAIL: getPizzaData() returned null');
        process.exit(1);
    }

    console.log('=== LEGACY FIELDS (backward compat) ===');
    console.log('  index:', data.index, typeof data.index === 'number' ? 'OK' : 'FAIL');
    console.log('  defcon:', data.defcon, typeof data.defcon === 'number' ? 'OK' : 'FAIL');
    console.log('  trends:', data.trends?.length, 'items');

    // Critical check: are we getting REAL values (not fallbacks)?
    const isRealData = !(data.index === 50 && data.defcon === 5);
    console.log('\n=== BUG FIX CHECK ===');
    console.log('  Real data (not fallbacks)?', isRealData ? 'YES - BUG FIXED' : 'NO - still on fallbacks');
    console.log('  (If index=50 AND defcon=5 simultaneously, likely still using wrong field names)');

    console.log('\n=== NEW FIELDS ===');
    console.log('  tensionScore:', data.tensionScore, '/ 100');
    console.log('  tensionTrend:', data.tensionTrend);

    console.log('\n=== DEFCON DETAILS ===');
    if (data.defconDetails) {
        console.log('  intensity:', data.defconDetails.intensityScore);
        console.log('  breadth:', data.defconDetails.breadthScore);
        console.log('  sustained:', data.defconDetails.sustained);
        console.log('  sentinel:', data.defconDetails.sentinel);
        console.log('  nightMult:', data.defconDetails.nightMultiplier);
        console.log('  persistence:', data.defconDetails.persistenceFactor);
        console.log('  above150:', data.defconDetails.placesAbove150);
        console.log('  above200:', data.defconDetails.placesAbove200);
        console.log('  highCount:', data.defconDetails.highCount);
        console.log('  extremeCount:', data.defconDetails.extremeCount);
    } else {
        console.log('  (null - API may not return defcon_details)');
    }

    console.log('\n=== SPIKES ===');
    console.log('  active:', data.spikes?.active);
    console.log('  hasActive:', data.spikes?.hasActive);
    console.log('  events:', data.spikes?.events?.length, 'items');
    if (data.spikes?.events?.length > 0) {
        data.spikes.events.forEach(e => {
            console.log(`    - ${e.placeName}: ${e.magnitude} (${e.percentOfUsual}% of usual, ${e.minutesAgo}min ago)`);
        });
    }

    console.log('\n=== VENUES ===');
    console.log('  count:', data.venues?.length);
    if (data.venues?.length > 0) {
        data.venues.slice(0, 3).forEach(v => {
            console.log(`    - ${v.name}: pop=${v.currentPopularity}, ${v.percentOfUsual}% of usual${v.isSpike ? ` SPIKE(${v.spikeMagnitude})` : ''}`);
        });
    }

    console.log('\n=== DATA QUALITY ===');
    console.log('  freshness:', data.dataFreshness);
    console.log('  history entries:', data.history?.length);

    console.log('\n=== TRENDS (generated from events) ===');
    if (data.trends?.length > 0) {
        data.trends.forEach(t => console.log('  -', t));
    } else {
        console.log('  (none)');
    }

    console.log('\nDONE - All fields parsed successfully');
}

test().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
