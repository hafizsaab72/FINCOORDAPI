const router = require('express').Router();
const jwt = require('jsonwebtoken');
const path = require('path');
const multer = require('multer');
const User = require('../models/User');
const requireAuth = require('../middleware/auth');

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

// PUT /api/auth/profile — update text fields + base64 profilePic
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { name, phone, bio, dateOfBirth, currency, profilePic } = req.body;
    const fields = { name, phone, bio, dateOfBirth, currency };
    if (profilePic) fields.profilePic = profilePic; // base64 data URL stored directly in MongoDB
    const updated = await User.findByIdAndUpdate(
      req.user._id,
      fields,
      { new: true, runValidators: true, select: '-password' },
    );
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

module.exports = router;
