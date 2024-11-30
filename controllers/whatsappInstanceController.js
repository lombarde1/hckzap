// controllers/whatsappInstanceController.js
const LimitsService = require('../services/limitsService');
const axios = require('axios');
const User = require('../models/User');

const API_BASE_URL = 'https://api.hocketzap.com';
const APIKEY = 'darkadm';

const PLAN_LIMITS = require('../config/planLimits');

// Função auxiliar para adicionar o apikey ao cabeçalho
const addApiKeyToHeaders = (headers = {}) => {
    return { ...headers, 'apikey': APIKEY };
};


exports.deleteAllInstances = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        


        await User.collection.dropIndex('whatsappInstances.key_1');

        // 2. Limpar instâncias com chaves nulas
        await User.updateMany(
            { 'whatsappInstances.key': null },
            { $pull: { whatsappInstances: { key: null } } }
        );

        // 3. Recriar o índice
        await User.collection.createIndex({ 'whatsappInstances.key': 1 }, { unique: true, sparse: true });


        const deletionResults = [];

        for (const instance of user.whatsappInstances) {
            if (instance.name) {
                let deletionResult = { name: instance.name, success: false };

                // Primeiro, tenta desconectar
                const disconnected = await disconnectInstance(instance.name);
                
                // Se desconectou com sucesso ou se a desconexão falhou, tenta deletar
                if (disconnected || true) {
                    const deleteResult = await deleteInstance(instance.name);
                    deletionResult = { ...deletionResult, ...deleteResult };
                } else {
                    deletionResult.error = "Falha ao desconectar a instância";
                }

                deletionResults.push(deletionResult);
            }
        }

        // Remover todas as instâncias do usuário no banco de dados
       
        user.whatsappInstances = [];
        await user.save();

        res.json({ 
            message: 'Operação de deleção concluída', 
            results: deletionResults,
            databaseUpdated: true,
            remainingInstances: user.whatsappInstances.length
        });

    } catch (error) {
        console.error('Erro ao deletar todas as instâncias:', error);
        res.status(500).json({ error: 'Erro ao deletar todas as instâncias', details: error.message });
    }
};


exports.getInstanceDetails = async (req, res) => {
    try {
        const { instanceKey } = req.params;
        const user = await User.findById(req.user.id);
        const instance = user.whatsappInstances.find(i => i.key === instanceKey);

        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada' });
        }

        const response = await axios.get(`${API_BASE_URL}/instance/fetchInstances`, {
            headers: {
                'apikey': APIKEY
            }
        });

        const instanceDetails = response.data.find(i => i.token === instanceKey);

        if (instanceDetails) {
            res.json({
                name: instanceDetails.name,
                whatsappName: instanceDetails.profileName,
                foto: instanceDetails.profilePicUrl,
                number: instanceDetails.number
            });
        } else {
            res.status(404).json({ error: 'Detalhes da instância não encontrados' });
        }
    } catch (error) {
        console.error('Erro ao obter detalhes da instância:', error);
        res.status(500).json({ error: 'Erro ao obter detalhes da instância' });
    }
};

