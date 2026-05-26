/**
 * Backend Integration Tests for FinCoord API
 * Tests all critical changes: visibility, validation, multi-payer, balances, dashboard
 */

const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:3050/api';
let authToken = null;
let testUserId = null;
let testGroupId = null;
let testExpenseId = null;
const testUsers = []; // { email, password, userId, token }

// Helper: colored logging
const log = (label, msg) => console.log(`\x1b[36m[${label}]\x1b[0m ${msg}`);
const ok = (label, msg) => console.log(`\x1b[32m[PASS]\x1b[0m ${label}: ${msg}`);
const fail = (label, msg) => console.log(`\x1b[31m[FAIL]\x1b[0m ${label}: ${msg}`);

async function request(method, path, data = null, headers = {}) {
  const url = `${API_BASE}${path}`;
  const config = { headers };
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;

  try {
    const response = await axios({ method, url, data, ...config });
    return { status: response.status, data: response.data, error: null };
  } catch (err) {
    return {
      status: err.response?.status || 0,
      data: err.response?.data || null,
      error: err.response?.data?.error || err.message
    };
  }
}

// Register a new test user and return their userId + token
async function createTestUser(prefix) {
  const ts = Date.now();
  const email = `${prefix}_${ts}@fincoord.test`;
  const password = 'testpass123';

  const regRes = await request('POST', '/auth/register', {
    name: `Test ${prefix}`,
    email,
    password,
    phone: `+91999${ts.toString().slice(-7)}`
  });

  if (regRes.status !== 201 && regRes.status !== 200) {
    // Maybe user already exists, try login
    const loginRes = await request('POST', '/auth/login', { email, password });
    if (loginRes.status === 200 && loginRes.data.token) {
      return { email, password, userId: loginRes.data.user._id, token: loginRes.data.token };
    }
    return null;
  }

  // Login to get token
  const loginRes = await request('POST', '/auth/login', { email, password });
  if (loginRes.status === 200 && loginRes.data.token) {
    return { email, password, userId: loginRes.data.user._id, token: loginRes.data.token };
  }
  return null;
}

// ============ TESTS ============

async function testAuth() {
  log('SETUP', 'Testing auth login...');
  const loginRes = await request('POST', '/auth/login', {
    email: 'test@fincoord.app',
    password: 'testpass123'
  });

  if (loginRes.status === 200 && loginRes.data.token) {
    authToken = loginRes.data.token;
    testUserId = loginRes.data.user._id;
    ok('AUTH', `Logged in as ${loginRes.data.user.email}`);
    return true;
  }

  const regRes = await request('POST', '/auth/register', {
    name: 'Test User',
    email: 'test@fincoord.app',
    password: 'testpass123',
    phone: '+919999999999'
  });

  if (regRes.status === 201 || regRes.status === 200) {
    const login2 = await request('POST', '/auth/login', {
      email: 'test@fincoord.app',
      password: 'testpass123'
    });
    if (login2.data.token) {
      authToken = login2.data.token;
      testUserId = login2.data.user._id;
      ok('AUTH', `Registered and logged in`);
      return true;
    }
  }

  fail('AUTH', `Login failed: ${loginRes.error || regRes.error}`);
  return false;
}

async function testUserCreation() {
  log('SETUP', 'Creating test users...');
  for (const prefix of ['user_a', 'user_b', 'user_c']) {
    const u = await createTestUser(prefix);
    if (u) {
      testUsers.push(u);
      ok('SETUP', `Created ${prefix}: ${u.userId}`);
    } else {
      fail('SETUP', `Failed to create ${prefix}`);
      return false;
    }
  }
  return true;
}

async function testGroupCreation() {
  log('TEST', 'Creating test group...');
  // Include test users as members
  const memberIds = testUsers.map(u => u.userId);
  const res = await request('POST', '/groups', {
    name: 'Test Group ' + Date.now(),
    memberIds
  });

  if (res.status === 201 && res.data.group) {
    testGroupId = res.data.group._id;
    ok('GROUP', `Created group: ${res.data.group.name} (${testGroupId}) with ${memberIds.length} extra members`);
    return true;
  }

  fail('GROUP', `Failed: ${res.error}`);
  return false;
}

