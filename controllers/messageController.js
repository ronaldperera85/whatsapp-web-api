const jwt = require('jsonwebtoken');
const whatsappService = require('../services/whatsappService');
const apiResponse = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { query } = require('../db/conexion');

const extractUid = (req) => req.body?.uid || 'unknown';

const sendMessage = async (req, res) => {
    try {
        const { token, uid, to, text } = req.body;

        if (!token || !uid || !to || !text) {
            logger.warn(`Missing fields in send message request for user ${uid}`);
            return apiResponse.sendError(res, 'Token, UID, To, and Text are required.', 400);
        }

        // Validar el token con el de la base de datos
        const userToken = await query('SELECT token FROM numeros WHERE numero = ? AND estado = "conectado"',[uid]);
          if (!userToken || userToken.length === 0 || userToken[0].token !== token) {
              logger.warn(`Invalid token provided for user ${uid}`);
             return apiResponse.sendError(res, 'Invalid token.', 403);
          }


        // Obtener la licencia del usuario
        const licenciaQuery = 'SELECT id, tipo_licencia, limite_mensajes, mensajes_enviados, estado_licencia FROM licencias WHERE uid = ?';
        const licenciaResult = await query(licenciaQuery, [uid]);
        if (!licenciaResult || licenciaResult.length === 0) {
            logger.warn(`No license found for user ${uid}`);
            return apiResponse.sendError(res, 'No license found for this user.', 403);
        }
        const licencia = licenciaResult[0];
        if(licencia.estado_licencia === 'BLOQUEADA'){
            logger.warn(`License for user ${uid} is blocked.`);
            return apiResponse.sendError(res, 'Your license has been blocked.', 403);
        }

         if (licencia.mensajes_enviados >= licencia.limite_mensajes) {
            logger.warn(`Message limit reached for user ${uid}`);
             return apiResponse.sendError(res, 'Your message limit has been reached.', 403);
         }

        const status = await whatsappService.sendMessage(uid, to, text);

        if (status === 'sent') {
          const custom_uid = `${uid}-${Date.now()}`;
           // Registrar mensaje en la base de datos
            const insertMessageQuery = `
            INSERT INTO mensajes (uid, custom_uid, token, tipo, mensaje, estado, remitente_uid, destinatario_uid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

            try{
             await query(insertMessageQuery, [
                 uid,
                 custom_uid,
                 token,
                 'chat',
                 text,
                 'enviado',
                 uid, // Remitente
                 to    // Destinatario
                ]);
               // Actualizar contador de mensajes
               const updateLicenciaQuery = 'UPDATE licencias SET mensajes_enviados = mensajes_enviados + 1 WHERE id = ?';
               await query(updateLicenciaQuery, [licencia.id]);

             // logger.info(`[Outgoing] Message of type 'chat' sent successfully to ${to} by user ${uid}: ${text}`); // Eliminar log de aquí
               return apiResponse.sendSuccess(res, { custom_uid, status: 'sent' }, 200);
            }catch(error){
              logger.error(`Error sending message for user ${uid}: ${error.message}`);
              return apiResponse.sendError(res, `Error sending message. ${error.message}`, 500);
           }
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

const sendMediaMessage = async (req, res) => {
    try {
     const { token, uid, to, url} = req.body;
         if (!token || !uid || !to || !url) {
              logger.warn(`Missing fields in send media message request for user ${uid}`);
             return apiResponse.sendError(
                 res,
                 'Token, UID, To and URL are required.',
                 400
             );
         }
         // Validar el token con el de la base de datos
         const userToken = await query('SELECT token FROM numeros WHERE numero = ? AND estado = "conectado"',[uid]);
         if (!userToken || userToken.length === 0 || userToken[0].token !== token) {
             logger.warn(`Invalid token provided for user ${uid}`);
         return apiResponse.sendError(res, 'Invalid token.', 403);
         }
          // Obtener la licencia del usuario
          const licenciaQuery = 'SELECT id, tipo_licencia, limite_mensajes, mensajes_enviados, estado_licencia FROM licencias WHERE uid = ?';
         const licenciaResult = await query(licenciaQuery, [uid]);
         if (!licenciaResult || licenciaResult.length === 0) {
             logger.warn(`No license found for user ${uid}`);
             return apiResponse.sendError(res, 'No license found for this user.', 403);
         }
         const licencia = licenciaResult[0];
         if(licencia.estado_licencia === 'BLOQUEADA'){
             logger.warn(`License for user ${uid} is blocked.`);
             return apiResponse.sendError(res, 'Your license has been blocked.', 403);
          }
         if (licencia.mensajes_enviados >= licencia.limite_mensajes) {
             logger.warn(`Message limit reached for user ${uid}`);
             return apiResponse.sendError(res, 'Your message limit has been reached.', 403);
         }
        const status = await whatsappService.sendMediaMessage(uid, to, url);
        let inferredType = status;
        if(typeof status === 'string'){
           inferredType = 'document' // default type
         }else{
             inferredType = status.inferredType;
        }
      if (status === 'sent' || status.id ) {
         const custom_uid = `${uid}-${Date.now()}`;
         // Registrar mensaje en la base de datos
         const insertMessageQuery = `
         INSERT INTO mensajes (uid, custom_uid, token, tipo, mensaje, estado, remitente_uid, destinatario_uid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

         try {
             await query(insertMessageQuery, [
                 uid,
                custom_uid,
                 token,
                 inferredType, // guardar el tipo inferido por whatsappservice
                `Media: ${url}`, // guardar la url como mensaje
               'enviado',
                 uid, // Remitente
               to // Destinatario
             ]);
             // Actualizar contador de mensajes
            const updateLicenciaQuery = 'UPDATE licencias SET mensajes_enviados = mensajes_enviados + 1 WHERE id = ?';
             await query(updateLicenciaQuery, [licencia.id]);

             return apiResponse.sendSuccess(res, { custom_uid, status: 'sent' }, 200);
         }catch(error){
              logger.error(`Error sending media message for user ${uid}: ${error.message}`);
             return apiResponse.sendError(res, `Error sending media message. ${error.message}`, 500);
         }
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

const registerUser = async (req, res) => {
    try {
        const { uid } = req.body;

        if (!uid || !/^\d{10,15}$/.test(uid)) {
            logger.warn('Invalid or missing UID (phone number) in registration request');
            return apiResponse.sendError(res, 'UID (phone number) is required and must be valid.', 400);
        }

          // Verificar si el usuario ya está registrado
            const userExists = await query('SELECT 1 FROM numeros WHERE numero = ?',[uid]);
            if(userExists && userExists.length > 0){
                 logger.info(`User ${uid} is already registered.`);
                return apiResponse.sendError(res, 'User is already registered.', 400);
            }
        // Generar un token JWT basado en el UID
        const token = jwt.sign({ uid }, process.env.JWT_SECRET || 'default_secret', { expiresIn: '1h' });
        // Almacenar el token del usuario
        await query('UPDATE numeros SET token = ? WHERE numero = ?', [token, uid]);
         // Crear una sesión para el usuario
        whatsappService.createSession(uid, (qrBase64, error) => {
            if (error) {
                 logger.error(`Error creating session for user ${uid}: ${error}`);
                 return apiResponse.sendError(res, error, 500)
            }

            logger.info(`QR code generated for user ${uid}`);
            // Crear registro en la tabla `licencias`
            const insertLicenciaQuery = `
            INSERT INTO licencias (uid, tipo_licencia, limite_mensajes)
            VALUES (?, ?, ?)`;
           query(insertLicenciaQuery, [uid, 'GRATIS', 300]);

            return apiResponse.sendSuccess(res, { qrCode: qrBase64, token }, 200);
        });
    } catch (error) {
        logger.error(`Error registering user ${extractUid(req)}: ${error.message}`);
        return apiResponse.sendError(res, 'Error registering user.', 500);
    }
};

// Ruta para obtener el estado de la sesión
const getSessionStatus = async (req, res) => {
    try {
      const { uid } = req.params;
       // Verificar que el usuario exista
          const userExists = await query('SELECT 1 FROM numeros WHERE numero = ? AND estado = "conectado"',[uid]);
          if (!userExists || userExists.length === 0) {
              logger.warn(`User ${uid} is not registered or connected.`);
              return apiResponse.sendError(res, 'User is not registered or connected.', 401);
          }

      const status = whatsappService.getSessionState(uid);
      logger.info(`Fetched session status for user ${uid}: ${status}`);
      return apiResponse.sendSuccess(res, { uid, status }, 200);
    } catch (error) {
      logger.error(`Error fetching session status for user ${req.params.uid}: ${error.message}`);
      return apiResponse.sendError(res, 'Error fetching session status.', 500);
    }
  };

// Ruta para desconectar un usuario
const disconnectUser = async (req, res) => {
    try {
        const { uid } = req.params;
        const status = await whatsappService.disconnectSession(uid);

        // Formato uniforme de respuesta
        let responseData = {
            success: false,
            uid,
            status: status,
            message: ''
        };

        if (status.success) { // Check if status.success is true
            logger.info(`User ${uid} disconnected successfully.`);
            responseData.success = true;
            responseData.message = status.message; // Get the message from status object
            return apiResponse.sendSuccess(res, responseData, 200);
        } else if (status.message === 'Session not found') {
            logger.warn(`Session not found for user ${uid}.`);
            responseData.message = `Session not found for user ${uid}.`;
            return apiResponse.sendError(res, responseData, 404);
        } else {
            logger.warn(`Failed to disconnect user ${uid}.`);
            responseData.message = status.message; // Get the message from status object
            return apiResponse.sendError(res, responseData, 500);
        }
    } catch (error) {
        logger.error(`Error disconnecting user ${req.params.uid}: ${error.message}`);
        return apiResponse.sendError(res, {
            success: false,
            uid: req.params.uid,
            status: 'error',
            message: `Error disconnecting user: ${error.message}`
        }, 500);
    }
};

module.exports = {
    sendMessage,
    sendMediaMessage,
    registerUser,
    getSessionStatus,
    disconnectUser
};