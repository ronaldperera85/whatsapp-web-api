const whatsappService = require('../services/whatsappService');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger'); 
const jwt = require('jsonwebtoken'); // Importar JWT

// Ruta para registrar un usuario (generar QR)
exports.registerUser = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      logger.warn('User ID is missing in registration request');
      return apiResponse.sendError(res, 'User ID is required.', 400);
    }

    // Generar el token
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    whatsappService.createSession(userId, token, (qrBase64) => {
      logger.info(`QR code and token created for user ${userId}`);
      return apiResponse.sendSuccess(res, { qrCode: qrBase64, token }, 200);
    });
  } catch (error) {
    logger.error(`Error registering user: ${error.message}`);
    return apiResponse.sendError(res, 'Error registering user.', 500);
  }
};

// Ruta para enviar un mensaje
exports.sendMessage = async (req, res) => {
  try {
    const { token, userId, phoneNumber, message } = req.body;

    if (!token || !userId || !phoneNumber || !message) {
      logger.warn('Missing fields in send message request');
      return apiResponse.sendError(res, 'Token, User ID, phone number, and message are required.', 400);
    }

    // Validar el token
    if (!whatsappService.validateSessionToken(userId, token)) {
      logger.warn('Invalid or expired token');
      return apiResponse.sendError(res, 'Invalid or expired token.', 401);
    }

    // Verificar el estado de la sesión
    const sessionStatus = whatsappService.getSessionState(userId);
    if (sessionStatus !== 'authenticated') {
      logger.warn(`User ${userId} is not authenticated`);
      return apiResponse.sendError(res, 'User is not authenticated.', 401);
    }

    // Enviar el mensaje
    const status = await whatsappService.sendMessage(userId, phoneNumber, message);
    if (status === 'sent') {
      logger.info(`Message sent successfully to ${phoneNumber} by user ${userId}`);
      return apiResponse.sendSuccess(res, { userId, phoneNumber, message }, 200);
    } else {
      logger.error(`Failed to send message to ${phoneNumber} by user ${userId}`);
      return apiResponse.sendError(res, 'Failed to send message.', 500);
    }
  } catch (error) {
    logger.error(`Error sending message: ${error.message}`);
    return apiResponse.sendError(res, 'Error sending message.', 500);
  }
};

// Ruta para obtener el estado de la sesión
exports.getSessionStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const status = whatsappService.getSessionState(userId);
    logger.info(`Fetched session status for user ${userId}: ${status}`);
    return apiResponse.sendSuccess(res, { userId, status }, 200);
  } catch (error) {
    logger.error(`Error fetching session status for user ${userId}: ${error.message}`);
    return apiResponse.sendError(res, 'Error fetching session status.', 500);
  }
};

// Ruta para desconectar un usuario
exports.disconnectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const status = whatsappService.disconnectSession(userId);
    if (status === 'disconnected') {
      logger.info(`User ${userId} disconnected successfully.`);
    } else {
      logger.warn(`Failed to disconnect user ${userId}.`);
    }
    return apiResponse.sendSuccess(res, { userId, status }, 200);
  } catch (error) {
    logger.error(`Error disconnecting user ${userId}: ${error.message}`);
    return apiResponse.sendError(res, 'Error disconnecting user.', 500);
  }
};
