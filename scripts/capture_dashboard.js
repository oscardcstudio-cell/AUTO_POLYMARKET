
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const SCREENSHOT_DIR = path.join(ROOT_DIR, 'debug_screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR);
}

const PORT = 3000; // Assuming default

async function capture() {
    console.log("🚀 Starting Server for Capture...");

    // Start Server
    const serverProcess = spawn('node', ['server.js'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: PORT.toString() }
    });

    let serverReady = false;

    // Detect when server is ready
    serverProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        // console.log(`[Server] ${msg.trim()}`);
        if (msg.includes('Bot Server running')) {
            serverReady = true;
        }
    });

    // Wait for server to be ready
    console.log("⏳ Waiting for server...");
    let attempts = 0;
    while (!serverReady && attempts < 20) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }

    if (!serverReady) {
        console.error("❌ Server failed to start in time.");
        serverProcess.kill();
        process.exit(1);
    }

    console.log("✅ Server Ready. Launching Browser...");

    try {
        const browser = await puppeteer.launch({
            headless: "new",
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,1024']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 1024 });

        // 1. Dashboard View
        console.log("📸 Capturing Dashboard...");
        await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle0' });
        // Wait a bit for dynamic content/websockets
        await new Promise(r => setTimeout(r, 2000));

        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'dashboard_view.png') });

        // 2. Focused Element: Trade Activity Logs
        console.log("📸 Capturing Trade Logs...");
        const logsElement = await page.$('#tradeActivityLogs');
        if (logsElement) {
            await logsElement.screenshot({ path: path.join(SCREENSHOT_DIR, 'logs_view.png') });
        } else {
            console.error("⚠️ #tradeActivityLogs element not found!");
        }

        // 3. Marketplace View
        console.log("📸 Capturing Marketplace...");
        // Click tab
        await page.evaluate(() => switchView('marketplace'));
        // Wait for potential fetch
        await new Promise(r => setTimeout(r, 3000));
        await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'marketplace_view.png') });

        console.log("✨ Capture Complete!");
        await browser.close();

    } catch (error) {
        console.error("❌ Capture Error:", error);
    } finally {
        console.log("🛑 Stopping Server...");
        serverProcess.kill();
        process.exit();
    }
}

capture();
