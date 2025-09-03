const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:3000", 
      "http://localhost:3001", 
      "https://bd1.up.railway.app",
      "https://*.up.railway.app", 
      "https://*.railway.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  // Performance optimizations
  pingTimeout: 60000,
  pingInterval: 25000,
  upgradeTimeout: 30000,
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// Session storage (in-memory for POC) with cleanup
const sessions = new Map();

// Clean up old sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  sessions.forEach((session, code) => {
    // Remove sessions older than 2 hours with no users
    if (session.users.length === 0 && (now - session.created) > 2 * 60 * 60 * 1000) {
      sessions.delete(code);
      console.log('Cleaned up old session:', code);
    }
  });
}, 10 * 60 * 1000);

// Generate random session code
function generateSessionCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Create new session
  socket.on('create-session', (userData, callback) => {
    const sessionCode = generateSessionCode();
    const session = {
      code: sessionCode,
      host: socket.id,
      users: [{
        id: socket.id,
        name: userData.name,
        instrument: userData.instrument
      }],
      created: Date.now()
    };
    
    sessions.set(sessionCode, session);
    socket.join(sessionCode);
    
    callback({ success: true, sessionCode, session });
    console.log('Session created:', sessionCode);
  });

  // Join existing session
  socket.on('join-session', ({ sessionCode, userData }, callback) => {
    const session = sessions.get(sessionCode);
    
    if (!session) {
      callback({ success: false, error: 'Session not found' });
      return;
    }
    
    if (session.users.length >= 2) {
      callback({ success: false, error: 'Session full' });
      return;
    }
    
    session.users.push({
      id: socket.id,
      name: userData.name,
      instrument: userData.instrument
    });
    
    socket.join(sessionCode);
    
    // Notify other users
    socket.to(sessionCode).emit('user-joined', {
      user: userData,
      users: session.users
    });
    
    callback({ success: true, session });
    console.log('User joined session:', sessionCode);
  });

  // Throttled event relay for performance
  const eventThrottles = {};
  
  socket.on('pad-trigger', ({ sessionCode, padId, velocity, preset }) => {
    socket.to(sessionCode).emit('pad-trigger', { padId, velocity, preset });
  });

  // Throttle high-frequency synth updates to 30fps
  socket.on('synth-params', ({ sessionCode, params }) => {
    const throttleKey = `${socket.id}-synth`;
    if (!eventThrottles[throttleKey]) {
      eventThrottles[throttleKey] = true;
      socket.to(sessionCode).emit('synth-params', params);
      setTimeout(() => {
        delete eventThrottles[throttleKey];
      }, 33); // ~30fps
    }
  });

  socket.on('effect-change', ({ sessionCode, effect, value }) => {
    socket.to(sessionCode).emit('effect-change', { effect, value });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Remove user from sessions
    sessions.forEach((session, code) => {
      const userIndex = session.users.findIndex(u => u.id === socket.id);
      if (userIndex !== -1) {
        session.users.splice(userIndex, 1);
        
        // Notify others in session
        io.to(code).emit('user-left', { userId: socket.id });
        
        // Clean up empty sessions
        if (session.users.length === 0) {
          sessions.delete(code);
          console.log('Session removed:', code);
        }
      }
    });
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

const PORT = process.env.PORT || 3002;
httpServer.listen(PORT, () => {
  console.log(`Collaboration server running on port ${PORT}`);
});