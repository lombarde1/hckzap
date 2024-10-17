// Configuração inicial
const socket = io();
let currentUserImage = '';
let currentInstanceNumber = '';
let currentChatInfo = null;
let currentInstanceKey = '';
let currentChatId = '';
let chats = [];
let userFunnels = [];
let activeFunnels = {};
let currentSelectedFunnel = null;
let funnelReportInterval;
let generatedAudioBlob = null;

// Cache e armazenamento
const lastSeenCache = JSON.parse(localStorage.getItem('lastSeenCache')) || {};
const profileImageCache = {};

// Elementos DOM
const elements = {
    voiceButton: document.getElementById('voiceButton'),
    voiceModal: document.getElementById('voiceModal'),
    closeVoiceModal: document.getElementById('closeVoiceModal'),
    generateVoiceButton: document.getElementById('generateVoiceButton'),
    voiceText: document.getElementById('voiceText'),
    voiceSelect: document.getElementById('voiceSelect'),
    audioPreview: document.getElementById('audioPreview'),
    generatedAudio: document.getElementById('generatedAudio'),
    sendVoiceButton: document.getElementById('sendVoiceButton'),
    instanceModal: document.getElementById('instanceModal'),
    instanceSelect: document.getElementById('instanceSelect'),
    confirmInstance: document.getElementById('confirmInstance'),
    chatContainer: document.getElementById('chatContainer'),
    chatList: document.getElementById('chatList'),
    mobileChatList: document.getElementById('mobileChatList'),
    messageList: document.getElementById('messageList'),
    mobileMessageList: document.getElementById('mobileMessageList'),
    chatName: document.getElementById('chatName'),
    mobileChatName: document.getElementById('mobileChatName'),
    chatAvatar: document.getElementById('chatAvatar'),
    mobileChatAvatar: document.getElementById('mobileChatAvatar'),
    messageInput: document.getElementById('messageInput'),
    mobileMessageInput: document.getElementById('mobileMessageInput'),
    sendButton: document.getElementById('sendButton'),
    mobileSendButton: document.getElementById('mobileSendButton'),
    mobileChats: document.getElementById('mobileChats'),
    mobileMessages: document.getElementById('mobileMessages'),
    backButton: document.getElementById('backButton'),
    refreshButton: document.getElementById('refreshButton'),
    mobileRefreshButton: document.getElementById('mobileRefreshButton'),
    searchChat: document.getElementById('searchChat'),
    mobileSearchChat: document.getElementById('mobileSearchChat'),
    notificationSound: document.getElementById('notificationSound'),
    sendSound: document.getElementById('sendSound'),
    settingsModal: document.getElementById('settingsModal'),
    closeSettingsModal: document.getElementById('closeSettingsModal'),
    sendSoundToggle: document.getElementById('sendSoundToggle'),
    receiveSoundToggle: document.getElementById('receiveSoundToggle'),
    wallpaperInput: document.getElementById('wallpaperInput'),
    funnelsContainer: document.getElementById('funnelsContainer'),
    mobileFunnelsContainer: document.getElementById('mobileFunnelsContainer'),
    funnelReportPopup: document.getElementById('funnelReportPopup'),
    openFunnelReportBtn: document.getElementById('openFunnelReport'),
    closeFunnelReportBtn: document.getElementById('closeFunnelReport'),
    totalStepsElement: document.getElementById('totalSteps'),
    currentStepElement: document.getElementById('currentStep'),
    hasInputElement: document.getElementById('hasInput'),
    waitingForInputElement: document.getElementById('waitingForInput'),
    waitingForInputAlert: document.getElementById('waitingForInputAlert'),
    currentContentElement: document.getElementById('currentContent'),
    funnelAnimationElement: document.getElementById('funnelAnimation'),
    activeFunnelsList: document.getElementById('activeFunnelsList'),
    funnelDetails: document.getElementById('funnelDetails'),
    profileButton: document.getElementById('profileButton'),
    profileModal: document.getElementById('profileModal'),
    closeProfileModal: document.getElementById('closeProfileModal'),
    changeProfilePicture: document.getElementById('changeProfilePicture'),
    profilePictureInput: document.getElementById('profilePictureInput'),
    currentProfilePicture: document.getElementById('currentProfilePicture'),
    profileName: document.getElementById('profileName'),
    profileStatus: document.getElementById('profileStatus'),
    saveProfileChanges: document.getElementById('saveProfileChanges'),
    emojiButton: document.getElementById('emojiButton'),
    emojiPicker: document.getElementById('emojiPicker'),
    emojiList: document.getElementById('emojiList'),
    searchMessagesButton: document.getElementById('searchMessagesButton'),
    searchMessagesContainer: document.getElementById('searchMessagesContainer'),
    messageSearch: document.getElementById('messageSearch'),
    statusAnimation: document.getElementById('statusAnimation'),
    animationIcon: document.getElementById('animationIcon'),
    animationText: document.getElementById('animationText')
};

// Funções de utilidade
function formatTimestamp(timestamp) {
    return moment.unix(timestamp).tz('America/Sao_Paulo').format('DD/MM/YYYY HH:mm:ss');
}

function formatPhoneNumber(num) {
    const cleaned = num.replace(/\D/g, '');
    const ddd = parseInt(cleaned.slice(0, 2));
    return ddd <= 27 ? cleaned.padStart(13, '55') : cleaned.padStart(12, '55');
}

function formatarNumeroBrasileiro(numero) {
    numero = numero.replace(/\D/g, '');
    if (!numero.startsWith('55')) return false;
    numero = numero.slice(2);
    const ddd = parseInt(numero.slice(0, 2));
    if (ddd < 11 || ddd > 99) return false;
    if (ddd <= 27) {
        numero = numero.length < 11 ? numero.slice(0, 2) + '9' + numero.slice(2) : numero.slice(0, 11);
    } else {
        numero = numero.length > 10 ? numero.slice(0, 2) + numero.slice(3).slice(0, 8) : numero;
        if (numero.length < 10) return false;
    }
    return '55' + numero;
}

