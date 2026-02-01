import puppeteer from 'puppeteer';
import fs from 'fs';

async function main() {
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    console.log('Navigating to pizzint.watch...');
    await page.goto('https://www.pizzint.watch/', { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('Waiting for potential loading...');
    await new Promise(r => setTimeout(r, 10000)); // Wait 10s for animations

    console.log('Extracting page structure...');
    // Extract a simplified DOM structure
    const pageStructure = await page.evaluate(() => {
        function traverse(node, depth = 0) {
            if (depth > 5) return ''; // Limit depth
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent.trim();
                return text.length > 0 ? `  `.repeat(depth) + `"${text}"\n` : '';
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return '';

            // Ignore scripts and styles to reduce noise
            if (['SCRIPT', 'STYLE', 'SVG', 'PATH'].includes(node.tagName)) return '';

            let output = `  `.repeat(depth) + `<${node.tagName.toLowerCase()}`;
            if (node.id) output += ` #${node.id}`;
            if (node.className) output += ` .${node.className.replace(/\s+/g, '.')}`;
            output += `>\n`;

            for (const child of node.childNodes) {
                output += traverse(child, depth + 1);
            }
            return output;
        }
        return traverse(document.body);
    });

    console.log('--- PAGE STRUCTURE START ---');
    console.log(pageStructure);
    console.log('--- PAGE STRUCTURE END ---');

    await browser.close();
}

main().catch(err => console.error(err));
