// groupRoutes.js

const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');

router.post('/create/:instance', groupController.createGroup);
router.post('/updateGroupPicture/:instance', groupController.updateGroupPicture);
router.post('/updateGroupSubject/:instance', groupController.updateGroupSubject);
router.post('/updateGroupDescription/:instance', groupController.updateGroupDescription);
router.get('/inviteCode/:instance', groupController.fetchInviteCode);
router.post('/revokeInviteCode/:instance', groupController.revokeInviteCode);
router.post('/sendInvite/:instance', groupController.sendInviteUrl);
router.get('/inviteInfo/:instance', groupController.findGroupByInviteCode);
router.get('/findGroupInfos/:instance', groupController.findGroupByJid);
router.get('/fetchAllGroups/:instance', groupController.fetchAllGroups);
router.get('/participants/:instance', groupController.findParticipants);
router.post('/updateParticipant/:instance', groupController.updateParticipant);
router.post('/updateSetting/:instance', groupController.updateSetting);
router.post('/toggleEphemeral/:instance', groupController.toggleEphemeral);
router.delete('/leaveGroup/:instance', groupController.leaveGroup);

module.exports = router;