function showPopup(message, type = 'success') {
    const popup = document.createElement('div');
    popup.className = `fixed top-4 right-4 px-4 py-2 rounded shadow-lg transform transition-all duration-300 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'} text-white`;
    popup.textContent = message;
    document.body.appendChild(popup);
    setTimeout(() => {
        popup.style.opacity = '0';
        popup.style.transform = 'translateY(-20px)';
        setTimeout(() => popup.remove(), 300);
    }, 3000);
}

// Funções principais
async function loadVoices() {
    try {
        const response = await fetch('/integrations/elevenlabs/config');
        const data = await response.json();
        elements.voiceSelect.innerHTML = '<option disabled selected>Selecione uma voz</option>';
        data.tonsOptions.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice.nome;
            option.textContent = voice.nome;
            elements.voiceSelect.appendChild(option);
        });
    } catch (error) {
        console.error('Erro ao carregar vozes:', error);
        showPopup('Erro ao carregar vozes', 'error');
    }
}

async function generateVoice() {
    const text = elements.voiceText.value;
    const selectedVoice = elements.voiceSelect.value;

    if (!text || !selectedVoice) {
        showPopup('Por favor, preencha o texto e selecione uma voz', 'error');
        return;
    }

    try {
        const response = await fetch('/integrations/elevenlabs/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, tom: selectedVoice }),
        });

        if (!response.ok) throw new Error('Erro ao gerar áudio');

        const audioBlob = await response.blob();
        generatedAudioBlob = audioBlob;
        const audioUrl = URL.createObjectURL(audioBlob);
        elements.generatedAudio.src = audioUrl;
        elements.audioPreview.classList.remove('hidden');
    } catch (error) {
        console.error('Erro ao gerar áudio:', error);
        showPopup('Erro ao gerar áudio', 'error');
    }
}

async function sendVoice() {
    if (!generatedAudioBlob) {
        showPopup('Por favor, gere um áudio primeiro', 'error');
        return;
    }

    try {
        const formData = new FormData();
        formData.append('audio', generatedAudioBlob, 'audio.mp3');
        formData.append('instanceKey', currentInstanceKey);
        formData.append('chatId', currentChatId);

        const response = await fetch('/zapvoice/send-audio', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) throw new Error('Erro ao enviar áudio');

        showPopup('Áudio enviado com sucesso', 'success');
        elements.voiceModal.classList.remove('modal-open');
        resetVoiceModal();
    } catch (error) {
        console.error('Erro ao enviar áudio:', error);
        showPopup('Erro ao enviar áudio', 'error');
    }
}

function resetVoiceModal() {
    elements.voiceText.value = '';
    elements.voiceSelect.selectedIndex = 0;
    elements.audioPreview.classList.add('hidden');
    elements.generatedAudio.src = '';
    generatedAudioBlob = null;
}

async function loadInstances() {
                            
    const response = await fetch('/whatsapp/list');
    const instances = await response.json();
    const instanceList = document.getElementById('instanceList');
    instanceList.innerHTML = '';

    let connectedCount = 0;
    instances.forEach(instance => {
        if (instance.isConnected) {
            connectedCount++;
            const instanceElement = document.createElement('div');
            instanceElement.className = 'bg-white p-4 rounded-lg shadow-md transition-all duration-300 hover:shadow-lg mb-4 transform hover:scale-102';
            instanceElement.innerHTML = `
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                <div class="mb-4 sm:mb-0">
                    <h3 class="text-xl font-semibold text-purple-700">${instance.name}</h3>
                    <p class="text-sm text-gray-600">Chave: ${instance.key}</p>
                    <p class="text-sm ${instance.isConnected ? 'text-green-600' : 'text-red-600'} font-medium mt-2">
                        <i class="fas fa-${instance.isConnected ? 'check-circle' : 'times-circle'} mr-2"></i>
                        ${instance.isConnected ? 'Conectado' : 'Desconectado'}
                    </p>
                    ${instance.whatsappName ? `<p class="text-sm text-blue-600 font-medium">WhatsApp: ${instance.whatsappName}</p>` : ''}
                </div>
                <div class="flex flex-wrap gap-2">
                    <button onclick="selectInstance('${instance.name}', '${instance.foto}', '${instance}')" class="btn btn-primary btn-sm" ${!instance.isConnected ? 'disabled' : ''}>
                        <i class="fas fa-check mr-1"></i> Selecionar
                    </button>
                </div>
            </div>
        `;
        updateInstanceCount(connectedCount);
            instanceList.appendChild(instanceElement);
        }
    });

    const connectedInstancesCount = document.getElementById('connectedInstancesCount');
    const noInstancesError = document.getElementById('noInstancesError');

    if (connectedCount > 0) {
        connectedInstancesCount.textContent = `${connectedCount} Instância(s) Conectada(s)`;
        noInstancesError.classList.add('hidden');
    } else {
        connectedInstancesCount.textContent = 'Nenhuma Instância Conectada';
        noInstancesError.classList.remove('hidden');
    }
}





function updateInstanceCount(connectedCount) {
    const connectedInstancesCount = document.getElementById('connectedInstancesCount');
    const noInstancesError = document.getElementById('noInstancesError');

    if (connectedCount > 0) {
        connectedInstancesCount.textContent = `${connectedCount} Instância(s) Conectada(s)`;
        noInstancesError.classList.add('hidden');
    } else {
        connectedInstancesCount.textContent = 'Nenhuma Instância Conectada';
        noInstancesError.classList.remove('hidden');
    }
}

function selectInstance(instanceKey, foto, instanceString) {
    currentInstanceKey = instanceKey;
    currentUserImage = foto || 'https://cdn-icons-png.flaticon.com/512/4792/4792929.png';
    elements.instanceModal.classList.remove('modal-open');
    elements.chatContainer.classList.remove('hidden');
    joinInstance(instanceKey);

    // Tente analisar a string JSON, mas use um objeto vazio se falhar
    let instance;
    try {
        instance = JSON.parse(instanceString);
    } catch (error) {
        console.error('Erro ao analisar a string da instância:', error);
        instance = {};
    }

    updateProfileInMenu(instance);
    loadUserFunnels();
    loadCurrentInstanceProfile();
}

