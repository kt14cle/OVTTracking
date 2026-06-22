const { db } = require('./db');

const getEmployees = async (req, res) => {
  try {
    const snapshot = await db.collection('employees').orderBy('position').get();
    const employees = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const addEmployee = async (req, res) => {
  try {
    const { name, phone, seniority, list } = req.body;
    const snapshot = await db.collection('employees')
      .where('list', '==', list)
      .orderBy('position', 'desc')
      .limit(1)
      .get();
    const lastPosition = snapshot.empty ? 0 : snapshot.docs[0].data().position;
    const newEmployee = {
      name,
      phone,
      seniority,
      list: list || 'primary',
      position: lastPosition + 1,
      hours: 0,
      status: 'active',
      leaveReturnDate: null,
      pin: phone.slice(-4),
      createdAt: new Date().toISOString()
    };
    const ref = await db.collection('employees').add(newEmployee);
    res.json({ id: ref.id, ...newEmployee });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    if (updates.phone) {
      updates.pin = updates.phone.slice(-4);
    }
    await db.collection('employees').doc(id).update(updates);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    await db.collection('employees').doc(id).delete();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const resetHours = async (req, res) => {
  try {
    const { id } = req.params;
    if (id === 'all') {
      const snapshot = await db.collection('employees').get();
      const batch = db.batch();
      snapshot.docs.forEach(doc => batch.update(doc.ref, { hours: 0 }));
      await batch.commit();
    } else {
      await db.collection('employees').doc(id).update({ hours: 0 });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const setLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { returnDate } = req.body;
    await db.collection('employees').doc(id).update({
      status: 'onLeave',
      leaveReturnDate: returnDate
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { getEmployees, addEmployee, updateEmployee, deleteEmployee, resetHours, setLeave };