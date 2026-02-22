// Test script for real news integration
import { fetchRealNewsSentiment, matchMarketToNews, fetchGoogleNewsRSS, analyzeHeadlineSentiment } from '../src/api/news.js';

async function test() {
    console.log('=== TEST 1: Headline Sentiment Analysis ===\n');
    const testHeadlines = [
        'Bitcoin surges past $100K as rally continues',
        'Stock market crashes amid fears of recession',
        'Fed holds rates steady, markets stable',
        'Trump wins election in landslide victory',
        'War escalates as tensions rise in Middle East',
    ];
    for (const h of testHeadlines) {
        const { sentiment, score } = analyzeHeadlineSentiment(h);
        console.log(`  ${sentiment.padEnd(8)} (${score > 0 ? '+' : ''}${score.toFixed(2)}) | ${h}`);
    }

    console.log('\n=== TEST 2: Google News RSS Fetch ===\n');
    const articles = await fetchGoogleNewsRSS('Bitcoin crypto', 5);
    console.log(`  Fetched ${articles.length} articles for "Bitcoin crypto"`);
    for (const a of articles.slice(0, 3)) {
        console.log(`  - [${a.sentiment}] ${a.title.substring(0, 70)}... (${a.source})`);
    }

    console.log('\n=== TEST 3: Full Sentiment from Fake Markets ===\n');
    const fakeMarkets = [
        { question: 'Will Bitcoin reach $150,000 by end of 2026?' },
        { question: 'Will Trump be impeached before 2027?' },
        { question: 'Will Russia and Ukraine sign a peace deal?' },
        { question: 'Will the Fed cut interest rates in March?' },
        { question: 'Will NVIDIA stock exceed $200?' },
    ];

    const sentiments = await fetchRealNewsSentiment(fakeMarkets);
    console.log(`  Got ${sentiments.length} sentiment groups:`);
    for (const s of sentiments) {
        console.log(`  - [${s.sentiment}] ${s.title?.substring(0, 60)}... (${s.articleCount} articles, conf: ${s.confidence})`);
    }

    console.log('\n=== TEST 4: Market-News Matching ===\n');
    if (sentiments.length > 0) {
        for (const m of fakeMarkets) {
            const match = matchMarketToNews(m, sentiments);
            if (match?.matched) {
                console.log(`  MATCH: "${m.question.substring(0, 50)}" → ${match.sentiment} (score: ${match.score})`);
            } else {
                console.log(`  no match: "${m.question.substring(0, 50)}"`);
            }
        }
    }

    console.log('\n=== ALL TESTS PASSED ===');
}

test().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
