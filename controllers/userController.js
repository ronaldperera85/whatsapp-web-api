const jwt = require('jsonwebtoken');
const apiResponse = require('../utils/apiResponse');
const whatsappService = require('../services/whatsappService');
const logger = require('../utils/logger'); // Importar el logger

// Simulación de base de datos
const users = [];

// Registrar un usuario y generar un JWT
exports.registerUser = (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    logger.warn('Phone number is required but not provided.');
    return apiResponse.sendError(res, 'Phone number is required.', 400);
  }

  if (users.some(user => user.phoneNumber === phoneNumber)) {
    logger.warn(`Phone number ${phoneNumber} is already registered.`);
    return apiResponse.sendError(res, 'Phone number already registered.', 400);
  }

  // Crear sesión y manejar el QR
  whatsappService.createSession(phoneNumber, (qrBase64) => {
    try {
      const token = jwt.sign({ phoneNumber }, process.env.JWT_SECRET, { expiresIn: '1h' });

      // Simular almacenamiento de usuario
      users.push({ phoneNumber, token });

      logger.info(`User ${phoneNumber} registered successfully and JWT generated.`);

      // Responder con el token y el QR
      apiResponse.sendSuccess(res, { qr: qrBase64, token }, 200);
    } catch (error) {
      logger.error(`Error registering user ${phoneNumber}: ${error.message}`);
      return apiResponse.sendError(res, 'Error registering user.', 500);
    }
  });
};