async function testExpenseVisibility() {
  log('TEST', 'Testing group expense visibility...');

  const createRes = await request('POST', '/expenses', {
    description: 'Visibility Test Expense',
    totalAmount: '100.00',
    payments: [{ userId: testUserId, amount: '100.00' }],
    splits: [
      { userId: testUserId, owedAmount: '50.00' },
      { userId: testUsers[0].userId, owedAmount: '50.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });

  if (createRes.status !== 201) {
    fail('VISIBILITY', `Create failed: ${createRes.error}`);
    return false;
  }
  testExpenseId = createRes.data.expense._id;
  ok('VISIBILITY', `Created expense: ${createRes.data.expense.description}`);

  const fetchRes = await request('GET', `/expenses?groupId=${testGroupId}`);

  if (fetchRes.status === 200) {
    const expenses = fetchRes.data.expenses || [];
    const found = expenses.find(e => e._id === testExpenseId);
    if (found) {
      ok('VISIBILITY', `Group expenses visible: ${expenses.length} expenses found`);
      return true;
    } else {
      fail('VISIBILITY', `Expense not found in group list (${expenses.length} items)`);
      return false;
    }
  }

  fail('VISIBILITY', `Fetch failed: ${fetchRes.error}`);
  return false;
}

async function testSplitValidation() {
  log('TEST', 'Testing split validation...');

  // Test 1: Invalid split (sums don't match)
  const invalidRes = await request('POST', '/expenses', {
    description: 'Invalid Split Test',
    totalAmount: '100.00',
    payments: [{ userId: testUserId, amount: '100.00' }],
    splits: [
      { userId: testUserId, owedAmount: '60.00' },
      { userId: testUsers[0].userId, owedAmount: '60.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });

  if (invalidRes.status === 400 && invalidRes.data?.details) {
    ok('VALIDATION', `Rejected invalid split: ${invalidRes.data.details[0]}`);
  } else {
    fail('VALIDATION', `Should have rejected invalid split, got status ${invalidRes.status}`);
    return false;
  }

  // Test 2: Valid split
  const validRes = await request('POST', '/expenses', {
    description: 'Valid Split Test',
    totalAmount: '150.00',
    payments: [{ userId: testUserId, amount: '150.00' }],
    splits: [
      { userId: testUserId, owedAmount: '50.00' },
      { userId: testUsers[0].userId, owedAmount: '50.00' },
      { userId: testUsers[1].userId, owedAmount: '50.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });

  if (validRes.status === 201) {
    ok('VALIDATION', `Accepted valid split: ${validRes.data.expense.totalAmount} minor units`);
    return true;
  }

  fail('VALIDATION', `Should have accepted valid split: ${validRes.error}`);
  return false;
}

async function testMultiPayer() {
  log('TEST', 'Testing multi-payer expense...');

  const res = await request('POST', '/expenses', {
    description: 'Multi-Payer Test',
    totalAmount: '800.00',
    payments: [
      { userId: testUserId, amount: '500.00' },
      { userId: testUsers[1].userId, amount: '300.00' }
    ],
    splits: [
      { userId: testUserId, owedAmount: '266.67' },
      { userId: testUsers[1].userId, owedAmount: '266.67' },
      { userId: testUsers[2].userId, owedAmount: '266.66' }
    ],
    groupId: testGroupId,
    splitType: 'unequal'
  });

  if (res.status === 201) {
    const expense = res.data.expense;
    const hasMultiPayments = expense.payments && expense.payments.length === 2;
    const hasMultiSplits = expense.splits && expense.splits.length === 3;

    if (hasMultiPayments && hasMultiSplits) {
      ok('MULTI-PAYER', `Created with ${expense.payments.length} payers, ${expense.splits.length} splits`);
      return true;
    } else {
      fail('MULTI-PAYER', `Data shape wrong: payments=${expense.payments?.length}, splits=${expense.splits?.length}`);
      return false;
    }
  }

  fail('MULTI-PAYER', `Failed: ${res.error}`);
  return false;
}

async function testMaterializedBalances() {
  log('TEST', 'Testing materialized balances...');

  const res = await request('GET', `/groups/${testGroupId}/balances`);

  if (res.status === 200) {
    const data = res.data;
    const hasMemberBalances = Array.isArray(data.memberBalances);
    const hasSimplified = Array.isArray(data.simplifiedTransactions);

    if (hasMemberBalances && hasSimplified) {
      ok('BALANCES', `Group balances: ${data.memberBalances.length} members, ${data.simplifiedTransactions?.length || 0} simplified transactions`);
      return true;
    } else {
      fail('BALANCES', `Response missing expected fields`);
      return false;
    }
  }

  fail('BALANCES', `Failed: ${res.error}`);
  return false;
}

async function testDashboard() {
  log('TEST', 'Testing global dashboard...');

  const res = await request('GET', '/dashboard/balances');

  if (res.status === 200) {
    const data = res.data;
    const hasSummary = data.summary && typeof data.summary.netBalance === 'number';
    const hasByGroup = Array.isArray(data.byGroup);
    const hasByPerson = Array.isArray(data.byPerson);

    if (hasSummary && hasByGroup && hasByPerson) {
      ok('DASHBOARD', `Global view: net=${data.summary.netBalance}, ${data.byGroup.length} groups, ${data.byPerson.length} people`);
      return true;
    } else {
      fail('DASHBOARD', `Response missing expected fields`);
      return false;
    }
  }

  fail('DASHBOARD', `Failed: ${res.error}`);
  return false;
}

async function testLegacyCompat() {
  log('TEST', 'Testing legacy format backward compatibility...');

  const res = await request('POST', '/expenses', {
    description: 'Legacy Format Test',
    payerId: testUserId,
    amount: '75.00',
    splitDetails: { [testUserId]: '25.00', [testUsers[0].userId]: '25.00', [testUsers[1].userId]: '25.00' },
    splitMethod: 'equal',
    groupId: testGroupId
  });

  if (res.status === 201) {
    const expense = res.data.expense;
    const convertedCorrectly = expense.payments && expense.payments.length === 1 && expense.splits && expense.splits.length === 3;

    if (convertedCorrectly) {
      ok('LEGACY', `Legacy format converted to new model successfully`);
      return true;
    } else {
      fail('LEGACY', `Conversion incomplete: payments=${expense.payments?.length}, splits=${expense.splits?.length}`);
      return false;
    }
  }

  fail('LEGACY', `Failed: ${res.error}`);
  return false;
}

async function testGroupListWithBalances() {
  log('TEST', 'Testing group list with materialized balances...');

  const res = await request('GET', '/groups');

  if (res.status === 200) {
    const groups = res.data.groups || [];
    const testGroup = groups.find(g => g._id === testGroupId);

    if (testGroup && testGroup.myBalance) {
      ok('GROUP-LIST', `Group list shows myBalance: net=${testGroup.myBalance.net}`);
      return true;
    } else {
      fail('GROUP-LIST', `myBalance missing in group list response`);
      return false;
    }
  }

  fail('GROUP-LIST', `Failed: ${res.error}`);
  return false;
}

async function testGroupExpensesRoute() {
  log('TEST', 'Testing GET /groups/:id/expenses route...');

  const res = await request('GET', `/groups/${testGroupId}/expenses`);

  if (res.status === 200) {
    const expenses = res.data.expenses || [];
    const hasLegacyCompat = expenses.every(e =>
      e.payments !== undefined && e.splits !== undefined
    );
    if (hasLegacyCompat) {
      ok('GROUP-EXPENSES', `Route works, ${expenses.length} expenses returned with new schema fields`);
      return true;
    } else {
      fail('GROUP-EXPENSES', `Missing new schema fields in response`);
      return false;
    }
  }

  fail('GROUP-EXPENSES', `Route crashed: ${res.error}`);
  return false;
}

async function testFriendsBalancesRoute() {
  log('TEST', 'Testing GET /friends/balances route...');

  const res = await request('GET', '/friends/balances');

  if (res.status === 200) {
    ok('FRIENDS-BALANCES', `Route works, ${res.data.friends?.length || 0} friends returned`);
    return true;
  }

  fail('FRIENDS-BALANCES', `Route crashed: ${res.error}`);
  return false;
}

async function testExportRoute() {
  log('TEST', 'Testing GET /export route...');

  const res = await request('GET', '/export');

  if (res.status === 200) {
    const data = res.data.data || [];
    const hasExpenses = data.some(d => d.type === 'expense');
    if (hasExpenses) {
      const sample = data.find(d => d.type === 'expense');
      const fieldsOk = sample.amount != null && sample.splitMethod != null;
      if (fieldsOk) {
        ok('EXPORT', `Route works, ${data.length} items returned with valid fields`);
        return true;
      } else {
        fail('EXPORT', `Fields missing or undefined: amount=${sample.amount}, splitMethod=${sample.splitMethod}`);
        return false;
      }
    }
    ok('EXPORT', `Route works, ${data.length} items returned (no expenses in dataset)`);
    return true;
  }

  fail('EXPORT', `Route crashed: ${res.error}`);
  return false;
}

async function testExpensePatchRoute() {
  log('TEST', 'Testing PATCH /expenses/:id route...');

  // Create an expense first
  const createRes = await request('POST', '/expenses', {
    description: 'Patch Test Expense',
    totalAmount: '200.00',
    payments: [{ userId: testUserId, amount: '200.00' }],
    splits: [
      { userId: testUserId, owedAmount: '100.00' },
      { userId: testUsers[0].userId, owedAmount: '100.00' }
    ],
    groupId: testGroupId,
    splitType: 'equal'
  });

  if (createRes.status !== 201) {
    fail('PATCH-EXPENSE', `Setup failed: ${createRes.error}`);
    return false;
  }

  const expenseId = createRes.data.expense._id;

  // Patch it
  const patchRes = await request('PATCH', `/expenses/${expenseId}`, {
    description: 'Patched Description',
    totalAmount: '250.00',
    notes: 'Updated notes',
    splitType: 'unequal'
  });

  if (patchRes.status === 200) {
    const updated = patchRes.data.expense;
    const descOk = updated.description === 'Patched Description';
    const notesOk = updated.notes === 'Updated notes';
    const typeOk = updated.splitType === 'unequal';
    const amountOk = updated.totalAmount === 25000;

    if (descOk && notesOk && typeOk && amountOk) {
      ok('PATCH-EXPENSE', `PATCH updated description, notes, splitType, totalAmount correctly`);
      return true;
    } else {
      fail('PATCH-EXPENSE', `Partial update: desc=${updated.description}, notes=${updated.notes}, type=${updated.splitType}, amount=${updated.totalAmount}`);
      return false;
    }
  }

  fail('PATCH-EXPENSE', `Route failed: ${patchRes.error}`);
  return false;
}

// ============ RUN ALL ============

async function runTests() {
  console.log('\n========== FINCOORD BACKEND TESTS ==========\n');

  const results = [];

  const authOk = await testAuth();
  if (!authOk) {
    console.log('\n\x1b[31mCannot proceed without auth. Tests aborted.\x1b[0m\n');
    return results;
  }

  const usersOk = await testUserCreation();
  if (!usersOk) {
    console.log('\n\x1b[31mCannot proceed without test users. Tests aborted.\x1b[0m\n');
    return results;
  }

  const groupOk = await testGroupCreation();
  if (!groupOk) {
    console.log('\n\x1b[31mCannot proceed without test group. Tests aborted.\x1b[0m\n');
    return results;
  }

  // Core P0-P2 tests
  results.push({ name: 'Visibility', pass: await testExpenseVisibility() });
  results.push({ name: 'Validation', pass: await testSplitValidation() });
  results.push({ name: 'Multi-Payer', pass: await testMultiPayer() });
  results.push({ name: 'Balances', pass: await testMaterializedBalances() });
  results.push({ name: 'Dashboard', pass: await testDashboard() });
  results.push({ name: 'Legacy Compat', pass: await testLegacyCompat() });
  results.push({ name: 'Group List', pass: await testGroupListWithBalances() });

  // Route-specific regression tests for the known issues
  results.push({ name: 'Group Expenses Route', pass: await testGroupExpensesRoute() });
  results.push({ name: 'Friends Balances Route', pass: await testFriendsBalancesRoute() });
  results.push({ name: 'Export Route', pass: await testExportRoute() });
  results.push({ name: 'Patch Expense Route', pass: await testExpensePatchRoute() });

  // Summary
  const passed = results.filter(r => r.pass).length;
  const total = results.length;

  console.log('\n========== SUMMARY ==========');
  console.log(`Passed: ${passed}/${total}`);

  if (passed === total) {
    console.log('\x1b[32mALL TESTS PASSED \u2713\x1b[0m');
  } else {
    const failed = results.filter(r => !r.pass).map(r => r.name).join(', ');
    console.log(`\x1b[31mFAILED: ${failed}\x1b[0m`);
  }
  console.log('=============================\n');

  return results;
}

runTests()
  .then(results => {
    // Write report file
    const fs = require('fs');
    const report = results.map(r => `${r.pass ? 'PASS' : 'FAIL'}: ${r.name}`).join('\n');
    fs.writeFileSync('test-report.txt', `FinCoord Backend Test Report\nGenerated: ${new Date().toISOString()}\n\n${report}\n\nTotal: ${results.filter(r => r.pass).length}/${results.length} passed\n`);
  })
  .catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(1);
  });
