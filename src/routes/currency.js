const router = require('express').Router();
const requireAuth = require('../middleware/auth');

let cachedRates = null;
let cachedAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function fetchRates() {
  const now = Date.now();
  if (cachedRates && now - cachedAt < CACHE_TTL_MS) {
    return cachedRates;
  }
  const res = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
  if (!res.ok) throw new Error('Failed to fetch exchange rates');
  const data = await res.json();
  cachedRates = data.rates;
  cachedAt = now;
  return cachedRates;
}

router.use(requireAuth);

// GET /api/currency/rates
router.get('/rates', async (req, res) => {
  try {
    const rates = await fetchRates();
    res.json({ base: 'USD', rates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/currency/convert?from=USD&to=EUR&amount=100
router.get('/convert', async (req, res) => {
  try {
    const { from, to, amount } = req.query;
    if (!from || !to || !amount) {
      return res.status(400).json({ error: 'from, to, and amount are required' });
    }
    const rates = await fetchRates();
    const numAmount = parseFloat(amount);
    if (!rates[from] || !rates[to]) {
      return res.status(400).json({ error: 'Unsupported currency' });
    }
    // Convert via USD base
    const inUSD = numAmount / rates[from];
    const result = inUSD * rates[to];
    res.json({ from, to, amount: numAmount, result: parseFloat(result.toFixed(4)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
