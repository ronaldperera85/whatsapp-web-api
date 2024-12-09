require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const messageRoutes = require('./routes/messageRoutes');
const userRoutes = require('./routes/userRoutes');
const { initializeSessions } = require('./services/whatsappService');
const logger = require('./utils/logger');

// Inicialización de Express
const app = express();
const port = process.env.PORT || 3000;

// Inicializar sesiones al arrancar el servidor
initializeSessions();

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Rutas
app.use('/api', messageRoutes);
app.use('/api/users', userRoutes);

// Middleware de manejo de errores
app.use((err, req, res, next) => {
  logger.error(`Server error: ${err.stack}`);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: err.message,
  });
});

// Iniciar servidor
app.listen(port, () => {
  logger.info(`Server is running on http://localhost:${port}`);
});