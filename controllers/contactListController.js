const ContactList = require('../models/ContactList');

exports.getAllLists = async (req, res) => {
  try {
    const lists = await ContactList.find({ user: req.user.id });
    res.json(lists);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar listas de contatos' });
  }
};

exports.createList = async (req, res) => {
  try {
    const newList = new ContactList({
      name: req.body.name,
      user: req.user.id
    });
    await newList.save();
    res.status(201).json(newList);
  } catch (error) {
    res.status(400).json({ message: 'Erro ao criar lista de contatos' });
  }
};

exports.addContact = async (req, res) => {
  try {
    const list = await ContactList.findOne({ _id: req.params.listId, user: req.user.id });
    if (!list) {
      return res.status(404).json({ message: 'Lista não encontrada' });
    }
    list.contacts.push(req.body);
    await list.save();
    res.status(201).json(list);
  } catch (error) {
    console.log(error)
    res.status(400).json({ message: 'Erro ao adicionar contato' });
  }
};

exports.deleteContact = async (req, res) => {
  try {
    const list = await ContactList.findOne({ _id: req.params.listId, user: req.user.id });
    if (!list) {
      return res.status(404).json({ message: 'Lista não encontrada' });
    }
    list.contacts.id(req.params.contactId).remove();
    await list.save();
    res.json({ message: 'Contato removido com sucesso' });
  } catch (error) {
    res.status(400).json({ message: 'Erro ao remover contato' });
  }
};

exports.renderContactListsPage = async (req, res) => {
    try {
      res.render('contact-lists', { 
        title: 'Gerenciar Listas de Contatos',
        user: req.user
      });
    } catch (error) {
      console.error('Erro ao renderizar página de listas de contatos:', error);
      res.status(500).render('error', { message: 'Erro ao carregar página de listas de contatos' });
    }
  };
  
exports.deleteList = async (req, res) => {
  try {
    await ContactList.findOneAndDelete({ _id: req.params.listId, user: req.user.id });
    res.json({ message: 'Lista removida com sucesso' });
  } catch (error) {
    res.status(400).json({ message: 'Erro ao remover lista' });
  }
};