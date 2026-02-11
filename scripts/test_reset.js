
import fetch from 'node-fetch';

async function test() {
    try {
        console.log("👉 Triggering RESET API...");
        const res = await fetch('http://localhost:3000/api/debug/reset-bot?key=debug123', { method: 'POST' });
        const data = await res.json();
        console.log("Result:", data);
        if (!res.ok) console.error("Status:", res.status);
    } catch (e) {
        console.error("Fetch Error:", e.message);
    }
}

test();
