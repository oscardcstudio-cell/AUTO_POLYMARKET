
import fetch from 'node-fetch';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_FILE = path.join(ROOT_DIR, 'test_api_screenshot.png');

const PORT = 3001; // Use different port to avoid conflict if main server running

async function test() {
    console.log("🚀 Starting Server for API Test...");

    // Start Server
    const serverProcess = spawn('node', ['server.js'], {
        cwd: ROOT_DIR,
        stdio: 'pipe',
        env: { ...process.env, PORT: PORT.toString(), ADMIN_KEY: 'debug123' }
    });

    let serverReady = false;

    serverProcess.stdout.on('data', (data) => {
        const msg = data.toString();
        if (msg.includes('Bot Server running')) {
            serverReady = true;
        }
    });

    // Also catch stderr just in case
    serverProcess.stderr.on('data', (data) => {
        // console.error(`[Server Error] ${data}`);
    });

    // Wait for server
    console.log("⏳ Waiting for server...");
    let attempts = 0;
    while (!serverReady && attempts < 20) {
        await new Promise(r => setTimeout(r, 1000));
        attempts++;
    }

    if (!serverReady) {
        console.error("❌ Server failed to start.");
        serverProcess.kill();
        process.exit(1);
    }

    console.log("✅ Server Ready. Calling API...");

    try {
        const url = `http://localhost:${PORT}/api/debug/screenshot?key=debug123&view=dashboard`;
        const initialResponse = await fetch(url);

        if (!initialResponse.ok) {
            throw new Error(`API returned ${initialResponse.status} ${initialResponse.statusText}`);
        }

        const buffer = await initialResponse.buffer();
        fs.writeFileSync(OUTPUT_FILE, buffer);
        console.log(`📸 Screenshot saved to ${OUTPUT_FILE} (${buffer.length} bytes)`);

        if (buffer.length < 1000) {
            console.warn("⚠️ Warning: Image seems too small, might be error page.");
        }

    } catch (error) {
        console.error("❌ API Call Failed:", error);
    } finally {
        console.log("🛑 Stopping Server...");
        serverProcess.kill();
        process.exit();
    }
}

test();
