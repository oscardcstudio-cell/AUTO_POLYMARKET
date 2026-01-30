import fs from 'fs';

async function main() {
    console.log("Fetching raw HTML from pizzint.watch...");
    try {
        const response = await fetch('https://www.pizzint.watch/');
        const text = await response.text();

        console.log(`Fetched ${text.length} characters.`);

        // Save to file for manual inspection if needed, but for now just log snippets
        // Look for JSON data or script variables

        const scriptTags = text.match(/<script[\s\S]*?>[\s\S]*?<\/script>/gi);
        if (scriptTags) {
            console.log(`Found ${scriptTags.length} script tags.`);
            scriptTags.forEach((tag, i) => {
                if (tag.includes('json') || tag.includes('NEXT_DATA') || tag.includes('props')) {
                    console.log(`--- Script ${i} ---`);
                    console.log(tag.substring(0, 500) + "..."); // Print first 500 chars
                }
            });
        }

        // Search for specific keywords
        const keywords = ['doughcon', 'pizza', 'level', 'score', 'index'];
        keywords.forEach(kw => {
            const index = text.toLowerCase().indexOf(kw);
            if (index !== -1) {
                console.log(`Keyword "${kw}" found at context: ...${text.substring(index - 50, index + 50).replace(/\n/g, ' ')}...`);
            }
        });

    } catch (error) {
        console.error("Fetch failed:", error);
    }
}

main();
