require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

async function test() {
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('Connected to MongoDB');
    
    const User = require('./src/models/User');
    
    // Try to create a user
    const email = 'debug@fincoord.app';
    const password = 'testpass123';
    
    // Remove existing
    await User.deleteOne({ email });
    
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('Hashed password length:', hashedPassword.length);
    
    const user = await User.create({ name: 'Debug User', email, password: hashedPassword, phone: '+919999999990' });
    console.log('User created:', user._id.toString());
    console.log('User name:', user.name);
    
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    console.log('Token created:', token.substring(0, 20) + '...');
    
    // Clean up
    await User.deleteOne({ email });
    
    await mongoose.disconnect();
    console.log('Done');
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

test();
