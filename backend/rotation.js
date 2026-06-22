const { db } = require('./db');
const { reorderPositions } = require('./shifts');

// Get current rotation order
const getRotation = async (req, res) => {
  try {
    const primarySnapshot = await db.collection('employees')
      .where('list', '==', 'primary')
      .orderBy('position')
      .get();
    const secondarySnapshot = await db.collection('employees')
      .where('list', '==', 'secondary')
      .orderBy('position')
      .get();

    const primary = primarySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const secondary = secondarySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.json({ primary, secondary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Reset rotation to seniority order on Jan 1
const resetRotation = async (req, res) => {
  try {
    const snapshot = await db.collection('employees').get();
    const batch = db.batch();

    // Reset hours and reorder by seniority for each list
    const primary = [];
    const secondary = [];

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      batch.update(doc.ref, { hours: 0, status: 'active', leaveReturnDate: null });
      if (data.list === 'primary') primary.push({ id: doc.id, ...data });
      else secondary.push({ id: doc.id, ...data });
    });

    await batch.commit();

    // Reorder by seniority
    const reorderBySeniority = async (employees) => {
      const sorted = employees.sort((a, b) => a.seniority - b.seniority);
      const batch2 = db.batch();
      sorted.forEach((emp, index) => {
        batch2.update(db.collection('employees').doc(emp.id), { position: index + 1 });
      });
      await batch2.commit();
    };

    await reorderBySeniority(primary);
    await reorderBySeniority(secondary);

    res.json({ success: true, message: 'Rotation reset to seniority order' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Check and reinstate employees returning from leave
const checkLeaveReturns = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await db.collection('employees')
      .where('status', '==', 'onLeave')
      .get();

    for (const doc of snapshot.docs) {
      const emp = doc.data();
      if (emp.leaveReturnDate && emp.leaveReturnDate <= today) {
        // Put them at the bottom of their list
        await doc.ref.update({
          status: 'active',
          leaveReturnDate: null,
          position: 99999
        });
        await reorderPositions(emp.list);
      }
    }
  } catch (error) {
    console.error('Leave check error:', error);
  }
};

// Check for expired offers
const checkExpiredOffers = async () => {
  try {
    const now = new Date().toISOString();
    const snapshot = await db.collection('shifts')
      .where('status', '==', 'active')
      .get();

    for (const doc of snapshot.docs) {
      const shift = doc.data();
      const pendingOffer = shift.offeredTo.find(o => o.response === 'pending');
      if (pendingOffer && pendingOffer.expiresAt < now) {
        // Mark as declined
        const updatedOffers = shift.offeredTo.map(o =>
          o.employeeId === pendingOffer.employeeId ? { ...o, response: 'declined' } : o
        );
        await doc.ref.update({ offeredTo: updatedOffers });

        // Move employee to bottom
        await db.collection('employees').doc(pendingOffer.employeeId).update({ position: 99999 });
        await reorderPositions(shift.currentList);

        // Offer to next
        const { offerShiftToNext } = require('./shifts');
        await offerShiftToNext(doc.id, shift.currentList);
      }
    }
  } catch (error) {
    console.error('Expired offer check error:', error);
  }
};

module.exports = { getRotation, resetRotation, checkLeaveReturns, checkExpiredOffers };