function joinInstance(instanceKey) {
    socket.emit('join instance', instanceKey);
    socket.emit('request initial chats', instanceKey);
    console.log('Entrando na instância:', instanceKey);
}

async function loadUserFunnels() {
    try {
        const response = await fetch('/funnels/api/list');
        if (!response.ok) {
            throw new Error('Failed to fetch user funnels');
        }
        userFunnels = await response.json();
        renderFunnels();
    } catch (error) {
        console.error('Erro ao carregar funis:', error);
        showPopup('Erro ao carregar funis', 'error');
    }
}

function renderFunnels() {
    const funnelHTML = userFunnels.map(funnel => `
        <button class="px-4 py-2 bg-primary-100 text-primary-800 rounded-full text-sm font-medium hover:bg-primary-200 transition-colors duration-200" data-funnel-id="${funnel.id}">
            ${funnel.name}
        </button>
    `).join('');
    elements.funnelsContainer.innerHTML = funnelHTML;
    elements.mobileFunnelsContainer.innerHTML = funnelHTML;

    document.querySelectorAll('[data-funnel-id]').forEach(button => {
        button.addEventListener('click', () => {
            const funnelId = button.dataset.funnelId;
            startFunnel(funnelId);
        });
    });
}

async function startFunnel(funnelId) {
    if (!currentInstanceKey || !currentChatId) {
        showPopup('Selecione um chat antes de iniciar um funil', 'error');
        return;
    }

    try {
        const response = await fetch('/chat/start-funnel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                funnelId: funnelId,
                instanceKey: currentInstanceKey,
                chatId: currentChatId
            }),
        });

        if (response.ok) {
            const data = await response.json();
            showPopup('Funil iniciado com sucesso');
            addActiveFinnel(funnelId, currentInstanceKey, currentChatId);
            updateFunnelReportButton();
        } else {
            const errorData = await response.json();
            showPopup(errorData.error || 'Erro ao iniciar funil', 'error');
        }
    } catch (error) {
        console.error('Erro ao iniciar funil:', error);
        showPopup('Erro ao iniciar funil', 'error');
    }
}

function addActiveFinnel(funnelId, instanceKey, chatId) {
    const key = `${instanceKey}:${chatId}`;
    activeFunnels[key] = { funnelId, instanceKey, chatId };
    updateActiveFunnelsList();
}

function updateActiveFunnelsList() {
    elements.activeFunnelsList.innerHTML = '';
    Object.entries(activeFunnels).forEach(async ([key, funnel]) => {
        const formattedNumber = formatPhoneNumber(funnel.chatId);
        if (!formattedNumber) {
            console.error('Número de telefone inválido');
            return;
        }

        const numfinal = formattedNumber.startsWith('55')
            ? await formatarNumeroBrasileiro(formattedNumber)
            : formattedNumber;

        const listItem = document.createElement('div');
        listItem.className = 'p-2 hover:bg-gray-100 cursor-pointer rounded';
        listItem.textContent = `Chat: ${numfinal}`;
        listItem.onclick = () => selectFunnel(key);
        elements.activeFunnelsList.appendChild(listItem);
    });
}

function selectFunnel(key) {
    currentSelectedFunnel = activeFunnels[key];
    updateFunnelDetails();
}

async function updateFunnelDetails() {
    if (!currentSelectedFunnel) return;

    try {
        const response = await fetch(`/chat/status?funnelId=${currentSelectedFunnel.funnelId}&instanceKey=${currentSelectedFunnel.instanceKey}&chatId=${currentSelectedFunnel.chatId}`);
        const data = await response.json();

        elements.funnelDetails.innerHTML = `
            <div class="grid grid-cols-2 gap-4 mb-4">
                <div class="bg-blue-50 p-3 rounded-lg">
                    <p class="text-sm font-medium text-blue-800">Total de passos</p>
                    <p class="text-2xl font-bold text-blue-600">${data.totalNodes}</p>
                </div>
                <div class="bg-green-50 p-3 rounded-lg">
                    <p class="text-sm font-medium text-green-800">Passo atual</p>
                    <p class="text-2xl font-bold text-green-600">${data.currentNodeIndex}</p>
                </div>
                <div class="bg-yellow-50 p-3 rounded-lg">
                    <p class="text-sm font-medium text-yellow-800">Contém input</p>
                    <p class="text-2xl font-bold text-yellow-600">${data.hasInput ? 'Sim' : 'Não'}</p>
                </div>
                <div class="bg-purple-50 p-3 rounded-lg">
                    <p class="text-sm font-medium text-purple-800">Aguardando resposta</p>
                    <p class="text-2xl font-bold text-purple-600">${data.waitingForInput ? 'Sim' : 'Não'}</p>
                </div>
            </div>
            <div class="mt-4">
                <h4 class="text-lg font-semibold text-gray-700 mb-2">Conteúdo Atual</h4>
                <div id="currentContent" class="bg-gray-100 p-4 rounded-lg">
                    ${formatCurrentContent(data.currentContent)}
                </div>
            </div>
            <div id="funnelAnimation" class="mt-6 h-40 w-full">
                ${createFunnelAnimation(data.currentNodeIndex, data.totalNodes)}
            </div>
        `;

        if (data.status === 'completed') {
            delete activeFunnels[`${currentSelectedFunnel.instanceKey}:${currentSelectedFunnel.chatId}`];
            updateActiveFunnelsList();
            showCompletionMessage(currentSelectedFunnel.chatId);
        }
    } catch (error) {
        console.error('Erro ao atualizar detalhes do funil:', error);
    }
}

