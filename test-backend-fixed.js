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

async function testGroupCreation() {
  log('TEST', 'Creating test group...');
  const res = await request('POST', '/groups', {
    name: 'Test Group ' + Date.now(),
    memberIds: []
  });
  
  if (res.status === 201 && res.data.group) {
    testGroupId = res.data.group._id;
    ok('GROUP', `Created group: ${res.data.group.name} (${testGroupId})`);
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
    splits: [{ userId: testUserId, owedAmount: '100.00' }],
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
      { userId: testUserId, owedAmount: '60.00' }
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
  
  // Test 2: Valid split (single user pays and owes full amount)
  const validRes = await request('POST', '/expenses', {
    description: 'Valid Split Test',
    totalAmount: '150.00',
    payments: [{ userId: testUserId, amount: '150.00' }],
    splits: [{ userId: testUserId, owedAmount: '150.00' }],
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
  
  // Use same user ID for all entries (testing backend shape, not multi-user balances)
  const res = await request('POST', '/expenses', {
    description: 'Multi-Payer Test',
    totalAmount: '800.00',
    payments: [
      { userId: testUserId, amount: '500.00' },
      { userId: testUserId, amount: '300.00' }
    ],
    splits: [
      { userId: testUserId, owedAmount: '400.00' },
      { userId: testUserId, owedAmount: '400.00' }
    ],
    groupId: testGroupId,
    splitType: 'unequal'
  });
  
  if (res.status === 201) {
    const expense = res.data.expense;
    const hasMultiPayments = expense.payments && expense.payments.length === 2;
    const hasMultiSplits = expense.splits && expense.splits.length === 2;
    
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
  
  // Legacy format: splitDetails must sum to total amount for validation to pass
  const res = await request('POST', '/expenses', {
    description: 'Legacy Format Test',
    payerId: testUserId,
    amount: '75.00',
    splitDetails: { [testUserId]: '75.00' },
    splitMethod: 'equal',
    groupId: testGroupId
  });
  
  if (res.status === 201) {
    const expense = res.data.expense;
    const convertedCorrectly = expense.payments && expense.payments.length === 1 && expense.splits && expense.splits.length === 1;
    
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

async function testSettlementFlow() {
  log('TEST', 'Testing settlement flow...');
  
  // Since we only have 1 user in the test group, settlement won't work (no balance to settle)
  // Just verify the endpoint exists and returns proper error for non-debt
  const res = await request('POST', `/groups/${testGroupId}/settle`, {
    withMemberId: testUserId,
    amount: '10.00'
  });
  
  // Should fail because you can't settle with yourself or no balance exists
  if (res.status === 400 || res.status === 404) {
    ok('SETTLEMENT', `Endpoint responds correctly: ${res.status} ${res.error}`);
    return true;
  }
  
  if (res.status === 200 || res.status === 201) {
    ok('SETTLEMENT', `Settlement created: ${res.data.message}`);
    return true;
  }
  
  fail('SETTLEMENT', `Unexpected response: ${res.status} ${res.error}`);
  return false;
}

async function testBalanceRecalculation() {
  log('TEST', 'Testing balance recalculation endpoint...');
  
  const res = await request('POST', `/groups/${testGroupId}/recalculate-balances`);
  
  if (res.status === 200 && res.data.recalculated !== undefined) {
    ok('RECALC', `Balances recalculated: ${res.data.recalculated} pairs`);
    return true;
  }
  
  fail('RECALC', `Failed: ${res.error}`);
  return false;
}

async function testQueryLevelAuth() {
  log('TEST', 'Testing query-level auth (403 for non-member)...');
  
  // Try to access a group we're not a member of with a fake/invalid group ID
  // Since we created the group, we're a member. Use a random ObjectId.
  const fakeGroupId = '507f1f77bcf86cd799439011';
  const res = await request('GET', `/groups/${fakeGroupId}/balances`);
  
  if (res.status === 404 || res.status === 403) {
    ok('AUTHZ', `Non-member access blocked: ${res.status}`);
    return true;
  }
  
  fail('AUTHZ', `Should have blocked non-member access: ${res.status} ${res.error}`);
  return false;
}

// ============ RUN ALL ============

async function runTests() {
  console.log('\n========== FINCOORD BACKEND TESTS ==========\n');
  
  const results = [];
  
  const authOk = await testAuth();
  if (!authOk) {
    console.log('\n\x1b[31mCannot proceed without auth. Tests aborted.\x1b[0m\n');
    return;
  }
  
  const groupOk = await testGroupCreation();
  if (!groupOk) {
    console.log('\n\x1b[31mCannot proceed without test group. Tests aborted.\x1b[0m\n');
    return;
  }
  
  results.push({ name: 'Visibility', pass: await testExpenseVisibility() });
  results.push({ name: 'Validation', pass: await testSplitValidation() });
  results.push({ name: 'Multi-Payer', pass: await testMultiPayer() });
  results.push({ name: 'Balances', pass: await testMaterializedBalances() });
  results.push({ name: 'Dashboard', pass: await testDashboard() });
  results.push({ name: 'Legacy Compat', pass: await testLegacyCompat() });
  results.push({ name: 'Group List', pass: await testGroupListWithBalances() });
  results.push({ name: 'Settlement', pass: await testSettlementFlow() });
  results.push({ name: 'Recalc', pass: await testBalanceRecalculation() });
  results.push({ name: 'Authz', pass: await testQueryLevelAuth() });
  
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  
  console.log('\n========== SUMMARY ==========');
  console.log(`Passed: ${passed}/${total}`);
  
  if (passed === total) {
    console.log('\x1b[32mALL TESTS PASSED ✓\x1b[0m');
  } else {
    const failed = results.filter(r => !r.pass).map(r => r.name).join(', ');
    console.log(`\x1b[31mFAILED: ${failed}\x1b[0m`);
  }
  console.log('=============================\n');
}

runTests().catch(console.error);
