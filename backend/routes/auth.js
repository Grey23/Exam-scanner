const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { verifyToken } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not configured. Auth routes require JWT signing secret.');
}

function getJwtSecret() {
  if (!JWT_SECRET) {
    throw new Error('Server misconfiguration: JWT_SECRET is required');
  }
  return JWT_SECRET;
}

// REGISTER - Save user to database
router.post('/register', async (req, res) => {
  try {
    const { email, password, name, userType, schoolName } = req.body;

    console.log('========== REGISTER REQUEST ==========');
    console.log('Email:', email);
    console.log('Name:', name);
    console.log('User Type:', userType);
    console.log('School Name:', schoolName);
    console.log('=====================================');

    // Validate input
    if (!email || !password || !name || !userType) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Only allow 'teacher' and 'school' (admin) user types
    if (userType !== 'teacher' && userType !== 'school') {
      console.log('❌ Invalid user type:', userType);
      return res.status(400).json({ error: 'Invalid user type. Only teacher and school admin are allowed.' });
    }

    // School name is required for school (admin) accounts
    if (userType === 'school' && !schoolName) {
      console.log('❌ School name required for admin accounts');
      return res.status(400).json({ error: 'School name is required for admin accounts' });
    }

    console.log('✅ Validation passed, connecting to database...');
    const connection = await pool.getConnection();
    console.log('✅ Database connection acquired');

    // Check if email exists
    const [existingUsers] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      connection.release();
      console.log('❌ Email already registered:', email);
      return res.status(400).json({ error: 'Email already registered' });
    }

    console.log('✅ Email is unique, hashing password...');
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    console.log('✅ Password hashed');

    // Handle school_id assignment
    let schoolId = null;
    
    if (userType === 'school') {
      // For admin users, create a new school entry
      console.log('✅ Creating new school for admin user...');
      const [schoolResult] = await connection.query(
        'INSERT INTO schools (name) VALUES (?)',
        [schoolName]
      );
      schoolId = schoolResult.insertId;
      console.log('✅ School created with ID:', schoolId);
    } else if (userType === 'teacher') {
      // For teachers, assign to default school (id=1) or existing school
      console.log('✅ Checking for default school...');
      const [schools] = await connection.query('SELECT id FROM schools LIMIT 1');
      if (schools.length > 0) {
        schoolId = schools[0].id;
        console.log('✅ Assigned to school ID:', schoolId);
      } else {
        // Create a default school if none exists
        console.log('✅ Creating default school...');
        const [defaultSchool] = await connection.query(
          'INSERT INTO schools (name) VALUES (?)',
          ['Default School']
        );
        schoolId = defaultSchool.insertId;
        console.log('✅ Default school created with ID:', schoolId);
      }
    }

    console.log('✅ Inserting user into database...');
    // Insert user
    const [result] = await connection.query(
      'INSERT INTO users (email, password_hash, name, user_type, school_id, school_name) VALUES (?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, name, userType, schoolId, schoolName || null]
    );

    console.log('✅ User inserted with ID:', result.insertId);
    connection.release();

    if (!JWT_SECRET) {
      throw new Error('Server misconfiguration: JWT_SECRET is required');
    }

    // Generate token
    const token = jwt.sign(
      { 
        id: result.insertId, 
        email, 
        name, 
        userType 
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    console.log('✅ Token generated, sending response...');

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: result.insertId,
        email,
        name,
        userType: userType === 'school' ? 'admin' : userType,
        schoolId: schoolId
      }
    });

  } catch (err) {
    console.error('❌ Registration error occurred');
    console.error('Error message:', err.message);
    console.error('Error code:', err.code);
    console.error('Full error:', err);
    res.status(500).json({ error: 'Registration failed', message: err.message });
  }
});

// LOGIN
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const connection = await pool.getConnection();

    // Find user
    const [users] = await connection.query(
      'SELECT id, email, name, user_type, password_hash, school_id FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      connection.release();
      return res.status(401).json({ error: 'Email not found' });
    }

    const user = users[0];

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      connection.release();
      return res.status(401).json({ error: 'Invalid password' });
    }

    connection.release();

    if (!JWT_SECRET) {
      throw new Error('Server misconfiguration: JWT_SECRET is required');
    }

    // Generate token
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        userType: user.user_type
      },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        userType: user.user_type === 'school' ? 'admin' : user.user_type,
        schoolId: user.school_id
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed', message: err.message });
  }
});

// GET CURRENT USER
router.get('/me', verifyToken, (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// LOGOUT (frontend handles this by clearing token)
router.post('/logout', verifyToken, (req, res) => {
  res.json({
    success: true,
    message: 'Logout successful'
  });
});

module.exports = router;
