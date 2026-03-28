const router = require('express').Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');
const admin = require('firebase-admin');

// Lazy Firebase Admin init (reuses the instance from push.js if already started)
function getFirebaseAdmin() {
  if (!admin.apps.length) {
    try {
      const serviceAccount = require(path.join(__dirname, '../../firebase-service-account.json'));
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    } catch {
      admin.initializeApp(); // falls back to GOOGLE_APPLICATION_CREDENTIALS
    }
  }
  return admin;
}

// Profile photo upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) =>
    cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user._id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  },
});

const signToken = id =>
  jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: 'Name, email and password are required' });

    if (await User.findOne({ email }))
      return res.status(409).json({ error: 'Email already registered' });

    const user = await User.create({ name, email, password, phone: phone || '' });
    res.status(201).json({ token: signToken(user._id), user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: 'Email and password are required' });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ error: 'Incorrect email or password' });

    res.json({ token: signToken(user._id), user: user.toSafeObject() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user.toSafeObject() });
});

// PUT /api/auth/profile — update text fields + base64 profilePic + optional email/password
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, phone, bio, dateOfBirth, currency, profilePic, email, newPassword } = req.body;

    // If caller wants to add/change email, check it isn't already taken
    if (email) {
      const conflict = await User.findOne({
        email: email.toLowerCase().trim(),
        _id: { $ne: req.user._id },
      });
      if (conflict) return res.status(409).json({ error: 'Email already registered to another account' });
    }

    const fields = {};
    if (name        !== undefined) fields.name        = name;
    if (phone       !== undefined) fields.phone       = phone;
    if (bio         !== undefined) fields.bio         = bio;
    if (dateOfBirth !== undefined) fields.dateOfBirth = dateOfBirth;
    if (currency    !== undefined) fields.currency    = currency;
    if (profilePic)                fields.profilePic  = profilePic;
    if (email)                     fields.email       = email.toLowerCase().trim();

    await User.findByIdAndUpdate(req.user._id, fields, { runValidators: true });

    // Password must go through the pre-save bcrypt hook — use .save()
    if (newPassword && newPassword.length >= 6) {
      const userDoc = await User.findById(req.user._id);
      userDoc.password = newPassword;
      await userDoc.save();
    }

    const updated = await User.findById(req.user._id).select('-password');
    res.json({ user: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/auth/account — permanently delete user + all their data
router.delete('/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const Expense  = require('../models/Expense');
    const Bill     = require('../models/Bill');
    const Group    = require('../models/Group');
    const Activity = require('../models/Activity');

    await Promise.all([
      Expense.deleteMany({ userId }),
      Bill.deleteMany({ userId }),
      Group.deleteMany({ createdBy: userId }),
      Activity.deleteMany({ userId }),
      User.findByIdAndDelete(userId),
    ]);

    res.json({ message: 'Account permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/phone
// Body: { idToken: string, name?: string }
// Verifies Firebase Phone Auth ID token → find or create user → return JWT
router.post('/phone', async (req, res) => {
  try {
    const { idToken, name, country } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });

    // Verify Firebase ID token
    const firebaseUser = await getFirebaseAdmin().auth().verifyIdToken(idToken);
    const phone = firebaseUser.phone_number; // always E.164, e.g. "+917760556716"
    if (!phone) return res.status(400).json({ error: 'Token does not contain a phone number' });

    // Find existing user by E.164 phone (profile screen now always saves E.164)
    let user = await User.findOne({ phone });
    if (!user) {
      // New user — name required for first sign-up
      const displayName = name?.trim() || `User${phone.slice(-4)}`;
      // Generate a placeholder email so the unique index doesn't conflict
      const placeholderEmail = `phone_${phone.replace(/\+/g, '')}@fincoord.internal`;
      user = await User.create({
        name: displayName,
        email: placeholderEmail,
        password: Math.random().toString(36), // random, user will never use it
        phone,
        country: country || '',
      });
    } else if (country && !user.country) {
      // Backfill country if missing on existing user
      user.country = country;
      await user.save();
    }

    res.json({ token: signToken(user._id), user: user.toSafeObject() });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

module.exports = router;
