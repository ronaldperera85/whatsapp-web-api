const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USERNAME || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "whatsapp_app",
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Función para realizar consultas a la base de datos
const query = async (sql, values) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute(sql, values);
    return results;
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

module.exports = {
  query,
  pool,
};
