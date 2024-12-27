const jwt = require('jsonwebtoken');
const whatsappService = require('../services/whatsappService');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const sessionManager = require('../utils/sessionManager');

const extractUid = (req) => req.body?.uid || 'unknown';

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
        whatsappService.createSession(uid, (qrBase64, error) => {
            if (error) {
                 logger.error(`Error creating session for user ${uid}: ${error}`);
                 return apiResponse.sendError(res, error, 500)
            }

            logger.info(`QR code generated for user ${uid}`);

            // Guardar la sesión en sessions.json
            sessionManager.addSession(uid, token);

            return apiResponse.sendSuccess(res, { qrCode: qrBase64, token }, 200);
        });
    } catch (error) {
        logger.error(`Error registering user ${extractUid(req)}: ${error.message}`);
        return apiResponse.sendError(res, 'Error registering user.', 500);
    }
};

// Ruta para obtener el estado de la sesión
exports.getSessionStatus = async (req, res) => {
  try {
    const { uid } = req.params;
    const status = whatsappService.getSessionState(uid);
    logger.info(`Fetched session status for user ${uid}: ${status}`);
    return apiResponse.sendSuccess(res, { uid, status }, 200);
  } catch (error) {
    logger.error(`Error fetching session status for user ${req.params.uid}: ${error.message}`);
    return apiResponse.sendError(res, 'Error fetching session status.', 500);
  }
};

// Ruta para desconectar un usuario
exports.disconnectUser = async (req, res) => {
    try {
        const { uid } = req.params;
        const status = await whatsappService.disconnectSession(uid);

        let responseData = { uid, status }; // Initialize responseData

        if (status === 'disconnected') {
            logger.info(`User ${uid} disconnected successfully.`);
            responseData.data = 'disconnected';
           return apiResponse.sendSuccess(res, responseData, 200);
        } else if (status === 'Session not found') {
             logger.warn(`Session not found for user ${uid}.`);
            responseData.data = 'Session not found';
             return apiResponse.sendError(res, responseData, 404);

        } else {
           logger.warn(`Failed to disconnect user ${uid}.`);
             responseData.data = 'failed';
            return apiResponse.sendError(res, responseData, 500);

        }
    } catch (error) {
        logger.error(`Error disconnecting user ${req.params.uid}: ${error.message}`);
        return apiResponse.sendError(res, 'Error disconnecting user.', 500);
    }
};



// Ruta para enviar un mensaje
exports.sendMessage = async (req, res) => {
    try {
        const { token, uid, to, custom_uid, text } = req.body;

        if (!token || !uid || !to || !custom_uid || !text) {
            logger.warn(`Missing fields in send message request for user ${uid}`);
            return apiResponse.sendError(res, 'Token, UID, To, Custom UID, and Text are required.', 400);
        }

        if (!sessionManager.validateToken(token)) {
            logger.warn(`Invalid token provided for user ${uid}`);
            return apiResponse.sendError(res, 'Invalid token.', 403);
        }

        if (!sessionManager.isAuthenticated(uid)) {
            logger.warn(`User ${uid} is not authenticated.`);
            return apiResponse.sendError(res, 'User is not authenticated.', 401);
        }
        const status = await whatsappService.sendMessage(uid, to, text);

         if (status === 'sent') {
            logger.info(`Message sent successfully to ${to} by user ${uid}`);
            return apiResponse.sendSuccess(res, { custom_uid, status: 'sent' }, 200);
        } else {
             logger.error(`Failed to send message to ${to}`);
            return apiResponse.sendError(res, 'Failed to send message.', 500);
        }
    } catch (error) {
       const uid = extractUid(req);
        logger.error(`Error sending message for user ${uid}: ${error.message}`);
        return apiResponse.sendError(res, 'Error sending message.', 500);
    }
};

exports.sendMediaMessage = async (req, res) => {
    try {
        const { token, uid, to, custom_uid, url, type } = req.body;

         if (!token || !uid || !to || !custom_uid || !url || !type) {
            logger.warn(`Missing fields in send media message request for user ${uid}`);
            return apiResponse.sendError(
                res,
                'Token, UID, To, Custom UID, URL and type are required.',
                400
            );
        }

        if (!sessionManager.validateToken(token)) {
            logger.warn(`Invalid token provided for user ${uid}`);
            return apiResponse.sendError(res, 'Invalid token.', 403);
        }

         if (!sessionManager.isAuthenticated(uid)) {
             logger.warn(`User ${uid} is not authenticated.`);
            return apiResponse.sendError(res, 'User is not authenticated.', 401);
        }
        const allowedTypes = ['image', 'video', 'document', 'audio', 'sticker', 'gif'];
        if (!allowedTypes.includes(type)) {
            logger.warn(`Invalid media type: ${type} for user ${uid}`);
            return apiResponse.sendError(res, 'Invalid media type.', 400)
        }


    const status = await whatsappService.sendMediaMessage(uid, to, url, type);

      if (status === 'sent') {
            logger.info(`Media message sent successfully to ${to} by user ${uid}`);
            return apiResponse.sendSuccess(res, { custom_uid, status: 'sent' }, 200);
        } else {
            logger.error(`Failed to send media message to ${to}`);
            return apiResponse.sendError(res, 'Failed to send media message.', 500);
        }
    } catch (error) {
        const uid = extractUid(req);
        logger.error(`Error sending media message for user ${uid}: ${error.message}`);
        return apiResponse.sendError(res, 'Error sending media message.', 500);
    }
};