function formatCurrentContent(content) {
    switch (content.type) {
        case 'text':
            return `<p class="text-gray-700">${content.value}</p>`;
        case 'image':
            return `<img src="${content.value}" alt="Current step image" class="max-w-full h-auto rounded-lg">`;
        case 'video':
            return `
                <video controls class="w-full rounded-lg">
                    <source src="${content.value}" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
            `;
        case 'audio':
            return `
                <audio controls class="w-full">
                    <source src="${content.value}" type="audio/mpeg">
                    Your browser does not support the audio element.
                </audio>
            `;
        default:
            return `<p class="text-gray-500">Conteúdo não disponível</p>`;
    }
}

function createFunnelAnimation(currentStep, totalSteps) {
    const progress = (currentStep / totalSteps) * 100;
    return `
        <svg class="w-full h-full" viewBox="0 0 100 100">
            <defs>
                <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stop-color="#4f46e5" />
                    <stop offset="100%" stop-color="#7c3aed" />
                </linearGradient>
            </defs>
            <path d="M10 10 L90 10 L50 90 Z" fill="none" stroke="#e2e8f0" stroke-width="2" />
            <path d="M10 10 L90 10 L50 90 Z" fill="none" stroke="url(#gradient)" stroke-width="2" stroke-dasharray="280" stroke-dashoffset="${280 - (280 * progress / 100)}">
                <animate attributeName="stroke-dashoffset" from="280" to="${280 - (280 * progress / 100)}" dur="1s" fill="freeze" />
            </path>
            <circle cx="50" cy="${10 + (80 * progress / 100)}" r="5" fill="url(#gradient)">
                <animate attributeName="cy" from="10" to="${10 + (80 * progress / 100)}" dur="1s" fill="freeze" />
            </circle>
        </svg>
    `;
}

function showCompletionMessage(chatId) {
    const completionMessage = document.createElement('div');
    completionMessage.className = 'fixed bottom-4 left-4 bg-green-500 text-white px-6 py-3 rounded-full shadow-lg';
    completionMessage.textContent = `Funil concluído com sucesso para o chat ${chatId}!`;
    document.body.appendChild(completionMessage);

    setTimeout(() => {
        completionMessage.remove();
    }, 5000);
}

function updateFunnelReportButton() {
    if (Object.keys(activeFunnels).length > 0) {
        elements.openFunnelReportBtn.classList.remove('hidden');
    } else {
        elements.openFunnelReportBtn.classList.add('hidden');
    }
}

function openFunnelReportPopup() {
    elements.funnelReportPopup.classList.remove('hidden');
    updateActiveFunnelsList();
    startFunnelReportInterval();
}

function closeFunnelReportPopup() {
    elements.funnelReportPopup.classList.add('hidden');
    stopFunnelReportInterval();
}

function startFunnelReportInterval() {
    stopFunnelReportInterval();
    funnelReportInterval = setInterval(() => {
        if (currentSelectedFunnel) {
            updateFunnelDetails();
        }
    }, 2000);
}

function stopFunnelReportInterval() {
    if (funnelReportInterval) {
        clearInterval(funnelReportInterval);
    }
}

function checkActiveFunnels() {
    setInterval(async () => {
        const activeFunnelKeys = Object.keys(activeFunnels);
        for (const key of activeFunnelKeys) {
            const [instanceKey, chatId] = key.split(':');
            const funnel = activeFunnels[key];
            try {
                const response = await fetch(`/funnels/status?funnelId=${funnel.funnelId}&instanceKey=${instanceKey}&chatId=${chatId}`);
                const data = await response.json();
                if (data.status === 'completed') {
                    delete activeFunnels[key];
                    updateActiveFunnelsList();
                    updateFunnelReportButton();
                    showCompletionMessage(chatId);
                }
            } catch (error) {
                console.error('Erro ao verificar status do funil:', error);
            }
        }
    }, 5000);
}

function getMediaDescription(messageType, content) {
    switch (messageType) {
        case 'image':
            return '🖼️ Imagem';
        case 'video':
            return '🎥 Vídeo';
        case 'audio':
            return '🎵 Áudio';
        case 'document':
            return '📄 Documento';
        case 'sticker':
            return '😊 Sticker';
        default:
            return content;
    }
}