exports.createInstance = async (req, res) => {
    try {
        const { name, phoneNumber, token } = req.body;
        const user = await User.findById(req.user.id);

        // Verificar limite de instâncias baseado no plano
        const userPlan = user.plan || 'gratuito';
        const planLimit = PLAN_LIMITS[userPlan].whatsappConnections;
        const instanceCount = user.whatsappInstances.length;

      /*/  if (instanceCount >= planLimit) {
            return res.status(403).json({
                error: 'Limite de instâncias atingido para o seu plano.',
                currentPlan: userPlan,
                limit: planLimit,
                currentCount: instanceCount
            });
        }/*/

         // Nova verificação de limites usando LimitsService
        // Nova verificação de limites usando LimitsService
        const limitCheck = await LimitsService.checkInstanceLimit(req.user.id);
        
        if (!limitCheck.allowed) {
            return res.status(403).json({
                error: 'Limite de instâncias excedido',
                plan: user.plan,
                currentCount: limitCheck.currentCount,
                limit: limitCheck.limit,
                remaining: limitCheck.remaining
            });
        }




        // Modificação principal: ajuste do payload conforme documentação
        let data = {
            instanceName: name,
            integration: "WHATSAPP-BAILEYS",
            qrcode: true,  // Adicionado conforme documentação
            number: phoneNumber ? phoneNumber.replace(/\D/g, '') : undefined // Remove caracteres não numéricos
        };

        // Só inclui o token se ele for fornecido
        if (token) {
            data.token = token;
        }

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: `${API_BASE_URL}/instance/create`,
            headers: {
                'Content-Type': 'application/json',
                'apikey': APIKEY
            },
            data: data
        };

        const response = await axios.request(config);

        if (response.data && response.data.hash) {
            // Converter datas antes de salvar
       /*/     user.validUntil = user.validUntil ? new Date(user.validUntil) : null;
            user.manualPlanValidUntil = user.manualPlanValidUntil ? new Date(user.manualPlanValidUntil) : null;
            user.notifications = user.notifications.map(notification => ({
                ...notification,
                timestamp: new Date(notification.timestamp)
            }));/*/

        

          /*/  user.whatsappInstances = user.whatsappInstances.map(instance => ({
                ...instance,
                createdAt: new Date(instance.createdAt)
            }));
            user.funnels = user.funnels.map(funnel => ({
                ...funnel,
                createdAt: new Date(funnel.createdAt)
            }));/*/

            user.whatsappInstances.push({
                name,
                key: response.data.hash,
                user: req.user.id,
                number: phoneNumber,
                createdAt: new Date()
            });

            await user.save();

            // Configurações do webhook após criação bem-sucedida
            const webhookData = {
                webhook: {
                    enabled: true,
                    url: "https://dev.hocketzap.com/webhook/evolution",
                    events: [
                        "APPLICATION_STARTUP", "CALL", "CHATS_DELETE", "CHATS_SET", "CHATS_UPDATE",
                        "CHATS_UPSERT", "CONNECTION_UPDATE", "CONTACTS_SET", "CONTACTS_UPDATE",
                        "CONTACTS_UPSERT", "GROUP_PARTICIPANTS_UPDATE", "GROUP_UPDATE", "GROUPS_UPSERT",
                        "LABELS_ASSOCIATION", "LABELS_EDIT", "LOGOUT_INSTANCE", "MESSAGES_DELETE",
                        "MESSAGES_SET", "MESSAGES_UPDATE", "MESSAGES_UPSERT", "PRESENCE_UPDATE",
                        "QRCODE_UPDATED", "REMOVE_INSTANCE", "SEND_MESSAGE", "TYPEBOT_CHANGE_STATUS",
                        "TYPEBOT_START"
                    ],
                    base64: true,
                    byEvents: false
                }
            };

            await axios.post(`${API_BASE_URL}/webhook/set/${name}`, webhookData, {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': APIKEY
                }
            });

            // Configurações adicionais da instância
            await axios.post(`${API_BASE_URL}/settings/set/${name}`, {
                rejectCall: false,
                msgCall: "",
                groupsIgnore: false,
                alwaysOnline: true,
                readMessages: false,
                syncFullHistory: false,
                readStatus: false
            }, {
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': APIKEY
                }
            });

        

            // Retornar resposta com informações de limite atualizadas
            const updatedLimits = await LimitsService.checkInstanceLimit(req.user.id);
            
            res.status(201).json({
                message: 'Instância criada com sucesso',
                instance: { 
                    name, 
                    key: response.data.hash, 
                    number: phoneNumber 
                },
                limits: {
                    currentCount: updatedLimits.currentCount,
                    limit: updatedLimits.limit,
                    remaining: updatedLimits.remaining
                }
            });

        } else {
            res.status(400).json({ error: 'Falha ao criar instância', details: response.data });
        }
    } catch (error) {
        console.log('Erro completo:', error);
        console.error('Erro ao criar instância:', error.response ? error.response.data : error.message);

        if (error.response && error.response.status === 403) {
            const errorMessage = error.response.data.response && error.response.data.response.message
                ? error.response.data.response.message[0]
                : 'Acesso negado';

            res.status(403).json({
                error: 'O nome já está em uso',
                message: errorMessage
            });
        } else {
            res.status(500).json({
                error: 'Erro interno do servidor',
                message: 'Ocorreu um erro ao criar a instância. Por favor, tente novamente.'
            });
        }
    }
};

