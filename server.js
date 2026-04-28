require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const app = require('./src/app');
const Bill = require('./src/models/Bill');

const PORT = process.env.PORT || 3050;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/fincoord';

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, '0.0.0.0', () =>
      console.log(`FinCoord API running on port ${PORT}`),
    );

    // ── Recurring Bill Scheduler ──
    // Runs daily at 00:05 to spawn next month's recurring bills
    cron.schedule('5 0 * * *', async () => {
      try {
        const now = new Date();
        const handledRecurring = await Bill.find({
          isRecurring: true,
          status: 'handled',
          dueDate: { $lt: now },
        });

        for (const bill of handledRecurring) {
          const nextDue = new Date(bill.dueDate);
          nextDue.setMonth(nextDue.getMonth() + 1);

          // Only spawn if there isn't already a pending bill for this title + user + next due date
          const exists = await Bill.findOne({
            userId: bill.userId,
            title: bill.title,
            status: 'pending',
            dueDate: { $gte: nextDue },
          });

          if (!exists) {
            await Bill.create({
              userId: bill.userId,
              title: bill.title,
              amount: bill.amount,
              dueDate: nextDue,
              isRecurring: true,
              status: 'pending',
              category: bill.category,
              currency: bill.currency,
            });
          }

          // Mark the old bill as no longer the active instance
          // (keep it in history but don't spawn from it again)
          bill.isRecurring = false;
          await bill.save();
        }

        console.log(`[cron] Processed ${handledRecurring.length} recurring bills`);
      } catch (err) {
        console.error('[cron] Recurring bill scheduler error:', err.message);
      }
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