function renderChats(chatsToRender) {
    const sortedChats = chatsToRender.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
    const chatHTML = sortedChats.map(chat => {
        const lastMessageContent = getMediaDescription(chat.lastMessageType, chat.lastMessage);
        const chatTypeIcon = chat.chatType === 'grupo' ? '👥' : '👤';
        const unreadCount = chat.unreadCount || 0;
        const unreadClass = unreadCount > 0 ? 'bg-primary-100' : '';
        const unreadIndicator = unreadCount > 0 ? `<span class="bg-primary-500 text-white text-xs font-bold px-2 py-1 rounded-full">${unreadCount}</span>` : '';
        const avatarUrl = profileImageCache[chat.id] || chat.image || 'https://cdn-icons-png.flaticon.com/512/4792/4792929.png';
        const formattedTime = formatTimestamp(chat.lastMessageTimestamp);
        const lastMessageColor = chat.lastMessageFromMe ? 'text-blue-600' : 'text-gray-600';
        
        return `
            <div class="chat-item p-3 hover:bg-gray-100 cursor-pointer rounded-lg transition duration-200 ease-in-out ${unreadClass}" data-chat-id="${chat.id}" data-chat-type="${chat.chatType}">
                <div class="flex items-center space-x-3">
                    <img src="${avatarUrl}" alt="${chat.name}" class="w-12 h-12 rounded-full object-cover">
                    <div class="flex-grow min-w-0">
                        <div class="flex justify-between items-baseline">
                            <h3 class="font-semibold text-gray-900 truncate">${chatTypeIcon} ${chat.name}</h3>
                            <span class="text-xs text-gray-500">${formattedTime}</span>
                        </div>
                        <p class="text-sm ${lastMessageColor} truncate">${lastMessageContent}</p>
                    </div>
                    ${unreadIndicator}
                    <button class="delete-chat-btn text-red-500 hover:text-red-700" data-chat-id="${chat.id}">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
    elements.chatList.innerHTML = chatHTML;
    elements.mobileChatList.innerHTML = chatHTML;
    addChatListeners();
}

function loadMessages(instanceKey, chatId) {
    socket.emit('request chat messages', instanceKey, chatId);
}

async function markChatAsRead(chatId) {
    try {
        await fetch(`/chat/mark-as-read/${currentInstanceKey}/${chatId}`, { method: 'POST' });
        updateChatReadStatus(chatId);
    } catch (error) {
        console.error('Erro ao marcar chat como lido:', error);
    }
}

function updateChatReadStatus(chatId) {
    const chatElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (chatElement) {
        chatElement.classList.remove('unread');
        const unreadIndicator = chatElement.querySelector('.bg-primary-500');
        if (unreadIndicator) {
            unreadIndicator.remove();
        }
        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.unreadCount = 0;
        }
    }
}

function getSenderName(message, chatId, currentChatInfo) {
    if (!currentChatInfo || (currentChatInfo.chatType !== 'grupo')) {
        return '';
    }

    let senderName = message.sender;
    if (message.info && message.info.userQueEnviou) {
        senderName = message.info.userQueEnviou;
    }
    return `
    <div class="chat-header text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-1 font-inter">
        ${senderName}
    </div>`;
}

function moveChatToTop(chatId) {
    const chatElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (chatElement && chatElement.parentNode) {
        chatElement.parentNode.prepend(chatElement);
    }
}

function getAvatarUrl(chat, chatId) {
    const defaultGroupImage = "https://portais.univasf.edu.br/reitoria/imagens/5ba6d9f7590b4a7d8f4456737206be0e.png/@@images/image.png";
    const defaultUserImage = "https://cdn-icons-png.flaticon.com/512/4792/4792929.png";

    if (chatId.includes("@g.us")) {
        return chat.senderImage || defaultGroupImage;
    }

    return chat.senderImage || defaultUserImage;
}

function renderMessages(messages, chatId) {
    const messageHTML = messages.map(message => {
        const messageClass = message.fromMe ? 'chat-end' : 'chat-start';
        const bubbleClass = message.fromMe ? 'bg-primary-500 text-white' : 'bg-white text-primary-800';
        let contentHtml = '';

        let senderImage;
        if (message.fromMe) {
            senderImage = currentUserImage || 'https://cdn-icons-png.flaticon.com/512/4792/4792929.png';
        } else {
            senderImage = profileImageCache[currentChatId] || 'https://cdn-icons-png.flaticon.com/512/4792/4792929.png';
        }

        let quotedMessageHtml = '';
        if (message.quotedMessage) {
            const quotedSender = message.quotedParticipant.replace("@s.whatsapp.net", "") || 'Desconhecido';
            quotedMessageHtml = `
                <div class="quoted-message bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 p-3 rounded-lg mb-2 border-l-4 border-indigo-500 shadow-sm transition-all duration-300 hover:shadow-md">
                    <div class="flex items-center mb-1">
                        <svg class="w-4 h-4 text-indigo-500 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"></path>
                        </svg>
                        <span class="text-xs font-semibold text-gray-600 dark:text-gray-300">${quotedSender}</span>
                    </div>
                    <p class="text-sm text-gray-700 dark:text-gray-200 line-clamp-2">${message.quotedMessage}</p>
                </div>
            `;
        }

        let statusIcon = '';
        if (message.fromMe) {
            statusIcon = `
                <span class="message-status">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                    </svg>
                </span>
            `;
        }

        switch (message.type) {
            case 'texto':
            case 'text':
                contentHtml = `<div class="chat-bubble ${bubbleClass}">${formatTextWithLinks(message.content)}</div>`;
                break;
            case 'image':
                contentHtml = `
                    <div class="chat-bubble ${bubbleClass} p-1">
                        <img src="${message.content}" alt="Image" class="media-content rounded-lg cursor-pointer" onclick="openMediaPopup('${message.content}', 'image')">
                    </div>`;
                break;
            case 'video':
                contentHtml = `
                    <div class="chat-bubble ${bubbleClass} p-1">
                        <video src="${message.content}" class="media-content rounded-lg cursor-pointer" onclick="openMediaPopup('${message.content}', 'video')"></video>
                    </div>`;
                break;
            case 'audio':
                contentHtml = `
                    <div class="chat-bubble ${bubbleClass} p-1">
                        <audio src="${message.content}" class="w-full" controls preload="none"></audio>
                    </div>`;
                break;
            case 'document':
                contentHtml = `
                    <div class="chat-bubble ${bubbleClass}">
                        <a href="${message.content}" target="_blank" class="flex items-center space-x-2 text-blue-600 hover:underline">
                            <i class="fas fa-file-alt"></i>
                            <span>Ver documento</span>
                        </a>
                    </div>`;
                break;
            case 'sticker':
                contentHtml = `
                    <div class="chat-bubble ${bubbleClass} p-1">
                        <img src="${message.content}" alt="Sticker" class="max-w-[150px] max-h-[150px]">
                    </div>`;
                break;
            default:
                contentHtml = `<div class="chat-bubble ${bubbleClass}">${formatTextWithLinks(message.content)}</div>`;
        }

        const senderNameHtml = getSenderName(message, chatId, currentChatInfo);
        if (!message.fromMe) {
            fetchProfileImage(currentInstanceKey, chatId);
        }
        return `
            <div class="chat ${messageClass} mb-4" data-chat-id="${message.fromMe ? 'me' : currentChatId}">
                <div class="chat-image avatar">
                    <div class="w-10 rounded-full">
                        <img src="${senderImage}" alt="${message.sender}" onerror="this.src='https://cdn-icons-png.flaticon.com/512/4792/4792929.png'">
                    </div>
                </div>
                <div class="chat-header text-xs opacity-50 mb-1">
                    ${senderNameHtml}
                    ${new Date(message.timestamp * 1000).toLocaleString()}
                </div>
                <div class="chat-bubble-wrapper">
                    ${quotedMessageHtml}
                    ${contentHtml}
                    ${statusIcon}
                </div>
            </div>
        `;
    }).join('');

    elements.messageList.innerHTML = messageHTML;
    elements.mobileMessageList.innerHTML = messageHTML;
    scrollToBottom();
}

function formatTextWithLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        if (url.match(/\.(jpeg|jpg|gif|png)$/)) {
            return `<img src="${url}" alt="Image" class="inline-media rounded-lg cursor-pointer" onclick="openMediaPopup('${url}', 'image')">`;
        } else if (url.match(/\.(mp4|webm|ogg)$/)) {
            return `<video src="${url}" class="inline-media rounded-lg cursor-pointer" onclick="openMediaPopup('${url}', 'video')"></video>`;
        } else if (url.match(/\.(mp3|wav)$/)) {
            return `<audio src="${url}" class="w-full" controls></audio>`;
        } else {
            return `<a href="${url}" target="_blank" class="text-blue-600 hover:underline">${url}</a>`;
        }
    });
}

function scrollToBottom() {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
    elements.mobileMessageList.scrollTop = elements.mobileMessageList.scrollHeight;
}

function openMediaPopup(src, type) {
    const mediaContainer = document.createElement('div');
    mediaContainer.className = 'fixed inset-0 flex items-center justify-center z-50 bg-black bg-opacity-75';
    let content;

    if (type === 'image') {
        content = `<img src="${src}" alt="Full size image" class="max-w-full max-h-full object-contain">`;
    } else if (type === 'video') {
        content = `<video src="${src}" controls class="max-w-full max-h-full object-contain"></video>`;
    }

    mediaContainer.innerHTML = `
        <div class="relative">
            ${content}
            <button class="absolute top-4 right-4 text-white text-2xl" onclick="this.closest('.fixed').remove()">&times;</button>
        </div>
    `;

    document.body.appendChild(mediaContainer);
}

function displayChatInfo(chat) {
    currentChatInfo = chat;
    elements.chatName.textContent = chat.name;
    elements.mobileChatName.textContent = chat.name;
    
    if (chat.chatType === 'grupo') {
        elements.chatType.textContent = 'Grupo';
    } else {
        const lastSeen = lastSeenCache[chat.id];
        elements.chatType.textContent = lastSeen ? `Visto por último: ${new Date(lastSeen).toLocaleString()}` : 'Chat Individual';
    }

    const imageUrl = profileImageCache[chat.id] || 'https://cdn-icons-png.flaticon.com/512/4792/4792929.png';
    elements.chatAvatar.src = imageUrl;
    elements.mobileChatAvatar.src = imageUrl;
}

function sendTypingStatus(status) {
    socket.emit('typing status', {
        instanceKey: currentInstanceKey,
        chatId: currentChatId,
        status: status
    });
}

async function fetchProfileImage(instanceKey, chatId) {
    if (profileImageCache[chatId]) {
        updateProfileImage(chatId, profileImageCache[chatId]);
        return;
    }

    try {
        const response = await fetch('/chat/profile-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ instanceKey, chatId }),
        });

        if (response.ok) {
            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            profileImageCache[chatId] = imageUrl;
            updateProfileImage(chatId, imageUrl);
        } else {
            console.error('Falha ao obter imagem de perfil');
        }
    } catch (error) {
        console.error('Erro ao buscar imagem de perfil:', error);
    }
}

function updateProfileImage(chatId, imageUrl) {
    if (!imageUrl) return;

    if (currentChatId === chatId) {
        elements.chatAvatar.src = imageUrl;
        elements.mobileChatAvatar.src = imageUrl;
    }

    const chatItems = document.querySelectorAll(`.chat-item[data-chat-id="${chatId}"] img`);
    chatItems.forEach(item => {
        item.src = imageUrl;
    });

    const chatIndex = chats.findIndex(chat => chat.id === chatId);
    if (chatIndex !== -1) {
        chats[chatIndex].image = imageUrl;
    }

    renderChats(chats);
}

function addChatListeners() {
    document.querySelectorAll('.chat-item').forEach(item => {
        item.addEventListener('click', async(event) => {
            if (!event.target.closest('.delete-chat-btn')) {
                currentChatId = item.dataset.chatId;
                const chatType = item.dataset.chatType;
                const chat = chats.find(c => c.id === currentChatId);
                displayChatInfo(chat);
                loadMessages(currentInstanceKey, currentChatId);
                if (window.innerWidth < 768) {
                    elements.mobileChats.classList.add('hidden');
                    elements.mobileMessages.classList.remove('hidden');
                }
                await markChatAsRead(currentChatId);
                item.classList.remove('bg-primary-100');
                item.querySelector('.bg-primary-500')?.remove();
            }
        });
        const deleteBtn = item.querySelector('.delete-chat-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                const chatId = event.currentTarget.dataset.chatId;
                deleteChat(chatId);
            });
        }
    });
}

function showGroupMembers() {
    if (currentChatInfo && currentChatInfo.chatType === 'grupo') {
        const membersList = document.getElementById('groupMembersList');
        membersList.innerHTML = currentChatInfo.participants.map(participant =>
            `<li class="mb-2">${participant.name || participant.id}</li>`
        ).join('');
        document.getElementById('groupMembersModal').style.display = 'block';
    }
}

async function updateChats() {
    const response = await fetch(`/chat/chats/${currentInstanceKey}`);
    const newChats = await response.json();
    await loadAllProfileImages(currentInstanceKey, newChats);

    newChats.forEach(newChat => {
        const oldChat = chats.find(chat => chat.id === newChat.id);
        if (!oldChat || newChat.lastMessageTimestamp > oldChat.lastMessageTimestamp) {
            showNotification(newChat);
        }
    });

    chats = newChats.sort((a, b) => b.lastMessageTimestamp - a.lastMessageTimestamp);
    renderChats(chats);
}

function createNewChat(chat) {
    const chatHTML = createChatHTML(chat);
    elements.chatList.insertAdjacentHTML('afterbegin', chatHTML);
    elements.mobileChatList.insertAdjacentHTML('afterbegin', chatHTML);
    addChatListeners();
    loadAllProfileImages(currentInstanceKey, [chat]);
}

async function loadAllProfileImages(instanceKey, chats) {
    const imagePromises = chats.map(chat => fetchProfileImage(instanceKey, chat.id));
    await Promise.all(imagePromises);
    renderChats(chats);
}

async function fetchProfileImage(instanceKey, chatId) {
    if (profileImageCache[chatId]) {
        updateProfileImage(chatId, profileImageCache[chatId]);
        return;
    }

    try {
        const response = await fetch('/chat/profile-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ instanceKey, chatId }),
        });

        if (response.ok) {
            const blob = await response.blob();
            const imageUrl = URL.createObjectURL(blob);
            profileImageCache[chatId] = imageUrl;
            updateProfileImage(chatId, imageUrl);
        } else {
            console.error('Falha ao obter imagem de perfil');
        }
    } catch (error) {
        console.error('Erro ao buscar imagem de perfil:', error);
    }
}

function updateProfileImage(chatId, imageUrl) {
    if (!imageUrl) return;

    // Atualizar a imagem no chat aberto
    if (currentChatId === chatId) {
        elements.chatAvatar.src = imageUrl;
        elements.mobileChatAvatar.src = imageUrl;
    }

    // Atualizar a imagem na lista de chats
    const chatItems = document.querySelectorAll(`.chat-item[data-chat-id="${chatId}"] img`);
    chatItems.forEach(item => {
        item.src = imageUrl;
    });

    // Atualizar o cache de chats
    const chatIndex = chats.findIndex(chat => chat.id === chatId);
    if (chatIndex !== -1) {
        chats[chatIndex].image = imageUrl;
    }
}

function showNotification(data) {
    if (data.message.fromMe === true) return;
    
    if (elements.receiveSoundToggle.checked) {
        elements.notificationSound.play().catch(error => console.error('Erro ao tocar som:', error));
    }

    const lastMessageContent = getMediaDescription(data.message.type, data.message.content);
    const chatId = data.chatId || data.message.key.remoteJid;
    const senderImage = profileImageCache[chatId] || 'https://cdn-icons-png.flaticon.com/512/4792/4792929.png';

    const notification = document.createElement('div');
    notification.className = 'fixed top-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 max-w-sm w-full transition-all duration-300 ease-in-out transform translate-y-0 border-l-4 border-indigo-500';
    notification.innerHTML = `
        <div class="flex items-start">
            <img src="${senderImage}" 
                 alt="${data.message.sender}" 
                 class="w-12 h-12 rounded-full mr-3 object-cover border-2 border-indigo-200">
            <div class="flex-grow min-w-0">
                <h4 class="font-semibold text-gray-900 dark:text-gray-100 truncate">${data.message.sender}</h4>
                <p class="text-sm text-gray-600 dark:text-gray-300 truncate">${lastMessageContent}</p>
            </div>
            <button class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors duration-200 ml-2">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
    `;
    document.body.appendChild(notification);

    notification.querySelector('button').addEventListener('click', () => {
        notification.remove();
    });

    setTimeout(() => {
        notification.style.transform = 'translate(0, 10px)';
    }, 100);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transform = 'translate(0, -10px)';
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 5000);
}

async function sendMessage(content) {
    if (!currentInstanceKey || !currentChatId || !content.trim()) {
        console.error('Missing required information to send message');
        return;
    }

    try {
        const response = await fetch('/chat/send-message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                instanceKey: currentInstanceKey,
                chatId: currentChatId,
                content: content.trim()
            }),
        });

        if (response.ok) {
            console.log('Message sent successfully');
            const messageData = await response.json();

            if (elements.sendSoundToggle.checked) {
                elements.sendSound.play();
            }

            showPopup('Mensagem enviada');

            elements.messageInput.value = '';
            elements.mobileMessageInput.value = '';

            updateChatInList(currentChatId, {
                type: 'text',
                content: content.trim(),
                timestamp: Date.now() / 1000
            });

            moveChatToTop(currentChatId);

            appendMessage({
                fromMe: true,
                sender: 'You',
                content: content.trim(),
                timestamp: Date.now() / 1000,
                type: 'text'
            });

        } else {
            console.error('Error sending message');
            showPopup('Erro ao enviar mensagem', 'error');
        }
    } catch (error) {
        console.error('Error sending message:', error);
        showPopup('Erro ao enviar mensagem', 'error');
    }
}

function filterChats(query) {
    const filteredChats = chats.filter(chat =>
        chat.name.toLowerCase().includes(query.toLowerCase()) ||
        chat.lastMessage.toLowerCase().includes(query.toLowerCase())
    );
    renderChats(filteredChats);
}

function deleteChat(chatId) {
    if (confirm('Tem certeza que deseja deletar este chat?')) {
        fetch(`/chat/delete/${currentInstanceKey}/${chatId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const chatElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
                if (chatElement) {
                    chatElement.remove();
                }
                chats = chats.filter(chat => chat.id !== chatId);
                showPopup('Chat deletado com sucesso', 'success');
            } else {
                showPopup('Erro ao deletar chat', 'error');
            }
        })
        .catch(error => {
            console.error('Erro ao deletar chat:', error);
            showPopup('Erro ao deletar chat', 'error');
        });
    }
}

