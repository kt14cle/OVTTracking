const { db } = require('./db');
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const sendSMS = async (to, message) => {
  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to
    });
  } catch (error) {
    // Notify manager of Twilio failure
    await client.messages.create({
      body: `SYSTEM ALERT: Failed to send SMS to ${to}. Please handle manually.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.MANAGER_PHONE_NUMBER
    });
  }
};

// Post a new shift
const postShift = async (req, res) => {
  try {
    const { date, startTime, stopTime, totalHours, responseWindow } = req.body;
    const shift = {
      date,
      startTime,
      stopTime,
      totalHours,
      responseWindow,
      status: 'active',
      currentList: 'primary',
      offeredTo: [],
      acceptedBy: null,
      cancelledAt: null,
      createdAt: new Date().toISOString()
    };
    const ref = await db.collection('shifts').add(shift);
    const shiftId = ref.id;

    // Get first employee in rotation
    await offerShiftToNext(shiftId, 'primary');
    res.json({ id: shiftId, ...shift });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Offer shift to next employee in rotation
const offerShiftToNext = async (shiftId, list) => {
  const shiftRef = db.collection('shifts').doc(shiftId);
  const shiftDoc = await shiftRef.get();
  const shift = shiftDoc.data();

  // Get active employees in order
  const snapshot = await db.collection('employees')
    .where('list', '==', list)
    .where('status', '==', 'active')
    .orderBy('position')
    .get();

  const employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const offeredIds = shift.offeredTo.map(o => o.employeeId);
  const next = employees.find(e => !offeredIds.includes(e.id));

  if (!next) {
    if (list === 'primary') {
      // Move to secondary list
      await shiftRef.update({ currentList: 'secondary' });
      await offerShiftToNext(shiftId, 'secondary');
    } else {
      // Nobody accepted - notify manager
      await shiftRef.update({ status: 'unfilled' });
      const msg = `OVERTIME ALERT: Shift on ${shift.date} from ${shift.startTime} to ${shift.stopTime} (${shift.totalHours}hrs) was not accepted by anyone. Please handle manually.`;
      await sendSMS(process.env.MANAGER_PHONE_NUMBER, msg);
    }
    return;
  }

  // Record offer
  const offerTime = new Date().toISOString();
  const expiresAt = new Date(Date.now() + shift.responseWindow * 60 * 60 * 1000).toISOString();
  await shiftRef.update({
    offeredTo: [...shift.offeredTo, { employeeId: next.id, name: next.name, offeredAt: offerTime, expiresAt, response: 'pending' }]
  });

  // Send SMS to employee
  const msg = `Hi ${next.name}, an overtime shift is available:\nDate: ${shift.date}\nTime: ${shift.startTime} - ${shift.stopTime}\nHours: ${shift.totalHours}\nReply ACCEPT or DECLINE within ${shift.responseWindow} hours.`;
  await sendSMS(next.phone, msg);
};

// Handle SMS response from employee (Twilio webhook)
const handleResponse = async (req, res) => {
  try {
    const { From, Body } = req.body;
    const response = Body.trim().toUpperCase();
    const phone = From;

    // Find employee by phone
    const empSnapshot = await db.collection('employees').where('phone', '==', phone).get();
    if (empSnapshot.empty) {
      res.send('<Response></Response>');
      return;
    }
    const empDoc = empSnapshot.docs[0];
    const employee = { id: empDoc.id, ...empDoc.data() };

    // Find active shift offered to this employee
    const shiftSnapshot = await db.collection('shifts')
      .where('status', '==', 'active')
      .get();

    let activeShift = null;
    let shiftRef = null;

    for (const doc of shiftSnapshot.docs) {
      const data = doc.data();
      const offer = data.offeredTo.find(o => o.employeeId === employee.id && o.response === 'pending');
      if (offer) {
        activeShift = { id: doc.id, ...data };
        shiftRef = doc.ref;
        break;
      }
    }

    if (!activeShift) {
      res.send('<Response></Response>');
      return;
    }

    if (response === 'ACCEPT') {
      // Update offer record
      const updatedOffers = activeShift.offeredTo.map(o =>
        o.employeeId === employee.id ? { ...o, response: 'accepted' } : o
      );
      await shiftRef.update({
        offeredTo: updatedOffers,
        acceptedBy: { employeeId: employee.id, name: employee.name },
        status: 'filled'
      });

      // Add hours to employee
      await db.collection('employees').doc(employee.id).update({
        hours: employee.hours + activeShift.totalHours,
        position: 99999
      });

      // Reorder positions
      await reorderPositions(employee.list);

      // Notify manager
      const msg = `OVERTIME UPDATE: ${employee.name} accepted the shift on ${activeShift.date} (${activeShift.totalHours}hrs).`;
      await sendSMS(process.env.MANAGER_PHONE_NUMBER, msg);

    } else if (response === 'DECLINE') {
      // Update offer record
      const updatedOffers = activeShift.offeredTo.map(o =>
        o.employeeId === employee.id ? { ...o, response: 'declined' } : o
      );
      await shiftRef.update({ offeredTo: updatedOffers });

      // Move employee to bottom
      await db.collection('employees').doc(employee.id).update({ position: 99999 });
      await reorderPositions(employee.list);

      // Offer to next
      await offerShiftToNext(activeShift.id, activeShift.currentList);
    }

    res.send('<Response></Response>');
  } catch (error) {
    console.error(error);
    res.send('<Response></Response>');
  }
};

// Reorder positions after a change
const reorderPositions = async (list) => {
  const snapshot = await db.collection('employees')
    .where('list', '==', list)
    .orderBy('position')
    .get();
  const batch = db.batch();
  snapshot.docs.forEach((doc, index) => {
    batch.update(doc.ref, { position: index + 1 });
  });
  await batch.commit();
};

// Get all shifts
const getShifts = async (req, res) => {
  try {
    const snapshot = await db.collection('shifts').orderBy('createdAt', 'desc').get();
    const shifts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(shifts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Cancel a shift
const cancelShift = async (req, res) => {
  try {
    const { id } = req.params;
    const shiftRef = db.collection('shifts').doc(id);
    const shiftDoc = await shiftRef.get();
    const shift = shiftDoc.data();

    if (shift.status !== 'active') {
      return res.status(400).json({ error: 'Shift is not active' });
    }

    // Notify everyone who was contacted
    for (const offer of shift.offeredTo) {
      const empDoc = await db.collection('employees').doc(offer.employeeId).get();
      const emp = empDoc.data();
      const msg = `OVERTIME UPDATE: The shift on ${shift.date} (${shift.totalHours}hrs) has been cancelled and is no longer available.`;
      await sendSMS(emp.phone, msg);

      // If they had accepted, roll back their hours and position
      if (offer.response === 'accepted') {
        await db.collection('employees').doc(offer.employeeId).update({
          hours: emp.hours - shift.totalHours,
          position: offer.originalPosition
        });
        await reorderPositions(emp.list);
      } else if (offer.response === 'pending') {
        // Employee was mid-offer, keep their position
      }
    }

    await shiftRef.update({ status: 'cancelled', cancelledAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { postShift, handleResponse, getShifts, cancelShift, offerShiftToNext, reorderPositions };