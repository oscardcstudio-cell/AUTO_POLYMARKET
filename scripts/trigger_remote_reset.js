
import fetch from 'node-fetch';

const url = 'https://autopolymarket-production.up.railway.app/api/reset';

async function triggerReset() {
    console.log(`🚀 Sending POST request to ${url}...`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const data = await response.json();
        console.log('📦 Server Response:', data);

        if (data.success) {
            console.log('✅ NUCLEAR RESET SUCCESSFUL!');
            console.log('Please check the dashboard again.');
        } else {
            console.error('❌ Reset failed:', data.message);
        }
    } catch (error) {
        console.error('❌ Request failed:', error.message);
    }
}

triggerReset();