function updateChatInList(chatId, lastMessage) {
    const chatElement = document.querySelector(`.chat-item[data-chat-id="${chatId}"]`);
    if (chatElement) {
        const lastMessageElement = chatElement.querySelector('.text-sm.text-gray-600');
        lastMessageElement.textContent = getMediaDescription(lastMessage.type, lastMessage.content);

        const timestampElement = chatElement.querySelector('.text-xs.text-gray-500');
        const formattedTime = moment(lastMessage.timestamp * 1000).format('HH:mm');
        timestampElement.textContent = formattedTime;

        const chat = chats.find(c => c.id === chatId);
        if (chat) {
            chat.lastMessage = lastMessage.content;
            chat.lastMessageTimestamp = lastMessage.timestamp;
            chat.lastMessageType = lastMessage.type;
            chat.lastMessageFromMe = lastMessage.fromMe;
            
            if (chatId !== currentChatId) {
                chat.unreadCount = (chat.unreadCount || 0) + 1;
                const unreadIndicator = chatElement.querySelector('.bg-primary-500') || document.createElement('span');
                unreadIndicator.className = 'bg-primary-500 text-white text-xs font-bold px-2 py-1 rounded-full';
                unreadIndicator.textContent = chat.unreadCount;
                chatElement.querySelector('.flex-grow').appendChild(unreadIndicator);
            }
        }
        moveChatToTop(chatId);
    } else {
        socket.emit('request chat info', chatId);
    }
}

