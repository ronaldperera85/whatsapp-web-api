const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const sessionManager = require('../utils/sessionManager');
const axios = require('axios');
const logger = require('../utils/logger');
const multer = require('multer');
const FormData = require('form-data');
const { exec } = require('child_process');
const { promisify } = require('util');
const rimraf = promisify(require('rimraf'));

const sessionsPath = path.join(__dirname, '..', '.wwebjs_auth');
const activeClients = {};
const chromePath = path.join(__dirname, 'chrome', 'chrome.exe');
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const FILE_UPLOAD_ENDPOINT = process.env.FILE_UPLOAD_ENDPOINT;
const FILE_UPLOAD_TOKEN = process.env.FILE_UPLOAD_TOKEN;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({ storage });

const convertToAAC = async (inputPath) => {
  const outputPath = inputPath.replace(/\.(\w+)$/, '_converted.aac');
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -i "${inputPath}" -y -vn -acodec aac "${outputPath}"`;
    exec(command, (error, stdout, stderr) => {
      if (error) {
        logger.error(`Error converting audio to AAC: ${stderr}`);
        return reject(new Error('Failed to convert audio to AAC.'));
      }
      logger.info(`Audio converted to AAC: ${outputPath}`);
      resolve(outputPath);
    });
  });
};

const buildMessageBody = (msg, type, publicUrl = null, thumb = null) => {
  switch (type) {
    case 'chat':
      return { text: msg.body };
    case 'image':
    case 'video':
    case 'document':
    case 'sticker':
    case 'audio':
      return {
        caption: msg.caption || '',
        mimetype: msg.mimetype || '',
        size: msg.size || '',
        duration: type === 'video' ? msg.duration || '' : undefined,
        thumb: thumb || '',
        url: publicUrl || '',
      };
    case 'location':
      return {
        lng: msg.location?.longitude || msg.locationLongitude || '',
        lat: msg.location?.latitude || msg.locationLatitude || '',
      };
    case 'vcard':
      return {
        contact: 'vcard',
        vcard: msg.body || '',
      };
    default:
      throw new Error(`Unsupported message type: ${type}`);
  }
};

const uploadFile = async (filePath, originalName) => {
  try {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
    const formData = new FormData();
    formData.append('file', fs.createReadStream(filePath), originalName);
    const response = await axios.post(FILE_UPLOAD_ENDPOINT, formData, {
      headers: {
        token: FILE_UPLOAD_TOKEN,
        'Content-Type': 'multipart/form-data',
        ...formData.getHeaders(),
      },
    });
    return response.data.content.publicUrl;
  } catch (error) {
    logger.error(`Error uploading file: ${error.message}`);
    return null;
  }
};

const createClient = (uid, useChrome = false) => {
    const puppeteerConfig = useChrome
      ? {
          executablePath: chromePath,
          headless: true,
          timeout: 60000,
          args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-accelerated-2d-canvas',
              '--disable-gpu',
          ],
      }
      : {
          headless: true,
          timeout: 60000,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
          ],
      };

    return new Client({
        authStrategy: new LocalAuth({
            clientId: uid,
            dataPath: path.join(sessionsPath, uid),
        }),
        puppeteer: puppeteerConfig,
    });
};


const retryInitialize = async (uid, retries = 3) => {
    while (retries > 0) {
        try {
            logger.info(`Retrying initialization for client ${uid} (${retries} attempts left)...`);
            const client = createClient(uid);
            await client.initialize();
            activeClients[uid] = client;
            logger.info(`[Ready] WhatsApp client for ${uid} is ready after retry`);
            return;
        } catch (error) {
            logger.error(`Retry failed for client ${uid}: ${error.message}`);
            retries -= 1;
        }
    }
    logger.error(`All retries failed for client ${uid}`);
};


const setupMessageListener = (client, uid) => {
  client.removeAllListeners('message');
  client.on('message', async (msg) => {
    if (!activeClients[uid]) return;
    try {
      if (msg.from.startsWith('status@')) return;
      logger.info(`[Incoming] Message from ${msg.from.replace('@c.us', '')} to ${uid} (Type: ${msg.type}): ${msg.body || '(Media message)'}`);
      let type = 'chat';
      let thumb = null;
      let publicUrl = null;
      if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (!media || !media.data) throw new Error('Media data is undefined or invalid.');
        type = media.mimetype.startsWith('image')
          ? 'image'
          : media.mimetype.startsWith('video')
          ? 'video'
          : media.mimetype.startsWith('application')
          ? 'document'
          : media.mimetype.startsWith('audio')
          ? 'audio'
          : 'sticker';
        const extension = media.mimetype.split('/')[1] || 'bin';
        const sanitizedFilename = (media.filename || `file_${Date.now()}.${extension}`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.join(tempDir, `${msg.id.id}-${sanitizedFilename}`);
        fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
        try {
          if (type === 'audio') {
            const convertedPath = await convertToAAC(filePath);
            publicUrl = await uploadFile(convertedPath, path.basename(convertedPath));
            fs.unlinkSync(convertedPath);
          } else {
            publicUrl = await uploadFile(filePath, sanitizedFilename);
            thumb = media.thumbnail || null;
          }
          if (!publicUrl) throw new Error('Failed to upload the file.');
        } finally {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      } else if (msg.type === 'location') {
        type = 'location';
        thumb = msg.thumb || null;
        const locationData = {
          name: msg.locationName || '',
          lng: msg.locationLongitude || '',
          lat: msg.locationLatitude || '',
          thumb: thumb || '',
        };
        publicUrl = JSON.stringify(locationData);
      } else if (msg.type === 'vcard') {
        type = 'chat';
      }
      const body = buildMessageBody(msg, type, publicUrl, thumb);
      const payload = {
        event: 'message',
        token: sessionManager.getToken(uid),
        uid,
        contact: {
          uid: msg.from.replace('@c.us', ''),
          name: msg._data.notifyName || 'Unknown',
          type: 'user',
        },
        message: {
          dtm: Math.floor(Date.now() / 1000),
          uid: msg.id.id,
          cuid: '',
          dir: 'i',
          type,
          body,
          ack: msg.ack.toString(),
        },
      };
      await axios.post(process.env.POST_ENDPOINT, payload, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      logger.info(`Message of type '${type}' sent successfully to endpoint.`);
    } catch (error) {
      logger.error(`Error processing message: ${error.message}`);
    }
  });
};

const initializeSessions = () => {
  if (!fs.existsSync(sessionsPath)) {
    logger.warn(`Sessions path not found: ${sessionsPath}`);
    return;
  }
  const directories = fs.readdirSync(sessionsPath);
  directories.forEach((uid) => {
    const userSessionPath = path.join(sessionsPath, uid);
    if (fs.statSync(userSessionPath).isDirectory()) {
      logger.info(`Initializing client for user ${uid}`);
      const client = createClient(uid);
      client.on('ready', () => {
        logger.info(`[Ready] WhatsApp client for ${uid} is ready`);
        if (!activeClients[uid]) {
          activeClients[uid] = client;
          logger.info(`Client added to activeClients: ${uid}`);
        }
      });
       client.initialize().catch((error) => {
        logger.error(`Error initializing client for user ${uid}: ${error.message}`);
        logger.debug(`Stack trace for client ${uid}: ${error.stack}`);
      });
      setupMessageListener(client, uid);
    }
  });
};

const getSessionState = (uid) => {
  const sessionPath = path.join(sessionsPath, uid);
  if (fs.existsSync(sessionPath)) return 'authenticated';
  return 'unauthenticated';
};

const createSession = async (uid, qrCallback) => {
    const sessions = sessionManager.readSessions();
    if (activeClients[uid]) {
        await disconnectSession(uid, true);
        delete activeClients[uid];
        sessionManager.deleteSession(uid, sessionsPath);
    }

    if (sessions[uid] && !sessions[uid].authenticated) {
        sessionManager.deleteSession(uid, sessionsPath);
    }
    logger.info(`Initializing client for user ${uid}`);
    const client = createClient(uid);
    let qrCodeGenerated = false;
    const qrTimeout = setTimeout(async () => {
        if (!qrCodeGenerated) {
            try {
               await disconnectSession(uid, true);
                delete activeClients[uid];
                sessionManager.deleteSession(uid, sessionsPath);
            } catch (err) {
                logger.error(`Failed to destroy session for user ${uid}: ${err.message}`);
            }
        }
    }, 60000);
  activeClients[uid] = client;
  client.on('qr', async (qr) => {
        if (!qrCodeGenerated) {
            clearTimeout(qrTimeout);
            qrCodeGenerated = true;
            const qrBase64 = await qrcode.toDataURL(qr);
            qrCallback(qrBase64, null);
        }
  });
  client.on('ready', () => {
    clearTimeout(qrTimeout);
    sessionManager.addSession(uid, sessionManager.getToken(uid));
    sessionManager.updateSessionAuth(uid, true);
    logger.info(`Session synchronized and updated for user ${uid}`);
    });
  client.on('auth_failure', (msg) => {
      delete activeClients[uid];
      qrCallback(null, 'Authentication failed.');
  });
    client.on('disconnected', async (reason) => {
       logger.warn(`[Disconnected] Client for ${uid} disconnected due to: ${reason}`);
         try {
           if (activeClients[uid]) {
              await disconnectSession(uid, true); // Use the new disconnect function
               delete activeClients[uid];
             await sessionManager.deleteSession(uid, sessionsPath);
             logger.info(`Session for user ${uid} removed successfully.`);
            }
         } catch (error) {
           logger.error(`Error while removing session for user ${uid}: ${error.message}`);
         }
    });  
  try {
        await client.initialize();
  } catch (error) {
    logger.error(`Error initializing client for user ${uid}: ${error.message}`);
    delete activeClients[uid];
    qrCallback(null, `Failed to initialize client: ${error.message}`);
    }
};

process.on('uncaughtException', (error) => {
    if (error.message.includes('EBUSY: resource busy or locked')) {
        logger.warn('Session removal error detected. Continuing server operation.');
    } else {
        logger.error(`Uncaught exception: ${error.message}`);
        process.exit(1);
    }
});

const deleteSessionDirectory = async (sessionPath) => {
    try {
        await rimraf(sessionPath);
        logger.info(`[Cleanup] Successfully deleted directory: ${sessionPath}`);
    } catch (error) {
      logger.error(`[Cleanup] Failed to forcibly delete directory: ${sessionPath}, Error: ${error.message}`);
    }
};


const disconnectSession = async (uid, force = false) => {
    const client = activeClients[uid];
    if (!client) return 'Session not found';
    let isCleanupDone = false;
    try {
        logger.info(`Disconnecting session for user ${uid}`);

        if (force) {
          client.removeAllListeners();
            await client.destroy();
        } else {
           client.removeAllListeners();
           await client.logout(); //Logout first before destroy
        }

       const sessionPath = path.join(sessionsPath, uid);
        if(!isCleanupDone){
             await deleteSessionDirectory(sessionPath);
             isCleanupDone = true;
        }

        delete activeClients[uid];
        logger.info(`Session for user ${uid} disconnected successfully.`);
        return 'disconnected';
    } catch (error) {
        logger.error(`Error disconnecting session for user ${uid}: ${error.message}`);
        return 'failed';
    }
};

const sendMessage = async (uid, to, text) => {
  const client = activeClients[uid];
  if (!client) return 'Session not found';
  try {
    const chatId = `${to}@c.us`;
    const message = await client.sendMessage(chatId, text);
    return message.id ? 'sent' : 'failed';
  } catch (error) {
    return 'failed';
  }
};

const sendMediaMessage = async (uid, to, url, type) => {
    const useChrome = type === 'video' || type === 'gif';
  const client = activeClients[uid] || createClient(uid, useChrome);

  if (!client) return 'Session not found';
  try {
      const chatId = `${to}@c.us`;
        const messageText = `Media: ${url}`;
    if (useChrome) {
        await client.initialize();
    }
    const message = await client.sendMessage(chatId, messageText);
    return message.id ? 'sent' : 'failed';
  } catch (error) {
    return 'failed';
  } finally {
    if (useChrome && !activeClients[uid]) {
         await client.destroy();
    }
  }
};

module.exports = {
  initializeSessions,
  createSession,
  getSessionState,
    disconnectSession,
  sendMessage,
  sendMediaMessage,
  setupMessageListener,
    uploadFile,
    retryInitialize,
};