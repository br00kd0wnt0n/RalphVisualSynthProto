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
    origin: ["http://localhost:3000", "http://localhost:3001", "https://*.up.railway.app", "https://*.railway.app"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Session storage (in-memory for POC)
const sessions = new Map();

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

  // Relay instrument events
  socket.on('pad-trigger', ({ sessionCode, padId, velocity }) => {
    socket.to(sessionCode).emit('pad-trigger', { padId, velocity });
  });

  socket.on('synth-params', ({ sessionCode, params }) => {
    socket.to(sessionCode).emit('synth-params', params);
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