function loadUserInfo() {
    fetch('/whatsapp/list')
        .then(response => response.json())
        .then(instances => {
            if (instances.length > 0) {
                const instance = instances[0];
                document.getElementById('profileName').textContent = instance.whatsappName || 'Nome não disponível';
                document.getElementById('instanceName').textContent = instance.name || 'instancia não disponível';
                if (instance.foto) {
                    document.getElementById('profileImage').src = instance.foto;
                }
            }
        })
        .catch(error => {
            console.error('Erro ao carregar informações do usuário:', error);
        });
}

function updateProfileInMenu(instance) {
    const profileImage = document.getElementById('profileImage');
    const profileName = document.getElementById('profileName');
    const instanceName = document.getElementById('instanceName');

    if (instance.foto) {
        profileImage.src = instance.foto;
    }
    if (instance.whatsappName) {
        profileName.textContent = instance.whatsappName;
    }
    if (instance.name) {
        instanceName.textContent = instance.name;
    }

    console.log('Atualizando menu com:', instance);
}

function loadCurrentInstanceProfile() {
    fetch(`/whatsapp/instance/${currentInstanceKey}`)
        .then(response => response.json())
        .then(instanceData => {
            updateProfileInMenu(instanceData);
        })
        .catch(error => console.error('Erro ao carregar perfil da instância:', error));
}

