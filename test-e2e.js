/**
 * FinCoord E2E Test Report
 * Tests: single-payer, multi-payer, all split types, balances, simplified debts, settlement, dashboard
 */

const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const API_BASE = 'http://localhost:3050/api';
const results = [];
let authToken = null;
let myUserId = null;
let testGroupId = null;
let testUsers = [];

async function request(method, path, data = null, headers = {}) {
  const url = `${API_BASE}${path}`;
  const config = { headers };
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  try {
    const response = await axios({ method, url, data, ...config, timeout: 10000 });
    return { status: response.status, data: response.data, error: null };
  } catch (err) {
    return { status: err.response?.status || 0, data: err.response?.data || null, error: err.response?.data?.error || err.message };
  }
}

function r(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const icon = pass ? '✅' : '❌';
  console.log(`${icon} ${name}${detail ? ': ' + detail : ''}`);
}

async function setupUsers() {
  // Create 4 test users
  const users = [];
  const names = ['Alice', 'Bob', 'Charlie', 'David'];
  for (let i = 0; i < 4; i++) {
    const email = `${names[i].toLowerCase()}@e2e.fincoord`;
    const reg = await request('POST', '/auth/register', { name: names[i], email, password: 'testpass123', phone: `+91999999999${i}` });
    if (reg.status === 201 || reg.status === 200) {
      const login = await request('POST', '/auth/login', { email, password: 'testpass123' });
      if (login.data?.token) {
        users.push({ name: names[i], email, token: login.data.token, userId: login.data.user._id });
      }
    } else if (reg.error?.includes('already exists')) {
      const login = await request('POST', '/auth/login', { email, password: 'testpass123' });
      if (login.data?.token) users.push({ name: names[i], email, token: login.data.token, userId: login.data.user._id });
    }
  }
  testUsers = users;
  myUserId = users[0]?.userId;
  authToken = users[0]?.token;
  return users.length >= 2;
}

async function setupGroup() {
  authToken = testUsers[0].token;
  const memberIds = testUsers.slice(1).map(u => u.userId);
  const res = await request('POST', '/groups', { name: 'E2E Test Group', memberIds });
  if (res.status === 201 && res.data.group) {
    testGroupId = res.data.group._id;
    return true;
  }
  return false;
}

