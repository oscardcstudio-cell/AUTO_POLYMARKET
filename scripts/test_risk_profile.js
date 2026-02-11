
import { riskManager, RISK_PROFILES } from '../src/logic/riskManagement.js';

console.log("🧪 Testing Risk Management Module...");

// 1. Check Initial State
console.log(`\n1️⃣ Initial Profile: ${riskManager.getProfile().id}`);

// 2. Test Switching Profiles
console.log("\n2️⃣ Testing Profile Switching...");
riskManager.setProfile('SAFE');
console.log(`   Set to SAFE -> Current: ${riskManager.getProfile().id} (Expected: SAFE)`);

riskManager.setProfile('YOLO');
console.log(`   Set to YOLO -> Current: ${riskManager.getProfile().id} (Expected: YOLO)`);

// 3. Test Trade Sizing Logic
console.log("\n3️⃣ Testing Trade Sizing...");
const capital = 1000;

// SAFE Mode Test
riskManager.setProfile('SAFE'); // 2% max
let size = riskManager.calculateTradeSize(capital, 0.8);
console.log(`   [SAFE] Capital $1000, Conf 0.8 -> Size: $${size} (Expected ~20)`);

// YOLO Mode Test
riskManager.setProfile('YOLO'); // 20% max
size = riskManager.calculateTradeSize(capital, 0.8);
console.log(`   [YOLO] Capital $1000, Conf 0.8 -> Size: $${size} (Expected ~200)`);

// 4. Test Strategy Validation
console.log("\n4️⃣ Testing Strategy Limits...");

// SAFE Mode
riskManager.setProfile('SAFE');
let check = riskManager.canTrade('penny_stock', 0.8, 0.01); // Price 0.01
console.log(`   [SAFE] Penny Stock ($0.01): ${check.allowed ? 'ALLOWED' : 'DENIED'} (Reason: ${check.reason})`);

// YOLO Mode
riskManager.setProfile('YOLO');
check = riskManager.canTrade('penny_stock', 0.8, 0.01);
console.log(`   [YOLO] Penny Stock ($0.01): ${check.allowed ? 'ALLOWED' : 'DENIED'}`);

console.log("\n✅ Test Complete.");
