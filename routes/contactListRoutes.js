const express = require('express');
const router = express.Router();
const { ensureAuthenticated } = require('../middleware/auth');
const contactListController = require('../controllers/contactListController');
const ContactList = require('../models/ContactList');

// Rota para renderizar a página de listas de contatos
router.get('/painel', ensureAuthenticated, contactListController.renderContactListsPage);

router.get('/:listId/contacts2', async (req, res) => {
    try {
        const { listId } = req.params;
        const { spamFilter, qualityFilter } = req.query;
        const userId = req.user.id;

        console.log('Buscando lista:', listId);
        console.log('UserId:', userId);
        console.log('Filtros:', { spamFilter, qualityFilter });

        const contactList = await ContactList.findOne({ _id: listId, user: userId });
        if (!contactList) {
            console.log('Lista não encontrada');
            return res.status(404).json({ error: 'Lista de contatos não encontrada' });
        }

        console.log('Lista encontrada. Total de contatos:', contactList.contacts.length);

        let filteredContacts = contactList.contacts;

        if (spamFilter !== undefined && spamFilter !== '') {
            const spamFilterValue = parseInt(spamFilter, 10);
            console.log('Aplicando filtro de spam:', spamFilterValue);
            filteredContacts = filteredContacts.filter(contact => {
                const spamCount = contact.spamCount || 0;
                console.log('Contato:', contact.name, 'SpamCount:', spamCount);
                return spamCount <= spamFilterValue;
            });
        }

        if (qualityFilter && qualityFilter !== 'all') {
            console.log('Aplicando filtro de qualidade:', qualityFilter);
            filteredContacts = filteredContacts.filter(contact => {
                console.log('Contato:', contact.name, 'Qualidade:', contact.quality);
                return contact.quality === qualityFilter;
            });
        }

        console.log('Contatos filtrados:', filteredContacts.length);

        res.json(filteredContacts);
    } catch (error) {
        console.error('Erro ao buscar contatos:', error);
        res.status(500).json({ error: 'Erro ao buscar contatos' });
    }
});

router.get('/', ensureAuthenticated, contactListController.getAllLists);
router.post('/', ensureAuthenticated, contactListController.createList);
router.post('/:listId/contacts', ensureAuthenticated, contactListController.addContact);
router.delete('/:listId/contacts/:contactId', ensureAuthenticated, contactListController.deleteContact);
router.delete('/:listId', ensureAuthenticated, contactListController.deleteList);

module.exports = router;