exports.enforcePlanLimits = async (req, res) => {
    try {
        const result = await LimitsService.enforceInstanceLimits(req.user.id);
        res.json(result);
    } catch (error) {
        console.error('Erro ao ajustar limites do plano:', error);
        res.status(500).json({ 
            error: 'Erro ao ajustar limites do plano',
            message: error.message 
        });
    }
};

function getUsageStatus(currentUsage, limit) {
    if (limit === Infinity || limit === -1) return 'normal';
    const percentage = (currentUsage / limit) * 100;
    if (percentage >= 100) return 'exceeded';
    if (percentage >= 90) return 'critical';
    if (percentage >= 70) return 'warning';
    return 'normal';
}


exports.getInstanceLimits = async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = await LimitsService.getEffectiveLimit(userId, 'whatsappConnections');
        const currentUsage = await LimitsService.getCurrentUsage(userId, 'whatsappConnections');
        const nextReset = await LimitsService.getNextResetTime();

        const response = {
            currentUsage,
            limit: limit === Infinity ? 'Ilimitado' : limit,
            remaining: limit === Infinity ? 'Ilimitado' : Math.max(0, limit - currentUsage),
            nextReset,
            usage: {
                percentage: limit === Infinity ? 0 : (currentUsage / limit) * 100,
                status: getUsageStatus(currentUsage, limit)
            }
        };

        res.json(response);
    } catch (error) {
        handleError(error, res);
    }
};

function handleError(error, res) {
    console.error('Erro:', error);
    if (error.response && error.response.status === 403) {
        res.status(403).json({
            error: 'O nome já está em uso',
            message: error.response.data.response?.message?.[0] || 'Acesso negado'
        });
    } else {
        res.status(500).json({
            error: 'Erro interno do servidor',
            message: error.message
        });
    }
}


// Função auxiliar para verificar se o usuário pode criar mais instâncias
exports.canCreateInstance = async (userId) => {
    try {
        const limitCheck = await LimitsService.checkLimit(userId, 'whatsappConnections', 1);
        return {
            allowed: limitCheck.allowed,
            currentUsage: limitCheck.currentUsage,
            limit: limitCheck.limit,
            remaining: limitCheck.remaining
        };
    } catch (error) {
        console.error('Erro ao verificar limite de instâncias:', error);
        throw error;
    }
};


