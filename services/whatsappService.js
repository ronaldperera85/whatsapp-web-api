const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const sessionManager = require('../utils/sessionManager');

const sessionsPath = path.join(__dirname, '.wwebjs_auth');
const activeClients = {}; // Mantener las sesiones activas en memoria

// Obtener el estado de la sesión
const getSessionState = (uid) => {
  const sessionPath = path.join(__dirname, '..', '.wwebjs_auth', uid);
  if (fs.existsSync(sessionPath)) {
    return 'authenticated';
  } else {
    return 'unauthenticated';
  }
};

// Inicializar sesiones y restaurar tokens
const initializeSessions = () => {
  if (!fs.existsSync(sessionsPath)) {
      console.log(`Sessions path not found: ${sessionsPath}`);
      return;
  }

  const directories = fs.readdirSync(sessionsPath);
  directories.forEach((userId) => {
      const userSessionPath = path.join(sessionsPath, userId);

      if (fs.statSync(userSessionPath).isDirectory()) {
          const client = new Client({
              authStrategy: new LocalAuth({
                  clientId: userId,
                  dataPath: userSessionPath,
              }),
          });

          client.on('ready', () => {
              console.log(`Restored WhatsApp client for ${userId}`);
              activeClients[userId] = client;
          });

          client.initialize();
      }
  });
};

// Crear una sesión de WhatsApp para un usuario
const createSession = (uid, qrCallback) => {
  if (activeClients[uid]) {
    console.log(`Session already exists for user ${uid}`);
    return;
  }

  const userSessionPath = path.join(sessionsPath, userId);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: uid,
      dataPath: path.join(sessionsPath, uid),
    }),
  });

  client.on('qr', async (qr) => {
    console.log(`QR for user ${uid}:`, qr);
    const qrBase64 = await qrcode.toDataURL(qr);
    qrCallback(qrBase64);
  });

  client.on('ready', () => {
    console.log(`WhatsApp client for ${uid} is ready!`);
    activeClients[uid] = client;
    sessionManager.updateSessionAuth(uid, true); // Marcar como autenticado
  });

  client.on('authenticated', () => {
    console.log(`Authenticated for ${uid}`);
  });

  client.on('disconnected', () => {
    console.log(`Client for ${uid} disconnected`);
    delete activeClients[uid];
    sessionManager.updateSessionAuth(uid, false); // Marcar como no autenticado
  });

  client.initialize();
};

// Desconectar una sesión
const disconnectSession = (uid) => {
  if (activeClients[uid]) {
    activeClients[uid].destroy();
    delete activeClients[uid];
    console.log(`Session for user ${uid} has been disconnected successfully.`);
    return 'disconnected';
  }
  return 'Session not found';
};


// Enviar un mensaje
const sendMessage = async (uid, to, text) => {
  const client = activeClients[uid]; // Usar el cliente de memoria
  if (!client) {
    console.warn(`User ${uid} is not authenticated.`);
    return 'Session not found';
  }

  try {
    const chatId = `${to}@c.us`; // Formato internacional para el número
    const message = await client.sendMessage(chatId, text);
    console.log(`Message sent to ${to}: ${text}`);
    return message.id ? 'sent' : 'failed';
  } catch (error) {
    console.error(`Error sending message to ${to}: ${error.message}`);
    return 'failed';
  }
};



module.exports = {
  initializeSessions,
  createSession,
  saveSessionData,
  validateSessionToken,
  getSessionState,
  disconnectSession,
  sendMessage,
};
