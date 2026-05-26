/**
 * Multi-Payer Balance Correctness Test
 * Creates 3 real users, 1 group, 1 multi-payer expense, and checks balances.
 */

const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

const API_BASE = 'http://localhost:3050/api';

async function request(method, path, data = null, headers = {}) {
  const url = `${API_BASE}${path}`;
  const config = { headers };
  try {
    const response = await axios({ method, url, data, ...config });
    return { status: response.status, data: response.data, error: null };
  } catch (err) {
    return { status: err.response?.status || 0, data: err.response?.data || null, error: err.response?.data?.error || err.message };
  }
}

async function createUser(name, email) {
  const reg = await request('POST', '/auth/register', { name, email, password: 'testpass123', phone: '+919999999999' });
  if (reg.status === 201 || reg.status === 200) {
    const login = await request('POST', '/auth/login', { email, password: 'testpass123' });
    if (login.data?.token) return { token: login.data.token, userId: login.data.user._id, name };
  }
  // Try login if already exists
  const login = await request('POST', '/auth/login', { email, password: 'testpass123' });
  if (login.data?.token) return { token: login.data.token, userId: login.data.user._id, name };
  throw new Error(`Failed to create/login user ${email}: ${reg.error || login.error}`);
}

async function run() {
  console.log('\n=== Multi-Payer Balance Test ===\n');

  // Create 3 users
  const alice = await createUser('Alice', 'alice@fincoord.app');
  const bob = await createUser('Bob', 'bob@fincoord.app');
  const charlie = await createUser('Charlie', 'charlie@fincoord.app');
  console.log(`Users: Alice=${alice.userId}, Bob=${bob.userId}, Charlie=${charlie.userId}`);

  // Alice creates a group with Bob and Charlie
  const group = await request('POST', '/groups', {
    name: 'Trip Expenses',
    memberIds: [bob.userId, charlie.userId]
  }, { Authorization: `Bearer ${alice.token}` });

  if (group.status !== 201) {
    console.log('Group creation failed:', group.error);
    return;
  }
  const groupId = group.data.group._id;
  console.log(`Group created: ${groupId}`);

  // Multi-payer expense: Alice paid 500, Bob paid 300, total 800
  // Split equally: Alice 266.67, Bob 266.67, Charlie 266.66
  const expense = await request('POST', '/expenses', {
    description: 'Dinner',
    totalAmount: '800.00',
    payments: [
      { userId: alice.userId, amount: '500.00' },
      { userId: bob.userId, amount: '300.00' }
    ],
    splits: [
      { userId: alice.userId, owedAmount: '266.67' },
      { userId: bob.userId, owedAmount: '266.67' },
      { userId: charlie.userId, owedAmount: '266.66' }
    ],
    groupId,
    splitType: 'unequal'
  }, { Authorization: `Bearer ${alice.token}` });

  if (expense.status !== 201) {
    console.log('Expense creation failed:', expense.error);
    return;
  }
  console.log(`Expense created: ${expense.data.expense._id}`);

  // Check balances from Alice's perspective
  const balances = await request('GET', `/groups/${groupId}/balances`, null, { Authorization: `Bearer ${alice.token}` });
  console.log('\n--- Alice\'s Balance View ---');
  console.log(JSON.stringify(balances.data, null, 2));

  // Expected per-user net:
  // Alice: paid 500 - owed 266.67 = +233.33 (owed to her)
  // Bob: paid 300 - owed 266.67 = +33.33 (owed to him)
  // Charlie: paid 0 - owed 266.66 = -266.66 (owes)
  // Simplified: Charlie pays Alice 233.33, Charlie pays Bob 33.33

  console.log('\n--- Expected ---');
  console.log('Alice net: +233.33 (paid 500, owed 266.67)');
  console.log('Bob net: +33.33 (paid 300, owed 266.67)');
  console.log('Charlie net: -266.66 (paid 0, owed 266.66)');
  console.log('Simplified: Charlie -> Alice 233.33, Charlie -> Bob 33.33');

  // Cleanup
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/fincoord');
  const User = require('./src/models/User');
  const Expense = require('./src/models/Expense');
  const Group = require('./src/models/Group');
  const Balance = require('./src/models/Balance');
  await Expense.deleteOne({ _id: expense.data.expense._id });
  await Balance.deleteMany({ groupId });
  await Group.deleteOne({ _id: groupId });
  await User.deleteMany({ email: { $in: ['alice@fincoord.app', 'bob@fincoord.app', 'charlie@fincoord.app'] } });
  await mongoose.disconnect();
  console.log('\nCleanup done.');
}

run().catch(err => { console.error(err); process.exit(1); });
