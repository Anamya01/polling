// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const socketConfig = require('./config/socket');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// register socket event handlers
socketConfig(io);

// optional REST routes (useful for debugging)
const pollRoutes = require('./routes/pollRoutes');
app.use('/api/polls', pollRoutes);

app.get('/', (req, res) => res.send('Polling backend is running'));

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
