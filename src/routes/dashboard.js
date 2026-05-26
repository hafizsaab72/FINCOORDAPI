const router = require('express').Router();
const Group = require('../models/Group');
const User = require('../models/User');
const Balance = require('../models/Balance');
const requireAuth = require('../middleware/auth');
const { getGroupBalances, simplifyDebts, getNonGroupBalancesPerspective } = require('../utils/balances');

router.use(requireAuth);

/**
 * GET /api/dashboard/balances
 *
 * Returns a user's complete financial picture across all groups AND non-group expenses.
 */
router.get('/balances', async (req, res) => {
  try {
    const myId = req.user._id.toString();

    // 1. Get all groups the user belongs to
    const myGroups = await Group.find({ members: req.user._id }).select('_id name type');

    // 2. Per-group data
    const byGroup = [];
    const personMap = new Map(); // otherUserId -> { groupsInCommon: [], netFromMyPerspective }
    const allSimplified = [];

    for (const group of myGroups) {
      const groupData = await getGroupBalances(group._id, req.user._id);

      byGroup.push({
        groupId: group._id,
        groupName: group.name,
        groupType: group.type,
        totalOwedToMe: groupData.totalOwedToYou,
        totalIOwe: groupData.totalYouOwe,
        netBalance: groupData.netBalance
      });

      for (const [otherId, net] of (groupData.effectiveMap || new Map())) {
        if (otherId === myId) continue;
        if (!personMap.has(otherId)) {
          personMap.set(otherId, { groupsInCommon: new Set(), netFromMe: 0 });
        }
        const p = personMap.get(otherId);
        p.groupsInCommon.add(group._id.toString());
        p.netFromMe += net;
      }

      for (const tx of (groupData.simplifiedTransactions || [])) {
        if (tx.from === myId || tx.to === myId) {
          allSimplified.push({ ...tx, groupId: group._id, groupName: group.name });
        }
      }
    }

    // 3. Non-group balances (direct expenses)
    const nonGroupMap = await getNonGroupBalancesPerspective(myId);

    for (const [otherId, data] of nonGroupMap) {
      if (otherId === myId) continue;
      if (!personMap.has(otherId)) {
        personMap.set(otherId, { groupsInCommon: new Set(), netFromMe: 0 });
      }
      const p = personMap.get(otherId);
      p.netFromMe += data.net;
    }

    // 4. Enrich person data with user details
    const personIds = Array.from(personMap.keys());
    const users = await User.find({ _id: { $in: personIds } }).select('name email profilePic');
    const userMap = new Map(users.map(u => [u._id.toString(), u]));

    const byPerson = [];
    for (const [uid, data] of personMap) {
      const user = userMap.get(uid);
      const net = data.netFromMe;
      byPerson.push({
        userId: uid,
        name: user?.name || 'Unknown',
        email: user?.email,
        profilePic: user?.profilePic,
        totalOwedToMe: net > 0 ? net : 0,
        totalIOwe: net < 0 ? Math.abs(net) : 0,
        netBalance: net,
        groupsInCommon: Array.from(data.groupsInCommon)
      });
    }

    // 5. Global summary
    let totalOwedToMe = 0;
    let totalIOwe = 0;
    for (const p of byPerson) {
      totalOwedToMe += p.totalOwedToMe;
      totalIOwe += p.totalIOwe;
    }

    // 5b. Expense counts and month totals for HomeScreen tiles
    const Expense = require('../models/Expense');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allExpenses, thisMonthExpenses, lastMonthExpenses] = await Promise.all([
      Expense.countDocuments({
        isDeleted: { $ne: true },
        $or: [
          { 'payments.userId': req.user._id },
          { 'splits.userId': req.user._id },
        ],
      }),
      Expense.find({
        isDeleted: { $ne: true },
        expenseDate: { $gte: startOfMonth, $lt: endOfMonth },
        $or: [
          { 'payments.userId': req.user._id },
          { 'splits.userId': req.user._id },
        ],
      }),
      Expense.find({
        isDeleted: { $ne: true },
        expenseDate: { $gte: startOfLastMonth, $lt: endOfLastMonth },
        $or: [
          { 'payments.userId': req.user._id },
          { 'splits.userId': req.user._id },
        ],
      }),
    ]);

    const thisMonthTotal = thisMonthExpenses.reduce((sum, e) => sum + e.totalAmount, 0);
    const lastMonthTotal = lastMonthExpenses.reduce((sum, e) => sum + e.totalAmount, 0);

    // 6. Global simplified debts
    const globalBalanceMap = new Map();
    for (const p of byPerson) {
      globalBalanceMap.set(p.userId, p.netBalance);
    }
    globalBalanceMap.set(myId, 0);

    const simplifiedTransactions = simplifyDebts(globalBalanceMap);
    for (const tx of simplifiedTransactions) {
      const fromUser = userMap.get(tx.from);
      const toUser = userMap.get(tx.to);
      tx.fromName = fromUser?.name || tx.from;
      tx.toName = toUser?.name || tx.to;
    }

    res.json({
      summary: {
        totalOwedToMe,
        totalIOwe,
        netBalance: totalOwedToMe - totalIOwe,
        currency: req.user.currency || 'INR',
        expenseCount: allExpenses,
        thisMonthTotal,
        lastMonthTotal,
      },
      byGroup,
      byPerson,
      simplifiedTransactions
    });
  } catch (err) {
    console.error('[DASHBOARD ERROR]', err);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

module.exports = router;
