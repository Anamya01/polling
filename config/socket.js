// config/socket.js
const pollService = require('../services/pollService');

module.exports = function initSockets(io) {
  pollService.init(io);

  io.on('connection', (socket) => {
    console.log('Socket connected:', socket.id);

    // Teacher creates a poll
    // data: { question: string, options: [string], timeLimit: number (seconds) }
    socket.on('teacher:createPoll', (data, ack) => {
      try {
        const poll = pollService.createPoll({
          question: data.question,
          options: data.options,
          timeLimit: data.timeLimit || 60,
          teacherSocketId: socket.id
        });
        if (ack) ack({ status: 'ok', pollId: poll.id });
      } catch (err) {
        if (ack) ack({ status: 'error', message: err.message });
      }
    });

    // Student joins (stores name mapped to socket.id)
    // payload: { name: string }
    socket.on('student:join', (payload, ack) => {
      try {
        pollService.addStudent(socket.id, payload.name);
        if (ack) ack({ status: 'ok' });
      } catch (err) {
        if (ack) ack({ status: 'error', message: err.message });
      }
    });

    // Student submits answer
    // payload: { answerIndex: number }
    socket.on('student:submitAnswer', (payload, ack) => {
      try {
        pollService.submitAnswer(socket.id, payload.answerIndex);
        if (ack) ack({ status: 'ok' });
      } catch (err) {
        if (ack) ack({ status: 'error', message: err.message });
      }
    });

    // Simple global chat
    // payload: { sender: string, text: string, role?: 'teacher'|'student' }
    socket.on('chat_message', (msg) => {
      const envelope = { ...msg, timestamp: new Date().toISOString() };
      io.emit('chat_message', envelope);
    });

    // Teacher removes a student
    // payload: { studentId: socketId }
    socket.on('remove-student', (payload, ack) => {
      try {
        pollService.removeStudent(payload.studentId);
        if (ack) ack({ status: 'ok' });
      } catch (err) {
        if (ack) ack({ status: 'error', message: err.message });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', socket.id, reason);
      pollService.handleDisconnect(socket.id);
    });
  });
};
