const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'exam_scanner',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection on startup
pool.getConnection()
  .then(conn => {
    console.log('✅ MySQL Database connected successfully!');
    conn.release();
  })
  .catch(err => {
    console.error('❌ MySQL Connection failed:', err);
    // Do not crash the server; allow endpoints to run and report DB status as down.
  });

module.exports = pool;
