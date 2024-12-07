// messageController.js

const whatsappService = require('../services/whatsappService');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger'); // Importar el logger

// Ruta para registrar un usuario (generar QR)
exports.registerUser = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      logger.warn(`User ID is missing in registration request`);
      return apiResponse.sendError(res, 'User ID is required.', 400);
    }

    // Verificar si el usuario ya está autenticado
    const sessionStatus = whatsappService.getSessionState(userId);
    if (sessionStatus === 'authenticated') {
      logger.info(`User ${userId} is already authenticated.`);
      return apiResponse.sendError(res, 'User is already authenticated.', 400);
    }

    // Crear una sesión para el usuario y generar un QR
    whatsappService.createSession(userId, (qrBase64) => {
      logger.info(`QR code generated for user ${userId}`);
      return apiResponse.sendSuccess(res, { qrCode: qrBase64 }, 200);
    });
  } catch (error) {
    logger.error(`Error registering user ${userId}: ${error.message}`);
    console.error(error);
    return apiResponse.sendError(res, 'Error registering user.', 500);
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
    console.error(error);
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
    console.error(error);
    return apiResponse.sendError(res, 'Error disconnecting user.', 500);
  }
};

// Ruta para enviar un mensaje
exports.sendMessage = async (req, res) => {
  try {
    const { userId, phoneNumber, message } = req.body;

    if (!userId || !phoneNumber || !message) {
      logger.warn(`Missing fields in send message request for user ${userId}`);
      return apiResponse.sendError(res, 'User ID, phone number, and message are required.', 400);
    }

    const sessionStatus = whatsappService.getSessionState(userId);
    if (sessionStatus !== 'authenticated') {
      logger.warn(`User ${userId} is not authenticated.`);
      return apiResponse.sendError(res, 'User is not authenticated.', 401);
    }

    const status = await whatsappService.sendMessage(userId, phoneNumber, message);
    if (status === 'sent') {
      logger.info(`Message sent successfully to ${phoneNumber} by user ${userId}`);
      return apiResponse.sendSuccess(res, { userId, phoneNumber, message }, 200);
    } else {
      logger.error(`Failed to send message to ${phoneNumber} by user ${userId}`);
      return apiResponse.sendError(res, 'Failed to send message.', 500);
    }
  } catch (error) {
    logger.error(`Error sending message for user ${userId}: ${error.message}`);
    return apiResponse.sendError(res, 'Error sending message.', 500);
  }
};