// Event Listeners
elements.voiceButton.addEventListener('click', () => {
    elements.voiceModal.classList.add('modal-open');
    loadVoices();
});

elements.closeVoiceModal.addEventListener('click', () => {
    elements.voiceModal.classList.remove('modal-open');
    resetVoiceModal();
});

elements.generateVoiceButton.addEventListener('click', generateVoice);

elements.sendVoiceButton.addEventListener('click', sendVoice);

elements.confirmInstance.addEventListener('click', () => {
    if (currentInstanceKey) {
        elements.instanceModal.classList.remove('modal-open');
        elements.chatContainer.classList.remove('hidden');
        loadUserFunnels();
    } else {
        alert('Por favor, selecione uma instância antes de continuar.');
    }
});

[elements.sendButton, elements.mobileSendButton].forEach(button => {
    button.addEventListener('click', () => {
        const input = button.id === 'sendButton' ? elements.messageInput : elements.mobileMessageInput;
        sendMessage(input.value);
    });
});

[elements.messageInput, elements.mobileMessageInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage(input.value);
        }
    });
});

elements.backButton.addEventListener('click', () => {
    elements.mobileMessages.classList.add('hidden');
    elements.mobileChats.classList.remove('hidden');
});

[elements.refreshButton, elements.mobileRefreshButton].forEach(button => {
    button.addEventListener('click', () => {
        updateChats();
    });
});

[elements.searchChat, elements.mobileSearchChat].forEach(input => {
    input.addEventListener('input', (e) => {
        filterChats(e.target.value);
    });
});

elements.wallpaperInput.addEventListener('change', function (event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function (e) {
            document.documentElement.style.setProperty('--chat-background', `url(${e.target.result})`);
            localStorage.setItem('chatWallpaper', e.target.result);
        };
        reader.readAsDataURL(file);
    }
});

elements.sendSoundToggle.addEventListener('change', () => {
    localStorage.setItem('sendSound', elements.sendSoundToggle.checked);
});

elements.receiveSoundToggle.addEventListener('change', () => {
    localStorage.setItem('receiveSound', elements.receiveSoundToggle.checked);
});

document.addEventListener('DOMContentLoaded', () => {
    const openFunnelReportBtn = document.getElementById('openFunnelReport');
    if (openFunnelReportBtn) {
        openFunnelReportBtn.addEventListener('click', openFunnelReportPopup);
    }
});

// Socket event listeners
socket.on('connect', () => {
    console.log('Conectado ao servidor Socket.IO');
});

socket.on('status', (data) => {
    if (data.chatId === currentChatId) {
        showStatusAnimation(data.status, data.duration);
    }
});

socket.on('new message', (data) => {
    console.log('Nova mensagem recebida:', data);

    if (data.chatId === currentChatId) {
        appendMessage(data.message);
        scrollToBottom();
    }
    updateChatInList(data.chatId, data.message);
    moveChatToTop(data.chatId);
    if (!data.message.fromMe) {
        showNotification(data);
    } else {
        resetUnreadCount(data.chatId);
    }
});

socket.on('new chat', (chat) => {
    console.log('Novo chat recebido:', chat);
    createNewChat(chat);
    chats.unshift(chat);
});

socket.on('chat messages', (data) => {
    if (data.chatId === currentChatId) {
        renderMessages(data.messages);
    }
});

socket.on('chat info', (chat) => {
    addChatToList(chat);
});

socket.on('initial chats', (initialChats) => {
    chats = initialChats;
    renderChats(chats);
    loadAllProfileImages(currentInstanceKey, chats);
});

socket.on('presence update', (data) => {
    updatePresence(data.chatId, data.presence, data.timestamp);
});

socket.on('chat update', (data) => {
    updateLastSeen(data.chatId, data.timestamp);
});

// Initialization
loadInstances();
loadUserInfo();

if (localStorage.getItem('sendSound') === 'false') {
    elements.sendSoundToggle.checked = false;
}
if (localStorage.getItem('receiveSound') === 'false') {
    elements.receiveSoundToggle.checked = false;
}
const savedWallpaper = localStorage.getItem('chatWallpaper');
if (savedWallpaper) {
    document.documentElement.style.setProperty('--chat-background', `url(${savedWallpaper})`);
}

checkActiveFunnels();