exports.listInstances = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        // Chamar a API Evolution para buscar as instâncias
        const response = await axios.get(`${API_BASE_URL}/instance/fetchInstances`, {
            headers: {
                'apikey': APIKEY
            }
        });

        // Criar um conjunto de tokens das instâncias retornadas pela API
        const apiTokens = new Set(response.data.map(instance => instance.token));

        // Filtrar as instâncias do usuário que não estão presentes na resposta da API
        const instancesToRemove = user.whatsappInstances.filter(instance => !apiTokens.has(instance.key));

        // Remover as instâncias não presentes na API do documento do usuário
        if (instancesToRemove.length > 0) {
            console.log("Apagando instancia sem uso!")
            user.whatsappInstances = user.whatsappInstances.filter(instance => apiTokens.has(instance.key));
            await user.save();
        }

        // Mapear as instâncias retornadas pela API para o formato esperado pelo frontend
        const instancesWithStatus = response.data
            .filter(apiInstance => user.whatsappInstances.some(i => i.key === apiInstance.token))
            .map(apiInstance => {
                const userInstance = user.whatsappInstances.find(i => i.key === apiInstance.token);
               // console.log(apiInstance)
                return {
                    _id: userInstance._id, // Mantém o ID do MongoDB
                    name: apiInstance.name,
                    key: apiInstance.token,
                    isConnected: apiInstance.connectionStatus === 'open',
                    whatsappName: apiInstance.profileName || '',
                    foto: apiInstance.profilePicUrl || 'https://pluspng.com/img-png/user-png-icon-download-icons-logos-emojis-users-2240.png',
                    number: apiInstance.number || '',
                    createdAt: new Date(apiInstance.createdAt),
                    updatedAt: new Date(apiInstance.updatedAt),
                    messageCount: apiInstance._count.Message,
                    contactCount: apiInstance._count.Contact,
                    chatCount: apiInstance._count.Chat
                };
            });

            res.json(instancesWithStatus);

    //    res.json({
       //     instances: instancesWithStatus,
         //   removedInstances: instancesToRemove.length
     //   });
    } catch (error) {
        console.error('Erro ao listar instâncias:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};

exports.listInstancesUser = async (req, res) => {
    try {
        const user = await User.findById(req.query.id);
        
        // Chamar a API Evolution para buscar as instâncias
        const response = await axios.get(`${API_BASE_URL}/instance/fetchInstances`, {
            headers: {
                'apikey': APIKEY
            }
        });

        // Criar um conjunto de tokens das instâncias retornadas pela API
        const apiTokens = new Set(response.data.map(instance => instance.token));

        // Filtrar as instâncias do usuário que não estão presentes na resposta da API
        const instancesToRemove = user.whatsappInstances.filter(instance => !apiTokens.has(instance.key));

        // Remover as instâncias não presentes na API do documento do usuário
        if (instancesToRemove.length > 0) {
            console.log("Apagando instancia sem uso!")
            user.whatsappInstances = user.whatsappInstances.filter(instance => apiTokens.has(instance.key));
            await user.save();
        }

        // Mapear as instâncias retornadas pela API para o formato esperado pelo frontend
        const instancesWithStatus = response.data
            .filter(apiInstance => user.whatsappInstances.some(i => i.key === apiInstance.token))
            .map(apiInstance => {
                const userInstance = user.whatsappInstances.find(i => i.key === apiInstance.token);
                console.log(apiInstance)
                return {
                    _id: userInstance._id, // Mantém o ID do MongoDB
                    name: apiInstance.name,
                    key: apiInstance.token,
                    isConnected: apiInstance.connectionStatus === 'open',
                    whatsappName: apiInstance.profileName || '',
                    foto: apiInstance.profilePicUrl || 'https://pluspng.com/img-png/user-png-icon-download-icons-logos-emojis-users-2240.png',
                    number: apiInstance.number || '',
                    createdAt: new Date(apiInstance.createdAt),
                    updatedAt: new Date(apiInstance.updatedAt),
                    messageCount: apiInstance._count.Message,
                    contactCount: apiInstance._count.Contact,
                    chatCount: apiInstance._count.Chat
                };
            });

            res.json(instancesWithStatus);

    //    res.json({
       //     instances: instancesWithStatus,
         //   removedInstances: instancesToRemove.length
     //   });
    } catch (error) {
        console.error('Erro ao listar instâncias:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
};


exports.getQRCode = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const user = await User.findById(req.user.id);
        const instance = user.whatsappInstances.id(instanceId);

        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada' });
        }

        let config = {
            method: 'get',
            maxBodyLength: Infinity,
            url: `${API_BASE_URL}/instance/connect/${instance.name}`,
            headers: { 
                'apikey': APIKEY
            }
        };

        const response = await axios.request(config);

        if (response.data && response.data.base64) {
            res.json({ 
                pairingCode: response.data.pairingCode,
                code: response.data.code,
                qr: response.data.base64,
                count: response.data.count
            });
        } else {
            res.status(400).json({ error: 'QR Code não disponível' });
        }
    } catch (error) {
        console.error('Erro ao obter QR Code:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: 'Erro ao obter QR Code', details: error.response ? error.response.data : error.message });
    }
};
exports.disconnectInstance = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const user = await User.findById(req.user.id);
        const instance = user.whatsappInstances.id(instanceId);

        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada' });
        }

        const response = await axios.delete(`${API_BASE_URL}/instance/logout/${instance.name}`, {
            headers: { 
                'apikey': APIKEY
            }
        });
        
        if (response.status === 200) {
            res.json({ message: 'Instância desconectada com sucesso' });
        } else {
            res.status(400).json({ error: 'Falha ao desconectar instância' });
        }
    } catch (error) {
        console.error('Erro ao desconectar instância:', error);
        res.status(500).json({ error: 'Erro ao desconectar instância' });
    }
};

