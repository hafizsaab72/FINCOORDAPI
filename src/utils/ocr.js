const { createWorker } = require('tesseract.js');

/**
 * Runs OCR on a base64-encoded image string.
 * Returns { amount, merchant, date, rawText } — fields are null if not found.
 */
async function scanReceipt(base64Image) {
  // Strip data URL prefix if present
  const base64 = base64Image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64, 'base64');

  const worker = await createWorker('eng');
  let rawText = '';
  try {
    const { data } = await worker.recognize(buffer);
    rawText = data.text || '';
  } finally {
    await worker.terminate();
  }

  return {
    amount: extractAmount(rawText),
    merchant: extractMerchant(rawText),
    date: extractDate(rawText),
    rawText,
  };
}

/**
 * Finds the largest dollar/total amount on the receipt.
 * Matches patterns like: Total 12.34, $12.34, TOTAL: $12.34, etc.
 */
function extractAmount(text) {
  // Prefer lines that contain total/amount keywords
  const totalPattern = /(?:total|amount|grand total|subtotal|balance)[^\d]*\$?\s*([\d,]+\.\d{2})/i;
  const totalMatch = text.match(totalPattern);
  if (totalMatch) {
    return parseFloat(totalMatch[1].replace(',', ''));
  }

  // Fallback: largest dollar amount in the text
  const allAmounts = [...text.matchAll(/\$?\s*([\d,]+\.\d{2})/g)].map(m =>
    parseFloat(m[1].replace(',', '')),
  );
  if (allAmounts.length === 0) return null;
  return Math.max(...allAmounts);
}

/**
 * Extracts the merchant name — heuristic: first non-empty, non-numeric line.
 */
function extractMerchant(text) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 2 && !/^\d/.test(l) && !/receipt|invoice|tax|tel|phone|www|http/i.test(l));
  return lines[0] || null;
}

/**
 * Extracts the first recognisable date from the text.
 */
function extractDate(text) {
  // MM/DD/YYYY or MM-DD-YYYY
  const match = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (!match) return null;
  const [, m, d, y] = match;
  const year = y.length === 2 ? `20${y}` : y;
  return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

module.exports = { scanReceipt };
