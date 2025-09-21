const { polls } = require('../models/pollModel');
const { generateId } = require('../utils/helpers');

let io = null;

// Global student registry to persist students between polls
const connectedStudents = {}; // { socketId: { name, connectedAt } }

function init(ioInstance) {
  io = ioInstance;
}

function getActivePoll() {
  return Object.values(polls).find(p => p.status === 'active') || null;
}

function createPoll({ question, options, timeLimit = 60, teacherSocketId }) {
  // Input validation
  if (!question || typeof question !== 'string' || !question.trim()) {
    throw new Error('Question is required');
  }
  
  if (!Array.isArray(options) || options.length < 2) {
    throw new Error('At least 2 options are required');
  }
  
  const validOptions = options.filter(opt => 
    opt && typeof opt === 'string' && opt.trim()
  );
  
  if (validOptions.length < 2) {
    throw new Error('At least 2 valid options are required');
  }
  
  if (timeLimit < 10 || timeLimit > 3600) {
    throw new Error('Time limit must be between 10 and 3600 seconds');
  }

  // Check for existing active poll
  if (getActivePoll()) throw new Error('Another poll is currently active');

  const id = generateId();
  const poll = {
    id,
    question: question.trim(),
    options: validOptions.map(opt => ({ text: opt.trim(), count: 0 })),
    responses: {},         // { socketId: optionIndex }
    students: { ...connectedStudents }, // Start with all connected students
    status: 'active',
    timeLimit,
    teacherSocketId,
    timer: null,
    createdAt: new Date().toISOString()
  };

  // start timeout
  poll.timer = setTimeout(() => endPoll(id), timeLimit * 1000);
  polls[id] = poll;

  console.log(`Poll created with ${Object.keys(poll.students).length} existing students`);

  // broadcast to everyone that poll started
  io.emit('server:pollStarted', {
    pollId: id,
    question: poll.question,
    options: poll.options.map(o => o.text),
    timeLimit: poll.timeLimit
  });

  return poll;
}

function addStudent(socketId, name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Valid name is required');
  }

  const cleanName = name.trim();
  
  // Always add to global registry
  connectedStudents[socketId] = { 
    name: cleanName, 
    connectedAt: new Date().toISOString() 
  };
  io.emit('server:studentJoined', { socketId, name: cleanName });
  const poll = getActivePoll();
  if (!poll) {
    // No active poll, but student is now registered for future polls
    console.log(`Student ${cleanName} registered, waiting for active poll`);
    return null;
  }

  // Add to active poll 
  poll.students[socketId] = { name: cleanName };
  
  console.log(`Student ${cleanName} joined active poll. Total students: ${Object.keys(poll.students).length}`);
  
  
  // Broadcast updated student count
  io.emit('server:pollUpdate', {
    pollId: poll.id,
    counts: poll.options.map(o => o.count),
    answered: Object.keys(poll.responses).length,
    totalStudents: Object.keys(poll.students).length
  });

  return poll;
}

function submitAnswer(socketId, optionIndex) {
    const poll = getActivePoll();
    if (!poll) throw new Error('No active poll');
    if (poll.status !== 'active') throw new Error('Poll is not active');
    if (poll.responses[socketId] !== undefined) throw new Error('You have already answered');
  
    // If student isn't in poll but is in global registry, add them
    if (!poll.students[socketId] && connectedStudents[socketId]) {
      poll.students[socketId] = { name: connectedStudents[socketId].name };
      io.emit('server:studentJoined', { 
        socketId, 
        name: connectedStudents[socketId].name 
      });
    } else if (!poll.students[socketId]) {
      // Create anonymous user if not registered anywhere
      const anonNumber = Object.keys(poll.students).filter(id => 
        poll.students[id].name.startsWith('Anonymous')
      ).length + 1;
      const anonName = `Anonymous${anonNumber}`;
      
      poll.students[socketId] = { name: anonName };
      connectedStudents[socketId] = { name: anonName, connectedAt: new Date().toISOString() };
      
      io.emit('server:studentJoined', { socketId, name: anonName });
    }
  
    // Validate option index
    if (optionIndex < 0 || optionIndex >= poll.options.length) {
      throw new Error('Invalid option');
    }
  
    // Record response
    poll.responses[socketId] = optionIndex;
    poll.options[optionIndex].count += 1;
  
    const totalStudents = Object.keys(poll.students).length;
    const totalResponses = Object.keys(poll.responses).length;
  
    console.log(`Vote submitted by ${poll.students[socketId].name}. Responses: ${totalResponses}/${totalStudents}`);
  
    // Broadcast live update
    io.emit('server:pollUpdate', {
      pollId: poll.id,
      counts: poll.options.map(o => o.count),
      answered: totalResponses,
      totalStudents: totalStudents
    });
  
    // End poll early if ALL students have answered (with safety checks)
    if (totalStudents > 0 && totalResponses >= totalStudents) {
      console.log(`All ${totalStudents} students have answered, ending poll early`);
      endPoll(poll.id);
    }
  
    return poll;
  }