const disconnectInstance = async (instanceName) => {
    try {
        await axios.delete(`${API_BASE_URL}/instance/logout/${instanceName}`, {
            headers: { 'apikey': APIKEY }
        });
        console.log(`Instância ${instanceName} desconectada com sucesso.`);
        return true;
    } catch (error) {
        console.error(`Erro ao desconectar instância ${instanceName}:`, error.response?.data || error.message);
        return false;
    }
};

const deleteInstance = async (instanceName) => {
    try {
        await axios.delete(`${API_BASE_URL}/instance/delete/${instanceName}`, {
            headers: { 'apikey': APIKEY }
        });
        console.log(`Instância ${instanceName} deletada com sucesso.`);
        return { success: true };
    } catch (error) {
        console.error(`Erro ao deletar instância ${instanceName}:`, error.response?.data || error.message);
        return { success: false, error: error.response?.data || error.message };
    }
};

exports.deleteInstance = async (req, res) => {
    const user = await User.findById(req.user.id);
    const { instanceId } = req.params;
       
    const instance = user.whatsappInstances.id(instanceId);

    try {
        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada' });
        }

        const response = await axios.delete(`${API_BASE_URL}/instance/delete/${instance.name}`, {
            headers: { 
                'apikey': APIKEY
            }
        });
        
        if (response.status === 200) {
            user.whatsappInstances.pull(instanceId);
            await user.save();
            
            res.json({ message: 'Instância deletada com sucesso' });
        } else {
            res.status(400).json({ error: 'Erro ao deletar instância' });
        }
    } catch (error) {
        console.error('Erro ao deletar instância:', error);
        user.whatsappInstances.pull(instanceId);
        await user.save();
        res.json({ message: 'Instância deletada com sucesso localmente, mas houve um erro na API' });
    }
};

exports.checkInstanceStatus = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const user = await User.findById(req.user.id);
        const instance = user.whatsappInstances.id(instanceId);

        if (!instance) {
            return res.status(404).json({ error: 'Instância não encontrada' });
        }

        const response = await axios.get(`${API_BASE_URL}/instance/connectionState/${instance.name}`, {
            headers: { 
                'apikey': APIKEY
            }
        });
        
        // Verificar se a resposta tem a estrutura esperada
        if (response.data && response.data.instance && response.data.instance.state) {
            const connectionState = response.data.instance.state;
            res.json({ 
                status: connectionState === 'open' ? 'connected' : 'disconnected',
                instanceName: response.data.instance.instanceName,
                state: connectionState
            });
        } else {
            // Log para debug
            console.log('Resposta inesperada da API:', response.data);
            res.status(400).json({ 
                error: 'Falha ao verificar status da instância',
                details: 'Formato de resposta inválido'
            });
        }
    } catch (error) {
        // Log detalhado do erro
        console.error('Erro completo:', error);
        console.error('Resposta da API:', error.response ? error.response.data : 'Sem resposta');
        
        res.status(500).json({ 
            error: 'Erro ao verificar status da instância',
            details: error.response ? error.response.data : error.message,
            instanceName: instance ? instance.name : 'unknown'
        });
    }
};

