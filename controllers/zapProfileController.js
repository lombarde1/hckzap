const axios = require('axios');

class ProfileController {
    constructor() {
        this.baseUrl = 'https://api.hocketzap.com';
        this.apiKey = 'darkadm';
        this.instance = 'default_instance';
    }

    async fetchProfile(req, res) {
        try {
            const { number } = req.body;
            const { instance } = req.params;
            const response = await axios.post(
                `${this.baseUrl}/chat/fetchProfile/${instance}`,
                { number },
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            console.log(error)
            res.status(500).json({ error: error.message });
        }
    }

    async updateProfileName(req, res) {
        try {
            const { name } = req.body;
            const { instance } = req.params;
            const response = await axios.post(
                `${this.baseUrl}/chat/updateProfileName/${instance}`,
                { name },
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async updateProfileStatus(req, res) {
        try {
            const { status } = req.body;
            const { instance } = req.params;
            const response = await axios.post(
                `${this.baseUrl}/chat/updateProfileStatus/${instance}`,
                { status },
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async updateProfilePicture(req, res) {
        try {
            const { picture } = req.body;
            const { instance } = req.params;
            const response = await axios.post(
                `${this.baseUrl}/chat/updateProfilePicture/${instance}`,
                { picture },
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async removeProfilePicture(req, res) {
        try {
            const { instance } = req.params;
            const response = await axios.delete(
                `${this.baseUrl}/chat/removeProfilePicture/${instance}`,
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async fetchPrivacySettings(req, res) {
        try {
            const { instance } = req.params;
            const response = await axios.get(
                `${this.baseUrl}/chat/fetchPrivacySettings/${instance}`,
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    async updatePrivacySettings(req, res) {
        try {
            const settings = req.body;
            const { instance } = req.params;
            const response = await axios.post(
                `${this.baseUrl}/chat/updatePrivacySettings/${instance}`,
                settings,
                { headers: { apikey: this.apiKey } }
            );
            res.json(response.data);
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new ProfileController();

