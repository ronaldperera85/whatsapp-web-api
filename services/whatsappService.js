const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const sessionManager = require('../utils/sessionManager');
const axios = require('axios'); // Importar Axios para enviar el POST
const logger = require('../utils/logger'); // Importar logger

const sessionsPath = path.join(__dirname, '..', '.wwebjs_auth');
const activeClients = {}; // Mantener las sesiones activas en memoria

// Obtener el estado de la sesión
const getSessionState = (uid) => {
  const sessionPath = path.join(sessionsPath, uid);
  if (fs.existsSync(sessionPath)) {
    return 'authenticated';
  } else {
    return 'unauthenticated';
  }
};

// Inicializar sesiones y restaurar tokens
const initializeSessions = () => {
  if (!fs.existsSync(sessionsPath)) {
    logger.warn(`Sessions path not found: ${sessionsPath}`);
    return;
  }

  const directories = fs.readdirSync(sessionsPath);
  directories.forEach((uid) => {
    const userSessionPath = path.join(sessionsPath, uid);

    if (fs.statSync(userSessionPath).isDirectory()) {
      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: uid,
          dataPath: userSessionPath,
        }),
      });

      client.on('ready', () => {
        logger.info(`Restored WhatsApp client for ${uid}`);
        activeClients[uid] = client;
      });

      // Configurar interceptación de mensajes
      setupMessageListener(client, uid);

      client.initialize();
    }
  });
};

// Crear una sesión de WhatsApp para un usuario
const createSession = (uid, qrCallback) => {
  if (activeClients[uid]) {
    logger.warn(`Session already exists for user ${uid}`);
    return;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: uid,
      dataPath: path.join(sessionsPath, uid),
    }),
  });

  client.on('qr', async (qr) => {
    logger.info(`QR for user ${uid} generated`);
    const qrBase64 = await qrcode.toDataURL(qr);
    qrCallback(qrBase64);
  });

  client.on('ready', () => {
    logger.info(`WhatsApp client for ${uid} is ready`);
    activeClients[uid] = client;
    sessionManager.updateSessionAuth(uid, true); // Marcar como autenticado
  });

  client.on('authenticated', () => {
    logger.info(`Authenticated for ${uid}`);
  });

  client.on('disconnected', () => {
    logger.warn(`Client for ${uid} disconnected`);
    delete activeClients[uid];
    sessionManager.updateSessionAuth(uid, false); // Marcar como no autenticado
  });

  // Configurar interceptación de mensajes
  setupMessageListener(client, uid);

  client.initialize();
};

// Configurar interceptación de mensajes
const setupMessageListener = (client, uid) => {
  client.on('message', async (msg) => {
    logger.info(`[Incoming] Message from ${msg.from.replace("@c.us", "")} to ${uid}: ${msg.body}`, { timestamp: new Date().toISOString() });

    // Obtener el token dinámico para este UID
    const token = sessionManager.getToken(uid);
    if (!token) {
      logger.error(`No token found for user ${uid}`);
      return;
    }

    const payload = {
      event: "message",
      token, // Token dinámico obtenido
      uid,
      contact: {
        uid: msg.from.replace("@c.us", ""), // Número del remitente
        name: msg._data.notifyName || "Unknown", // Nombre del contacto si está disponible
        type: "user",
      },
      message: {
        dtm: Math.floor(Date.now() / 1000), // Marca de tiempo en segundos
        uid: msg.id.id, // ID único del mensaje
        cuid: "", // Puedes ajustar esto según sea necesario
        dir: "i", // Dirección "i" para mensajes entrantes
        type: "chat", // Tipo de mensaje
        body: {
          text: msg.body, // Contenido del mensaje
        },
        ack: msg.ack.toString(), // Estado del mensaje
      },
    };

    // Obtener la URL del endpoint desde el .env
    const endpoint = process.env.POST_ENDPOINT;

    if (!endpoint) {
      logger.error('POST_ENDPOINT is not defined in the environment variables.');
      return;
    }

    // Enviar el mensaje al endpoint
    try {
      const response = await axios.post(
        endpoint,
        payload,
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );
      logger.info(`Message successfully sent to endpoint: ${response.status}`, { timestamp: new Date().toISOString() });
    } catch (error) {
      logger.error(`Error sending message to endpoint: ${error.message}`, { timestamp: new Date().toISOString() });
    }
  });
};

// Desconectar una sesión
const disconnectSession = (uid) => {
  if (activeClients[uid]) {
    activeClients[uid].destroy();
    delete activeClients[uid];
    logger.info(`Session for user ${uid} has been disconnected successfully`);
    return 'disconnected';
  }
  return 'Session not found';
};

// Enviar un mensaje
const sendMessage = async (uid, to, text) => {
  const client = activeClients[uid]; // Usar el cliente de memoria
  if (!client) {
    logger.warn(`User ${uid} is not authenticated`);
    return 'Session not found';
  }

  try {
    const chatId = `${to}@c.us`; // Formato internacional para el número
    const message = await client.sendMessage(chatId, text);
    logger.info(`Message sent to ${to} by user ${uid}: ${text}`);
    return message.id ? 'sent' : 'failed';
  } catch (error) {
    logger.error(`Error sending message to ${to} by user ${uid}: ${error.message}`);
    return 'failed';
  }
};

module.exports = {
  initializeSessions,
  createSession,
  getSessionState,
  disconnectSession,
  sendMessage,
};
