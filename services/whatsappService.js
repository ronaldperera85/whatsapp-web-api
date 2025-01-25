const { Client, LocalAuth } = require('whatsapp-web.js');
const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode');
const axios = require('axios');
const logger = require('../utils/logger');
const multer = require('multer');
const FormData = require('form-data');
const { exec } = require('child_process');
const { promisify } = require('util');
const rimraf = promisify(require('rimraf'));
const { query } = require('../db/conexion');

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
    logger.info(`Setting up message listener for user ${uid}`); // Log adicional
    client.removeAllListeners('message');
    client.on('message', async (msg) => { // Asegúrate de que la función sea async
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
                // Reemplazo aquí: Usa await con fs.promises.writeFile
                await fs.promises.writeFile(filePath, Buffer.from(media.data, 'base64'));
                try {
                    if (type === 'audio') {
                        const convertedPath = await convertToAAC(filePath);
                        publicUrl = await uploadFile(convertedPath, path.basename(convertedPath));
                        fs.unlinkSync(convertedPath); // Esto puede permanecer síncrono ya que es una operación rápida
                    } else {
                        publicUrl = await uploadFile(filePath, sanitizedFilename);
                        thumb = media.thumbnail || null;
                    }
                    if (!publicUrl) throw new Error('Failed to upload the file.');
                } finally {
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath); // Esto puede permanecer síncrono
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
           // Obtener el token del numero desde la base de datos
           const tokenData = await query('SELECT token FROM numeros WHERE numero = ?', [uid]);
           const token = tokenData && tokenData.length > 0 ? tokenData[0].token : null;
           logger.info(`Token for user ${uid}: ${token}`); // Añade este log
           const body = buildMessageBody(msg, type, publicUrl, thumb);
            const payload = {
                event: 'message',
                token: token, // Añadimos el token al payload
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
            logger.info(`Payload constructed for user ${uid}: ${JSON.stringify(payload)}`);

              try {
                const response =  await axios.post(process.env.POST_ENDPOINT, payload, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                      //  'Authorization': `Bearer ${token}`  eliminamos el header authorization
                   },
                });
                 logger.info(`Message of type '${type}' sent successfully to endpoint. Response: ${JSON.stringify(response.data)}`);
            }catch (error){
                 logger.error(`Error sending message to endpoint: ${error.message}`);
                if (error.response && error.response.data) {
                 logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
               }
           }


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
  directories.forEach(async (uid) => {
    const userSessionPath = path.join(sessionsPath, uid);
    if (fs.statSync(userSessionPath).isDirectory()) {
      logger.info(`Initializing client for user ${uid}`);
        // Verificamos si existe el usuario en base de datos y si esta conectado
        const userExists = await query('SELECT 1 FROM numeros WHERE numero = ? AND estado = "conectado"', [uid]);
          if (userExists && userExists.length > 0) {
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
        }else{
             logger.warn(`User ${uid} is not registered or connected. session not initialized`);
        }
     }
  });
};

const getSessionState = (uid) => {
  const client = activeClients[uid];
  if (client && client.info && client.info.me) {
     return 'authenticated'; // Cliente está activamente autenticado
  }
  return 'unauthenticated';
};
const sessionLocks = {};

