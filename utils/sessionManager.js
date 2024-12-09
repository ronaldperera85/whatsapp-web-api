const fs = require('fs');
const path = require('path');

// Ruta del archivo sessions.json
const sessionFilePath = path.join(__dirname, '..', 'sessions.json');

// Leer las sesiones desde el archivo
const readSessions = () => {
  if (!fs.existsSync(sessionFilePath)) {
    fs.writeFileSync(sessionFilePath, JSON.stringify({}), 'utf8'); // Crear archivo vacío si no existe
  }
  const data = fs.readFileSync(sessionFilePath, 'utf8');
  return JSON.parse(data);
};

// Guardar las sesiones en el archivo
const writeSessions = (sessions) => {
  fs.writeFileSync(sessionFilePath, JSON.stringify(sessions, null, 2), 'utf8');
};

// Registrar una nueva sesión
const addSession = (uid, token) => {
  const sessions = readSessions();
  sessions[uid] = { token, authenticated: false }; // Guardar sesión con token y estado de autenticación
  writeSessions(sessions);
};

// Actualizar el estado de autenticación
const updateSessionAuth = (uid, authenticated) => {
  const sessions = readSessions();
  if (sessions[uid]) {
    sessions[uid].authenticated = authenticated; // Actualizar autenticación
    writeSessions(sessions);
  }
};

// Validar token
const validateToken = (token) => {
  const sessions = readSessions();
  return Object.values(sessions).some(session => session.token === token);
};

// Verificar autenticación de usuario
const isAuthenticated = (uid) => {
  const sessions = readSessions();
  return sessions[uid]?.authenticated || false;
};

module.exports = {
  addSession,
  updateSessionAuth,
  validateToken,
  isAuthenticated,
};
