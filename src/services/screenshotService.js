
import puppeteer from 'puppeteer';
import { CONFIG } from '../config.js';

export const screenshotService = {
    browser: null,

    async init() {
        if (!this.browser) {
            console.log("🚀 Launching Headless Browser...");
            this.browser = await puppeteer.launch({
                headless: "new",
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', // Important for Docker/Railway limitations
                    '--window-size=1280,1024'
                ]
            });
        }
    },

    async capture(view = 'dashboard') {
        if (!this.browser) await this.init();

        const page = await this.browser.newPage();
        await page.setViewport({ width: 1280, height: 1024 });

        try {
            const port = process.env.PORT || 3000;
            const url = `http://localhost:${port}`;

            console.log(`📸 Navigating to ${url}...`);
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

            // Wait for dynamic content
            await new Promise(r => setTimeout(r, 2000));

            if (view === 'marketplace') {
                console.log("📸 Switching to Marketplace...");
                await page.evaluate(() => {
                    if (window.switchView) window.switchView('marketplace');
                });
                await new Promise(r => setTimeout(r, 3000));
            } else if (view === 'logs') {
                // Scroll to logs or ensure visibility
                console.log("📸 Focusing Logs...");
                // Optional: scroll logs into view
                await page.evaluate(() => {
                    const el = document.getElementById('tradeActivityLogs');
                    if (el) el.scrollIntoView();
                });
            }

            console.log(`📸 Taking screenshot (${view})...`);
            const buffer = await page.screenshot({ type: 'png', fullPage: view === 'dashboard' }); // Full page for dashboard overview

            await page.close();
            return buffer;

        } catch (error) {
            console.error("❌ Screenshot Error:", error);
            await page.close();
            throw error;
        }
    },

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
};
