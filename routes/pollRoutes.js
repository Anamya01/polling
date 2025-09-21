const express = require('express');
const router = express.Router();
const pollController = require('../controllers/pollController');

router.post('/', pollController.createPoll);
router.get('/active', pollController.getActivePoll);
router.get('/:id', pollController.getPoll);

module.exports = router;
