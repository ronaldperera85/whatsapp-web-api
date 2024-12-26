const jwt = require('jsonwebtoken');
const whatsappService = require('../services/whatsappService');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const sessionManager = require('../utils/sessionManager');

exports.registerUser = async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid || !/^\d{10,15}$/.test(uid)) {
      logger.warn('Invalid or missing UID (phone number) in registration request');
      return apiResponse.sendError(res, 'UID (phone number) is required and must be valid.', 400);
    }

    // Verificar si el usuario ya está registrado
    const sessionExists = sessionManager.isAuthenticated(uid);
    if (sessionExists) {
      logger.info(`User ${uid} is already registered.`);
      return apiResponse.sendError(res, 'User is already registered.', 400);
    }

    // Generar un token JWT basado en el UID
    const token = jwt.sign({ uid }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '1h' });

    // Crear una sesión para el usuario
    whatsappService.createSession(uid, (qrBase64) => {
      logger.info(`QR code generated for user ${uid}`);

      // Guardar la sesión en sessions.json
      sessionManager.addSession(uid, token);

      return apiResponse.sendSuccess(res, { qrCode: qrBase64, token }, 200);
    });
  } catch (error) {
    logger.error(`Error registering user ${req.body?.uid || 'unknown'}: ${error.message}`);
    return apiResponse.sendError(res, 'Error registering user.', 500);
  }
};

// Ruta para obtener el estado de la sesión
exports.getSessionStatus = async (req, res) => {
  try {
    const { uid } = req.params; // Cambiar userId a uid
    const status = whatsappService.getSessionState(uid); // Cambiar userId a uid
    logger.info(`Fetched session status for user ${uid}: ${status}`); // Cambiar userId a uid
    return apiResponse.sendSuccess(res, { uid, status }, 200); // Cambiar userId a uid
  } catch (error) {
    logger.error(`Error fetching session status for user ${req.params.uid}: ${error.message}`); // Cambiar userId a uid
    return apiResponse.sendError(res, 'Error fetching session status.', 500);
  }
};

// Ruta para desconectar un usuario
exports.disconnectUser = async (req, res) => {
  try {
    const { uid } = req.params; // Cambiar userId a uid
    const status = whatsappService.disconnectSession(uid); // Cambiar userId a uid
    if (status === 'disconnected') {
      logger.info(`User ${uid} disconnected successfully.`); // Cambiar userId a uid
    } else {
      logger.warn(`Failed to disconnect user ${uid}.`); // Cambiar userId a uid
    }
    return apiResponse.sendSuccess(res, { uid, status }, 200); // Cambiar userId a uid
  } catch (error) {
    logger.error(`Error disconnecting user ${req.params.uid}: ${error.message}`); // Cambiar userId a uid
    return apiResponse.sendError(res, 'Error disconnecting user.', 500);
  }
};


// Ruta para enviar un mensaje
exports.sendMessage = async (req, res) => {
  try {
    const { token, uid, to, custom_uid, text } = req.body;

    // Verificar que todos los campos requeridos estén presentes
    if (!token || !uid || !to || !custom_uid || !text) {
      logger.warn(`Missing fields in send message request for user ${uid}`);
      return apiResponse.sendError(res, 'Token, UID, To, Custom UID, and Text are required.', 400);
    }

    // Validar el token
    if (!sessionManager.validateToken(token)) {
      logger.warn(`Invalid token provided for user ${uid}`);
      return apiResponse.sendError(res, 'Invalid token.', 403);
    }

    // Verificar autenticación del usuario
    if (!sessionManager.isAuthenticated(uid)) {
      logger.warn(`User ${uid} is not authenticated.`);
      return apiResponse.sendError(res, 'User is not authenticated.', 401);
    }

    // Enviar el mensaje
    const status = await whatsappService.sendMessage(uid, to, text);
    if (status === 'sent') {
      logger.info(`Message sent successfully to ${to} by user ${uid}`);
      return apiResponse.sendSuccess(res, { custom_uid, status: 'sent' }, 200);
    } else {
      logger.error(`Failed to send message to ${to}`);
      return apiResponse.sendError(res, 'Failed to send message.', 500);
    }
  } catch (error) {
    // Utiliza req.body.uid para registrar el error con el uid
    const uid = req.body?.uid || 'unknown';
    logger.error(`Error sending message for user ${uid}: ${error.message}`);
    return apiResponse.sendError(res, 'Error sending message.', 500);
  }
};

exports.sendMediaMessage = async (req, res) => {
  try {
    const { token, uid, to, custom_uid, url } = req.body;

    // Verificar que todos los campos requeridos estén presentes
    if (!token || !uid || !to || !custom_uid || !url) {
      logger.warn(`Missing fields in send media message request for user ${uid}`);
      return apiResponse.sendError(
        res,
        'Token, UID, To, Custom UID, URL are required.',
        400
      );
    }

    // Validar el token
    if (!sessionManager.validateToken(token)) {
      logger.warn(`Invalid token provided for user ${uid}`);
      return apiResponse.sendError(res, 'Invalid token.', 403);
    }

    // Verificar autenticación del usuario
    if (!sessionManager.isAuthenticated(uid)) {
      logger.warn(`User ${uid} is not authenticated.`);
      return apiResponse.sendError(res, 'User is not authenticated.', 401);
    }

    // Enviar el mensaje multimedia
    const status = await whatsappService.sendMediaMessage(uid, to, url);
    if (status === 'sent') {
      logger.info(`Media message sent successfully to ${to} by user ${uid}`);
      return apiResponse.sendSuccess(res, { custom_uid, status: 'sent' }, 200);
    } else {
      logger.error(`Failed to send media message to ${to}`);
      return apiResponse.sendError(res, 'Failed to send media message.', 500);
    }
  } catch (error) {
    const uid = req.body?.uid || 'unknown';
    logger.error(`Error sending media message for user ${uid}: ${error.message}`);
    return apiResponse.sendError(res, 'Error sending media message.', 500);
  }
};
