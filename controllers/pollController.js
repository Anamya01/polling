const pollService = require('../services/pollService');

exports.createPoll = (req, res) => {
  try {
    const { question, options, timeLimit } = req.body;
    const poll = pollService.createPoll({ question, options, timeLimit });
    res.json({ status: 'ok', pollId: poll.id });
  } catch (err) {
    res.status(400).json({ status: 'error', message: err.message });
  }
};

exports.getActivePoll = (req, res) => {
  const p = pollService.getActivePoll();
  if (!p) return res.status(404).json({ message: 'No active poll' });
  res.json({
    id: p.id,
    question: p.question,
    options: p.options.map(o => o.text),
    timeLimit: p.timeLimit,
    status: p.status
  });
};

exports.getPoll = (req, res) => {
  const p = pollService.getPollById(req.params.id);
  if (!p) return res.status(404).json({ message: 'Not found' });
  res.json(p);
};
