const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');

const sessionsPath = path.join(__dirname, '.wwebjs_auth');
const activeClients = {};

// Inicializar sesiones y restaurar tokens
const initializeSessions = () => {
  if (!fs.existsSync(sessionsPath)) {
    console.log(`Sessions path not found: ${sessionsPath}`);
    return;
  }

  const directories = fs.readdirSync(sessionsPath);
  directories.forEach((userId) => {
    const userSessionPath = path.join(sessionsPath, userId);
    const sessionFile = path.join(userSessionPath, 'session.json');

    if (fs.statSync(userSessionPath).isDirectory() && fs.existsSync(sessionFile)) {
      console.log(`Restoring session for user: ${userId}`);
      const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

      const client = new Client({
        authStrategy: new LocalAuth({
          clientId: userId,
          dataPath: userSessionPath,
        }),
      });

      client.on('ready', () => {
        console.log(`Restored WhatsApp client for ${userId}`);
        activeClients[userId] = { client, token: sessionData.token };
      });

      client.on('disconnected', () => {
        console.log(`Session disconnected for user ${userId}`);
        delete activeClients[userId];
      });

      client.initialize();
    }
  });
};

// Crear una sesión de WhatsApp para un usuario
const createSession = (userId, token, qrCallback) => {
  if (activeClients[userId]) {
    console.log(`Session already exists for user ${userId}`);
    return;
  }

  const userSessionPath = path.join(sessionsPath, userId);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: userId,
      dataPath: userSessionPath,
    }),
  });

  client.on('qr', async (qr) => {
    console.log(`QR for user ${userId}:`, qr);
    const qrBase64 = await qrcode.toDataURL(qr);
    qrCallback(qrBase64);
  });

  client.on('ready', () => {
    console.log(`WhatsApp client for ${userId} is ready!`);
    activeClients[userId] = { client, token };
    saveSessionData(userId, { token });
  });

  client.on('disconnected', () => {
    console.log(`Client for ${userId} disconnected`);
    delete activeClients[userId];
  });

  client.initialize();
};

// Guardar datos de sesión (incluido el token)
const saveSessionData = (userId, data) => {
  const userSessionPath = path.join(sessionsPath, userId);
  const sessionFile = path.join(userSessionPath, 'session.json');

  if (!fs.existsSync(userSessionPath)) {
    fs.mkdirSync(userSessionPath, { recursive: true });
  }

  let existingData = {};
  if (fs.existsSync(sessionFile)) {
    existingData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  }

  const updatedData = { ...existingData, ...data };
  fs.writeFileSync(sessionFile, JSON.stringify(updatedData, null, 2));
};

// Validar token desde el archivo de sesión
const validateSessionToken = (userId, token) => {
  const sessionFile = path.join(sessionsPath, userId, 'session.json');
  if (!fs.existsSync(sessionFile)) {
    return false;
  }

  const sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
  return sessionData.token === token;
};

// Obtener el estado de la sesión
const getSessionState = (userId) => {
  if (activeClients[userId]) {
    return 'authenticated';
  }

  const sessionPath = path.join(sessionsPath, userId);
  if (fs.existsSync(sessionPath)) {
    return 'not authenticated';
  }

  return 'not found';
};

// Desconectar una sesión
const disconnectSession = (userId) => {
  if (activeClients[userId]) {
    activeClients[userId].client.destroy();
    delete activeClients[userId];
    console.log(`Session for user ${userId} has been disconnected successfully.`);
    return 'disconnected';
  }
  return 'Session not found';
};

// Enviar un mensaje
const sendMessage = async (userId, phoneNumber, message) => {
  const session = activeClients[userId];
  if (!session || !session.client) {
    console.log(`No session found for user ${userId}`);
    return 'Session not found';
  }

  try {
    const chatId = `${phoneNumber}@c.us`;
    await session.client.sendMessage(chatId, message);
    console.log(`Message sent to ${phoneNumber}: ${message}`);
    return 'sent';
  } catch (error) {
    console.error(`Error sending message to ${phoneNumber}: ${error.message}`);
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
