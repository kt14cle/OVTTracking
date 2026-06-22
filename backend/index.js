require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 3001;

const { getEmployees, addEmployee, updateEmployee, deleteEmployee, resetHours, setLeave } = require('./employees');
const { postShift, handleResponse, getShifts, cancelShift } = require('./shifts');
const { getRotation, resetRotation, checkLeaveReturns, checkExpiredOffers } = require('./rotation');

app.get('/employees', getEmployees);
app.post('/employees', addEmployee);
app.put('/employees/:id', updateEmployee);
app.delete('/employees/:id', deleteEmployee);
app.post('/employees/:id/reset-hours', resetHours);
app.post('/employees/all/reset-hours', resetHours);
app.post('/employees/:id/leave', setLeave);

app.get('/shifts', getShifts);
app.post('/shifts', postShift);
app.post('/shifts/:id/cancel', cancelShift);

app.post('/sms', handleResponse);

app.get('/rotation', getRotation);
app.post('/rotation/reset', resetRotation);

cron.schedule('0 0 1 1 *', async () => {
  console.log('Jan 1 reset running...');
  await resetRotation();
});

cron.schedule('* * * * *', async () => {
  await checkExpiredOffers();
  await checkLeaveReturns();
});

app.get('/', (req, res) => {
  res.send('Overtime Tracker API is running');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});