function endPoll(pollId) {
  const poll = polls[pollId];
  if (!poll || poll.status === 'finished') return;

  poll.status = 'finished';
  if (poll.timer) {
    clearTimeout(poll.timer);
    poll.timer = null;
  }

  const finalCounts = poll.options.map(o => o.count);
  console.log(`Poll ${pollId} ended. Final results:`, finalCounts);
  
  io.emit('server:pollResults', {
    pollId: poll.id,
    finalCounts,
    options: poll.options.map(o => o.text)
  });

  // Clean up finished polls after 3 minutes to prevent memory leaks
  setTimeout(() => {
    delete polls[pollId];
    console.log(`Cleaned up poll ${pollId}`);
  }, 5 * 60 * 1000);
}

function removeStudent(studentId) {
  console.log(`Attempting to remove student: ${studentId}`);
  console.log(`Connected students:`, Object.keys(connectedStudents));
  
  const poll = getActivePoll();
  
  // Remove from global registry
  delete connectedStudents[studentId];
  
  if (!poll) {
    console.log('No active poll found');
    return;
  }

  console.log(`Poll students:`, Object.keys(poll.students));

  if (poll.students[studentId]) {
    // if they answered, decrement the count
    if (poll.responses[studentId] !== undefined) {
      const idx = poll.responses[studentId];
      poll.options[idx].count = Math.max(0, poll.options[idx].count - 1);
      delete poll.responses[studentId];
    }
    delete poll.students[studentId];

    console.log(`Student removed. Remaining: ${Object.keys(poll.students).length}`);

    // notify all clients and the removed student
    io.emit('server:studentRemoved', { studentId });
    
    // Broadcast updated counts
    io.emit('server:pollUpdate', {
      pollId: poll.id,
      counts: poll.options.map(o => o.count),
      answered: Object.keys(poll.responses).length,
      totalStudents: Object.keys(poll.students).length
    });

    console.log(`Looking for socket: ${studentId}`);
    const s = io.sockets.sockets.get(studentId);
    console.log(`Socket found:`, !!s);
    
    if (s) {
      console.log(`Emitting 'removed' event to ${studentId}`);
      s.emit('removed', { message: 'You were removed by the teacher' });
    } else {
      console.log(`Socket ${studentId} not found - student may have disconnected`);
    }
  } else {
    console.log(`Student ${studentId} not found in poll.students`);
  }
}

function handleDisconnect(socketId) {
  // Remove from global registry
  const studentName = connectedStudents[socketId]?.name;
  delete connectedStudents[socketId];
  
  const poll = getActivePoll();
  if (!poll) return;

  if (poll.students[socketId]) {
    // treat disconnect as leaving — remove student and any answer
    if (poll.responses[socketId] !== undefined) {
      const idx = poll.responses[socketId];
      poll.options[idx].count = Math.max(0, poll.options[idx].count - 1);
      delete poll.responses[socketId];
    }
    delete poll.students[socketId];
    
    console.log(`Student ${studentName} disconnected. Remaining: ${Object.keys(poll.students).length}`);
    
    io.emit('server:studentLeft', { socketId });

    // broadcast updated counts (removed early termination logic)
    io.emit('server:pollUpdate', {
      pollId: poll.id,
      counts: poll.options.map(o => o.count),
      answered: Object.keys(poll.responses).length,
      totalStudents: Object.keys(poll.students).length
    });
  }
}

function getPollById(id) {
  return polls[id] || null;
}

// Helper function to get connected students (for debugging)
function getConnectedStudents() {
  return connectedStudents;
}

module.exports = {
  init,
  createPoll,
  addStudent,
  submitAnswer,
  endPoll,
  removeStudent,
  handleDisconnect,
  getActivePoll,
  getPollById,
  getConnectedStudents
};