const cron = require('node-cron');


async function checkAndDeleteInactiveInstances() {
    try {
      const users = await User.find({});
  
      for (const user of users) {
        const activeInstances = [];
        let instancesChanged = false;
  
        for (const instance of user.whatsappInstances) {
          try {
            const response = await axios.get(`${API_BASE_URL}/instance/connectionState/${instance.name}`, {
                headers: { 
                    'apikey': APIKEY
                }
            });
            
  console.log(response.data.instance.state)



  if (response.data && response.data.instance.state === 'close') {
    try {
        await axios.delete(`${API_BASE_URL}/instance/delete/${instance.name}`, {
            headers: { 'apikey': APIKEY }
          });
        } catch (deleteError) {
            // Ignora erros de deleção
          }
          console.log(`Instância ${instance.name} removida (não está ativa ou não existe na API).`);
          instancesChanged = true;
   
  } else {
    activeInstances.push(instance);
  }
          } catch (error) {
            if (error.response && error.response.status === 404) {
              console.log(`Instância ${instance.name} não encontrada na API Evolution. Removendo do MongoDB.`);
              instancesChanged = true;
            } else {
              console.error(`Erro ao verificar instância ${instance.name}:`, error.message);
              activeInstances.push(instance);
            }
          }
        }
  
        if (instancesChanged) {
          user.whatsappInstances = activeInstances;
          try {
            await user.save();
            console.log(`Instâncias atualizadas para o usuário ${user._id}. Total de instâncias ativas: ${activeInstances.length}`);
          } catch (saveError) {
            if (saveError.name === 'ValidationError') {
              console.error(`Erro de validação ao salvar usuário ${user._id}:`, saveError.message);
              // Tente corrigir o número de telefone
              user.phone = user.phone.replace(/\D/g, '');
              try {
                await user.save();
                console.log(`Usuário ${user._id} salvo após correção do número de telefone.`);
              } catch (secondSaveError) {
                console.error(`Falha ao salvar usuário ${user._id} mesmo após correção:`, secondSaveError.message);
              }
            } else {
              console.error(`Erro ao salvar usuário ${user._id}:`, saveError.message);
            }
          }
        }
      }
    } catch (error) {
      console.error('Erro ao verificar e deletar instâncias inativas:', error);
    }
  }

// Agendar a execução a cada 10 segundos
async function deleteInactiveInstances() {
    try {
      const response = await axios.get(`${API_BASE_URL}/instance/fetchInstances`, {
        headers: { 'apikey': APIKEY }
      });
  
      const instances = response.data;
  
      const inactiveInstances = instances.filter(instance => 
        instance.connectionStatus === 'close' || instance.connectionStatus === 'connecting'
      );
  
      console.log(`Encontradas ${inactiveInstances.length} instâncias inativas.`);
  
      for (const instance of inactiveInstances) {
        let deleted = await deleteInstance(instance.name);
        
        if (!deleted) {
          console.log(`Tentando desconectar e deletar novamente a instância ${instance.name}`);
          await disconnectInstance(instance.name);
          deleted = await deleteInstance(instance.name);
          
          if (!deleted) {
            console.log(`Falha ao deletar instância ${instance.name} mesmo após desconexão.`);
          }
        }
      }
  
      console.log('Processo de deleção concluído.');
    } catch (error) {
      console.error('Erro ao buscar ou processar instâncias:', error.message);
    }
  }
  


 cron.schedule('*/30 * * * *', () => {
    console.log('Verificando instâncias inativas...');
    checkAndDeleteInactiveInstances();
  });