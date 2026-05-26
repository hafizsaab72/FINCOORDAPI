/**
 * Expense Split Validation Utilities
 *
 * Validates that payments and splits sum correctly.
 * All amounts should be in minor units (integer paise/cents).
 */

const ISO_4217_REGEX = /^[A-Z]{3}$/;

/**
 * Validates an expense's payments and splits against the spec.
 * @param {Object} expense
 * @param {number} expense.totalAmount - Total in minor units
 * @param {Array} expense.payments - Array of { userId, amount }
 * @param {Array} expense.splits - Array of { userId, owedAmount, shareType?, shareValue? }
 * @param {string} expense.splitType - 'equal' | 'exact' | 'percentage' | 'shares' | 'adjustment'
 * @param {string} expense.title
 * @param {string} expense.baseCurrency
 * @param {Date} expense.expenseDate
 * @returns {{ isValid: boolean, errors: string[] }}
 */
function validateExpenseSplit(expense) {
  const errors = [];
  const {
    title,
    totalAmount,
    baseCurrency,
    expenseDate,
    payments = [],
    splits = [],
    splitType,
    isRecurring,
    recurrenceRule
  } = expense;

  // ── Global Rules (G1–G8) ──
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('Title is required');
  }

  if (!Number.isInteger(totalAmount) || totalAmount <= 0) {
    errors.push(`Total amount must be a positive integer (minor units). Got: ${totalAmount}`);
  }

  if (!baseCurrency || !ISO_4217_REGEX.test(baseCurrency)) {
    errors.push(`Currency must be a valid ISO 4217 code. Got: ${baseCurrency}`);
  }

  if (!expenseDate || isNaN(new Date(expenseDate).getTime())) {
    errors.push('Date is required');
  }

  // Active participants = splits where owedAmount > 0 (or not explicitly excluded)
  const activeParticipants = splits.filter(s => s.owedAmount > 0 && !s.isExcluded);
  if (activeParticipants.length < 2) {
    errors.push('At least 2 active participants required');
  }

  // Payer must be an active participant or the self-excluded payer
  const payerIds = new Set(payments.map(p => p.userId.toString()));
  const splitUserIds = new Set(splits.map(s => s.userId.toString()));
  for (const pid of payerIds) {
    if (!splitUserIds.has(pid)) {
      errors.push(`Payer ${pid} must be an active participant or the self-excluded payer`);
    }
  }

  // ── Multiple Payer Rules (MP1–MP3) ──
  const nonZeroPayers = payments.filter(p => p.amount > 0);
  const isMultiplePayer = nonZeroPayers.length >= 2;

  if (isMultiplePayer) {
    // MP3: at least 2 payers with non-zero
    if (nonZeroPayers.length < 2) {
      errors.push('At least 2 payers must have non-zero amounts');
    }
    // MP1: exact amounts only for payer contributions
    for (const p of payments) {
      if (!Number.isInteger(p.amount) || p.amount < 0) {
        errors.push(`Payer amount must be a non-negative integer. Got: ${p.amount}`);
      }
    }
    // MP2: payer sum must equal total
    const paymentSum = payments.reduce((sum, p) => sum + p.amount, 0);
    if (paymentSum !== totalAmount) {
      errors.push(`Payer amounts sum (${paymentSum}) != totalAmount (${totalAmount})`);
    }
  }

  // ── Splits sum = total (G7) ──
  const splitSum = splits.reduce((sum, s) => {
    if (!Number.isInteger(s.owedAmount) || s.owedAmount < 0) {
      errors.push(`Split owedAmount must be non-negative integer. Got: ${s.owedAmount}`);
      return sum;
    }
    return sum + s.owedAmount;
  }, 0);

  if (splitSum !== totalAmount) {
    errors.push(`Splits sum (${splitSum}) != totalAmount (${totalAmount})`);
  }

  // ── Split Method Specific Rules (SM1–SM7) ──
  if (splitType === 'exact') {
    for (const s of splits) {
      if (s.owedAmount < 0) errors.push('Exact amounts must be >= 0');
    }
  }

  if (splitType === 'percentage') {
    const totalPct = splits.reduce((sum, s) => sum + (s.shareValue || 0), 0);
    if (Math.abs(totalPct - 100) > 0.001) {
      errors.push(`Percentages must sum to 100. Got: ${totalPct}`);
    }
    for (const s of splits) {
      if ((s.shareValue || 0) <= 0) errors.push('All percentages must be > 0');
    }
  }

  if (splitType === 'shares') {
    for (const s of splits) {
      if ((s.shareValue || 0) <= 0) errors.push('All share values must be > 0');
    }
  }

  if (splitType === 'adjustment') {
    const totalAdjustment = splits.reduce((sum, s) => sum + (s.shareValue || 0), 0);
    if (Math.abs(totalAdjustment) > 0.001) {
      errors.push(`Adjustment deltas must sum to 0. Got: ${totalAdjustment}`);
    }
    const base = totalAmount / splits.length;
    for (const s of splits) {
      const adj = s.shareValue || 0;
      if (base + adj < 0) {
        errors.push(`Adjustment would produce a negative amount for user ${s.userId}`);
      }
    }
  }

  // ── Recurring Rules (R1–R3) ──
  if (isRecurring) {
    if (!recurrenceRule || !recurrenceRule.frequency) {
      errors.push('Recurrence rule required if recurring');
    }
    const validFrequencies = ['daily', 'weekly', 'fortnightly', 'monthly', 'yearly'];
    if (recurrenceRule && !validFrequencies.includes(recurrenceRule.frequency)) {
      errors.push('Invalid recurrence frequency');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Distributes totalAmount equally among count participants.
 * Remainder goes to the FIRST participant (index 0) to match spec.
 * @param {number} totalAmount - Minor units
 * @param {number} count - Number of participants
 * @returns {Array<{amount: number}>}
 */
function distributeEqual(totalAmount, count) {
  if (count <= 0) throw new Error('Count must be > 0');

  const base = Math.floor(totalAmount / count);
  const remainder = totalAmount - (base * count);

  const distribution = [];
  for (let i = 0; i < count; i++) {
    distribution.push({
      amount: base + (i === 0 ? remainder : 0)
    });
  }
  return distribution;
}

/**
 * Distributes by percentage.
 * Remainder goes to the LAST participant to preserve exact total.
 * @param {number} totalAmount - Minor units
 * @param {Array<{userId: string, percentage: number}>} entries
 * @returns {Array<{userId: string, amount: number}>}
 */
function distributeByPercentage(totalAmount, entries) {
  const totalPct = entries.reduce((sum, e) => sum + e.percentage, 0);
  if (Math.abs(totalPct - 100) > 0.001) {
    throw new Error(`Percentages must sum to 100. Got: ${totalPct}`);
  }

  let allocated = 0;
  const distribution = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let amount;

    if (i === entries.length - 1) {
      amount = totalAmount - allocated;
    } else {
      amount = Math.floor((totalAmount * entry.percentage) / 100);
    }

    allocated += amount;
    distribution.push({ userId: entry.userId, amount });
  }

  return distribution;
}

/**
 * Distributes by shares.
 * Remainder goes to the LAST participant.
 * @param {number} totalAmount - Minor units
 * @param {Array<{userId: string, shares: number}>} entries
 * @returns {Array<{userId: string, amount: number}>}
 */
function distributeByShares(totalAmount, entries) {
  const totalShares = entries.reduce((sum, e) => sum + e.shares, 0);
  if (totalShares <= 0) throw new Error('Total shares must be > 0');

  let allocated = 0;
  const distribution = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let amount;

    if (i === entries.length - 1) {
      amount = totalAmount - allocated;
    } else {
      amount = Math.floor((totalAmount * entry.shares) / totalShares);
    }

    allocated += amount;
    distribution.push({ userId: entry.userId, amount });
  }

  return distribution;
}

