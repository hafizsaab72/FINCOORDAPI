const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const expenseRoutes = require('./routes/expenses');
const billRoutes = require('./routes/bills');
const groupRoutes = require('./routes/groups');
const activityRoutes = require('./routes/activities');
const dataRoutes    = require('./routes/data');
const usersRoutes   = require('./routes/users');
const friendsRoutes = require('./routes/friends');
const currencyRoutes = require('./routes/currency');
const exportRoutes   = require('./routes/export');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/bills', billRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/activities', activityRoutes);
app.use('/api/data',    dataRoutes);
app.use('/api/users',   usersRoutes);
app.use('/api/friends', friendsRoutes);
app.use('/api/currency', currencyRoutes);
app.use('/api/export',   exportRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

module.exports = app;
