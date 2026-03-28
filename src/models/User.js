const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:    { type: String, required: true, minlength: 6 },
    phone:       { type: String, default: '' },
    bio:         { type: String, default: '' },
    dateOfBirth: { type: Date },
    profilePic:  { type: String, default: '' }, // filename served from /uploads
    currency:    { type: String, default: 'USD' },
    country:     { type: String, default: '' }, // ISO 3166-1 alpha-2, e.g. "GB"
    fcmToken:    { type: String, default: '' },
    isPro:       { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Hash password before save
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

UserSchema.methods.comparePassword = function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

// Strip password from any response
UserSchema.methods.toSafeObject = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', UserSchema);