/**
 * Distributes by adjustment.
 * Base equal split + per-participant adjustment delta.
 * @param {number} totalAmount - Minor units
 * @param {Array<{userId: string, adjustment: number}>} entries
 * @returns {Array<{userId: string, amount: number}>}
 */
function distributeByAdjustment(totalAmount, entries) {
  const count = entries.length;
  if (count <= 0) throw new Error('Count must be > 0');

  const base = Math.floor(totalAmount / count);
  const remainder = totalAmount - (base * count);

  const totalAdjustment = entries.reduce((sum, e) => sum + e.adjustment, 0);
  if (Math.abs(totalAdjustment) > 0.001) {
    throw new Error(`Adjustments must sum to 0. Got: ${totalAdjustment}`);
  }

  const distribution = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const amount = base + (i === 0 ? remainder : 0) + entry.adjustment;
    if (amount < 0) {
      throw new Error(`Adjustment would produce a negative amount for user ${entry.userId}`);
    }
    distribution.push({ userId: entry.userId, amount });
  }

  return distribution;
}

/**
 * Formats minor units to currency string.
 * @param {number} minorAmount
 * @param {string} currency
 * @returns {string}
 */
function formatCurrency(minorAmount, currency = 'INR') {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
  }).format(minorAmount / 100);
}

/**
 * Converts major currency amount to minor units.
 * @param {number|string} majorAmount
 * @returns {number}
 */
function toMinorUnits(majorAmount) {
  return Math.round(parseFloat(String(majorAmount).replace(/,/g, '')) * 100);
}

/**
 * Converts minor units to major amount string.
 * @param {number} minorAmount
 * @returns {string}
 */
function toMajorUnits(minorAmount) {
  return (minorAmount / 100).toFixed(2);
}

module.exports = {
  validateExpenseSplit,
  distributeEqual,
  distributeByPercentage,
  distributeByShares,
  distributeByAdjustment,
  formatCurrency,
  toMinorUnits,
  toMajorUnits
};
