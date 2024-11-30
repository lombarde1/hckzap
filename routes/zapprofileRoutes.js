const express = require('express');
const router = express.Router();
const ProfileController = require('../controllers/zapProfileController');

router.post('/:instance/fetch', ProfileController.fetchProfile.bind(ProfileController));
router.post('/:instance/updateName', ProfileController.updateProfileName.bind(ProfileController));
router.post('/:instance/updateStatus', ProfileController.updateProfileStatus.bind(ProfileController));
router.post('/:instance/updatePicture', ProfileController.updateProfilePicture.bind(ProfileController));
router.delete('/:instance/removePicture', ProfileController.removeProfilePicture.bind(ProfileController));
router.get('/:instance/privacySettings', ProfileController.fetchPrivacySettings.bind(ProfileController));
router.post('/:instance/updatePrivacySettings', ProfileController.updatePrivacySettings.bind(ProfileController));

module.exports = router;