const createSession = async (uid, qrCallback) => {
    // Initialize lock for the session if not already present
    if (!sessionLocks[uid]) {
        sessionLocks[uid] = { isLocked: false };
    }
    // Acquire the lock
    while (sessionLocks[uid].isLocked) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    sessionLocks[uid].isLocked = true;

    try {

           if (activeClients[uid]) {
             await disconnectSession(uid, true);
             delete activeClients[uid];
             // sessionManager.deleteSession(uid, sessionsPath); // Ya no se usa
         }

        logger.info(`Initializing client for user ${uid}`);
        const client = createClient(uid);
        let qrCodeGenerated = false;
        const qrTimeout = setTimeout(async () => {
             if (!qrCodeGenerated) {
                try {
                   await disconnectSession(uid, true);
                   delete activeClients[uid];
                   // sessionManager.deleteSession(uid, sessionsPath); // Ya no se usa
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
                  await disconnectSession(uid, true);
                  delete activeClients[uid];
                   // sessionManager.deleteSession(uid, sessionsPath); // Ya no se usa
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
    } finally {
        // Release the lock
        sessionLocks[uid].isLocked = false;
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
  if (!client) {
    return { success: false, message: 'Session not found' };
  }

  try {
    logger.info(`Disconnecting session for user ${uid}`);

    client.removeAllListeners(); // Remover listeners primero

    if (force) {
      await client.logout();
      await client.destroy();
    } else {
      await client.logout(); // Logout antes de destroy
      await client.destroy();
    }

    // Esperar un breve momento para que se completen las operaciones
    await new Promise(resolve => setTimeout(resolve, 500));

    const sessionPath = path.join(sessionsPath, uid);

    // // Eliminar la entrada de sessions.json PRIMERO ya no se usa
    // sessionManager.deleteSession(uid, sessionsPath);

    // Luego eliminar la carpeta de autenticación
     try {
            // Eliminar el número de la base de datos
               const stmt = await query('DELETE FROM numeros WHERE numero = ?', [uid]);
               logger.info(`Successfully deleted user ${uid} from database.`);
               } catch (e) {
                     logger.error(`Error al eliminar el número de la base de datos: ${e.message}`);
                }
    await deleteSessionDirectory(sessionPath);

    delete activeClients[uid];
    logger.info(`Session for user ${uid} disconnected successfully.`);

    return { success: true, message: `Session for user ${uid} disconnected successfully.` };
  } catch (error) {
    logger.error(`Error disconnecting session for user ${uid}: ${error.message}`);
    return { success: false, message: `Error disconnecting session for user ${uid}: ${error.message}` };
  }
};


const sendMessage = async (uid, to, text) => {
  const client = activeClients[uid];
  if (!client) return 'Session not found';
  try {
    const chatId = `${to}@c.us`;
    const message = await client.sendMessage(chatId, text);logger.info(`[Outgoing] Message of type 'chat' sent successfully to ${to} by user ${uid}: ${text}`); // añadir el log al enviar un mensaje de tipo chat
    return message.id ? 'sent' : 'failed';
  } catch (error) {
        logger.error(`Error sending message to ${to} by user ${uid}: ${error.message}`);
    return 'failed';
  }
};

const sendMediaMessage = async (uid, to, url, type = null) => { //type es opcional y por defecto es null
    let client;
    let inferredType = type;
    const useChrome = inferredType === 'video' || inferredType === 'gif';
    try {
        if (activeClients[uid]) {
            client = activeClients[uid];
            logger.info(`Reusing active client for user ${uid} in sendMediaMessage`);
        } else {
            client = createClient(uid, useChrome);
            logger.info(`Creating new client for user ${uid} in sendMediaMessage using Chrome: ${useChrome}`);
            await client.initialize();
        }
        if (!client) return 'Session not found';
   
       const chatId = `${to}@c.us`;
   
         if (!inferredType) {
            const fileExtension = url.split('.').pop().toLowerCase();
               if (['jpg', 'jpeg', 'png', 'webp'].includes(fileExtension)) {
                inferredType = 'image';
                } else if (['mp4', 'mov', 'avi'].includes(fileExtension)) {
                inferredType = 'video';
                } else if (['pdf', 'doc', 'docx', 'xls', 'xlsx'].includes(fileExtension)) {
                     inferredType = 'document';
                 }else if (['mp3', 'ogg', 'aac'].includes(fileExtension)) {
                     inferredType = 'audio'
                 }else{
                    inferredType = 'document';
                }
          }
        const messageText = `Media: ${url}`;
        const message = await client.sendMessage(chatId, messageText);
         logger.info(`[Outgoing] Message of type '${inferredType}' sent successfully to ${to} by user ${uid}: Media URL: ${url}`);
        return message.id ? {id: message.id, inferredType}  : 'failed'; //return un objeto si el mensaje fue enviado con el id y el inferredType y un string si falló el envío
   } catch (error) {
        logger.error(`Error sending media message to ${to} by user ${uid}: ${error.message}`);
        return 'failed';
    } finally {
        if (!activeClients[uid] && client) {
            logger.info(`Destroying client for user ${uid} in sendMediaMessage`);
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