async function testSinglePayerEqual() {
  const res = await request('POST', '/expenses', {
    description: 'Single-Payer Equal',
    totalAmount: '300.00',
    payments: [{ userId: myUserId, amount: '300.00' }],
    splits: [
      { userId: myUserId, owedAmount: '100.00' },
      { userId: testUsers[1].userId, owedAmount: '100.00' },
      { userId: testUsers[2].userId, owedAmount: '100.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });
  if (res.status !== 201) { r('Single-Payer Equal', false, res.error); return null; }
  r('Single-Payer Equal', true, `id=${res.data.expense._id}`);
  return res.data.expense._id;
}

async function testMultiPayer() {
  const res = await request('POST', '/expenses', {
    description: 'Multi-Payer Dinner',
    totalAmount: '800.00',
    payments: [
      { userId: myUserId, amount: '500.00' },
      { userId: testUsers[1].userId, amount: '300.00' }
    ],
    splits: [
      { userId: myUserId, owedAmount: '266.67' },
      { userId: testUsers[1].userId, owedAmount: '266.67' },
      { userId: testUsers[2].userId, owedAmount: '266.66' }
    ],
    groupId: testGroupId,
    splitType: 'unequal'
  });
  if (res.status !== 201) { r('Multi-Payer', false, res.error); return; }
  r('Multi-Payer', true, `id=${res.data.expense._id}`);
}

async function testExactSplit() {
  const res = await request('POST', '/expenses', {
    description: 'Exact Split Rent',
    totalAmount: '1500.00',
    payments: [{ userId: myUserId, amount: '1500.00' }],
    splits: [
      { userId: myUserId, owedAmount: '500.00' },
      { userId: testUsers[1].userId, owedAmount: '600.00' },
      { userId: testUsers[2].userId, owedAmount: '400.00' }
    ],
    groupId: testGroupId,
    splitType: 'unequal'
  });
  if (res.status !== 201) { r('Exact Split', false, res.error); return; }
  r('Exact Split', true, `id=${res.data.expense._id}`);
}

async function testPercentageSplit() {
  const res = await request('POST', '/expenses', {
    description: 'Percentage Split Groceries',
    totalAmount: '400.00',
    payments: [{ userId: myUserId, amount: '400.00' }],
    splits: [
      { userId: myUserId, owedAmount: '120.00' },
      { userId: testUsers[1].userId, owedAmount: '160.00' },
      { userId: testUsers[2].userId, owedAmount: '120.00' }
    ],
    groupId: testGroupId,
    splitType: 'percentage'
  });
  if (res.status !== 201) { r('Percentage Split', false, res.error); return; }
  r('Percentage Split', true, `id=${res.data.expense._id}`);
}

async function testInvalidSplitValidation() {
  const res = await request('POST', '/expenses', {
    description: 'Invalid Split',
    totalAmount: '100.00',
    payments: [{ userId: myUserId, amount: '100.00' }],
    splits: [
      { userId: myUserId, owedAmount: '60.00' },
      { userId: testUsers[1].userId, owedAmount: '60.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });
  r('Invalid Split Rejected', res.status === 400, `status=${res.status}`);
}

async function testGroupBalances() {
  const res = await request('GET', `/groups/${testGroupId}/balances`);
  if (res.status !== 200) { r('Group Balances', false, res.error); return; }
  const d = res.data;
  const hasMembers = Array.isArray(d.memberBalances) && d.memberBalances.length >= 2;
  r('Group Balances', hasMembers, `${d.memberBalances.length} members, simplified=${d.simplifiedTransactions?.length ?? 0}`);
}

async function testSimplifiedDebts() {
  const res = await request('GET', `/groups/${testGroupId}/balances`);
  if (res.status !== 200) { r('Simplified Debts', false, res.error); return; }
  const simplified = res.data.simplifiedTransactions;
  r('Simplified Debts', Array.isArray(simplified) && simplified.length >= 1, `${simplified?.length ?? 0} transactions`);
}

async function testDashboard() {
  const res = await request('GET', '/dashboard/balances');
  if (res.status !== 200) { r('Dashboard', false, res.error); return; }
  const d = res.data;
  const hasSummary = d.summary && typeof d.summary.netBalance === 'number';
  r('Dashboard', hasSummary, `net=${d.summary.netBalance}, groups=${d.byGroup?.length ?? 0}`);
}

async function testExpenseVisibility() {
  // As user 0, create; as user 1, verify visibility
  const res1 = await request('GET', `/expenses?groupId=${testGroupId}`);
  if (res1.status !== 200) { r('Expense Visibility (creator)', false, res1.error); }
  else { r('Expense Visibility (creator)', true, `${res1.data.expenses?.length ?? 0} expenses`); }

  // Switch to user 1
  authToken = testUsers[1].token;
  const res2 = await request('GET', `/expenses?groupId=${testGroupId}`);
  if (res2.status !== 200) { r('Expense Visibility (member)', false, res2.error); }
  else { r('Expense Visibility (member)', true, `${res2.data.expenses?.length ?? 0} expenses`); }

  authToken = testUsers[0].token; // switch back
}

async function testSettlement() {
  // Settlement requires actual debt between two users
  // First create an expense where Alice pays everything, Bob owes something
  const settleExpense = await request('POST', '/expenses', {
    description: 'Settlement Test Expense',
    totalAmount: '100.00',
    payments: [{ userId: myUserId, amount: '100.00' }],
    splits: [
      { userId: myUserId, owedAmount: '50.00' },
      { userId: testUsers[1].userId, owedAmount: '50.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });

  // Now try to settle — Bob pays Alice
  const res = await request('POST', `/groups/${testGroupId}/settle`, {
    withMemberId: testUsers[1].userId,
    amount: '50.00'
  });
  r('Settlement', res.status === 200 || res.status === 201, `status=${res.status}`);
}

async function testLegacyCompat() {
  const res = await request('POST', '/expenses', {
    description: 'Legacy Test',
    payerId: myUserId,
    amount: '75.00',
    splitDetails: { [myUserId]: '75.00' },
    splitMethod: 'equal',
    groupId: testGroupId
  });
  if (res.status !== 201) { r('Legacy Compat', false, res.error); return; }
  const exp = res.data.expense;
  const converted = exp.payments && exp.payments.length === 1 && exp.splits && exp.splits.length === 1;
  r('Legacy Compat', converted, `payments=${exp.payments?.length}, splits=${exp.splits?.length}`);
}

async function testRecalculate() {
  const res = await request('POST', `/groups/${testGroupId}/recalculate-balances`);
  r('Recalculate Balances', res.status === 200, `status=${res.status}`);
}

async function cleanup() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fincoord');
  const Expense = require('./src/models/Expense');
  const Group = require('./src/models/Group');
  const Balance = require('./src/models/Balance');
  const User = require('./src/models/User');
  const Activity = require('./src/models/Activity');
  await Expense.deleteMany({ groupId: testGroupId });
  await Balance.deleteMany({ groupId: testGroupId });
  await Activity.deleteMany({ groupId: testGroupId });
  await Group.deleteOne({ _id: testGroupId });
  for (const u of testUsers) {
    await User.deleteOne({ _id: u.userId });
  }
  await mongoose.disconnect();
  r('Cleanup', true);
}

async function run() {
  console.log('\n========== FINCOORD E2E TESTS ==========\n');

  const setupOk = await setupUsers();
  if (!setupOk) { console.log('Failed to create users'); process.exit(1); }
  r('Setup Users', true, `${testUsers.length} users created`);

  const groupOk = await setupGroup();
  if (!groupOk) { console.log('Failed to create group'); process.exit(1); }
  r('Setup Group', true, `group=${testGroupId}`);

  await testSinglePayerEqual();
  await testMultiPayer();
  await testExactSplit();
  await testPercentageSplit();
  await testInvalidSplitValidation();
  await testExpenseVisibility();
  await testGroupBalances();
  await testSimplifiedDebts();
  await testSettlement();
  await testLegacyCompat();
  await testRecalculate();
  await testDashboard();

  await cleanup();

  // Report
  const passed = results.filter(x => x.pass).length;
  const total = results.length;
  console.log(`\n========== RESULTS: ${passed}/${total} ==========\n`);

  // Write report file
  const fs = require('fs');
  const report = `# FinCoord E2E Test Report
Date: ${new Date().toISOString()}
Server: ${API_BASE}

| # | Test | Status | Detail |
|---|------|--------|--------|
${results.map((x, i) => `| ${i + 1} | ${x.name} | ${x.pass ? 'PASS ✅' : 'FAIL ❌'} | ${x.detail} |`).join('\n')}

**Summary: ${passed}/${total} tests passed**
`;
  fs.writeFileSync('E2E_TEST_REPORT.md', report);
  console.log('Report saved to E2E_TEST_REPORT.md');
}

run().catch(err => { console.error(err); process.exit(1); });
