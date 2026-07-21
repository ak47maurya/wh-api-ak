const { WhatsAppInstance } = require('../class/instance');
const fs = require('fs').promises;
const path = require('path');
const config = require('../../config/config');
const { Session } = require('../class/session');
const { deleteLogsByInstance } = require('../helper/messageLogger');
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

exports.init = async (req, res) => {
    let webhook = req.body.webhook || false;
    let webhookUrl = req.body.webhookUrl || false;
    let browser = req.body.browser || 'My API';
    let ignoreGroups = req.body.ignoreGroups || false;
    let webhookEvents = req.body.webhookEvents || [];
    let messagesRead = req.body.messagesRead || false;
    let base64 = req.body.base64 || false;
    let incoming = req.body.incoming || false;
    let chatbot = req.body.chatbot || false;

    const key = req.body.key;
    const filePath = path.join('db/sessions.json');

    const data = await fs.readFile(filePath, 'utf-8');
const sessions = JSON.parse(data);
const sessionCount = sessions.length;

if (process.env.MAX_INSTANCES) {
  const maxInstances = parseInt(process.env.MAX_INSTANCES, 10);
  if (maxInstances <= sessionCount) {
    return res.json({
      error: true,
      message: 'Session limit has been reached'
    });
  }
}
    const valida = sessions.find(session => session.key === key);

    const appUrl = config.appUrl || req.protocol + '://' + req.headers.host;

    if (valida) {
        const existing = WhatsAppInstances[key];
        if (existing && existing.instance && existing.instance.online) {
            return res.json({
                error: true,
                message: 'Session already started.'
            });
        }
        // re-init for offline/disconnected instance
        if (existing && existing.instance) {
            existing.instance.online = false;
            existing.instance.sock = null;
            existing.instance.qr = null;
            delete existing.instance._manualDisconnect;
            const data = await existing.instance.init();
            return res.json({
                error: false,
                message: 'Instance re-initialized',
                key: data.key,
            });
        }
        // session exists but instance not in memory — create fresh
        const sessionData = valida;
        const instance = new WhatsAppInstance(key, sessionData.webhook, sessionData.webhookUrl);
        const data = await instance.init();
        WhatsAppInstances[data.key] = instance;
        return res.json({
            error: false,
            message: 'Instance started',
            key: data.key,
        });
    } else {
        const filePath = path.join('db/sessions.json');
        const dataSession = await fs.readFile(filePath, 'utf-8');
        const sessions = JSON.parse(dataSession);

        sessions.push({ key, ignoreGroups, webhook, base64, incoming, chatbot, webhookUrl, browser, webhookEvents, messagesRead });

        await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');

        const instance = new WhatsAppInstance(key, webhook, webhookUrl);
        const data = await instance.init();
        WhatsAppInstances[data.key] = instance;
        res.json({
            error: false,
            message: 'Instance started',
            key: data.key,
            webhook: {
                enabled: webhook,
                webhookUrl: webhookUrl,
                webhookEvents: webhookEvents
            },
            qrcode: {
                url: appUrl + '/instance/qr?key=' + data.key,
            },
            browser: browser,
            messagesRead: messagesRead,
            ignoreGroups: ignoreGroups,
        });
    }
};

exports.editar = async (req, res) => {
    let webhook = req.body.webhook || false;
    let webhookUrl = req.body.webhookUrl || false;
    let browser = req.body.browser || 'My API';
    let ignoreGroups = req.body.ignoreGroups || false;
    let webhookEvents = req.body.webhookEvents || [];
    let messagesRead = req.body.messagesRead || false;
    let base64 = req.body.base64 || false;
    let incoming = req.body.incoming || false;
    let chatbot = req.body.chatbot || false;

    const key = req.body.key;
    const filePath = path.join('db/sessions.json');
    const data = await fs.readFile(filePath, 'utf-8');
    const sessions = JSON.parse(data);
    const index = sessions.findIndex(session => session.key === key);

    if (index !== -1) {
        sessions[index] = { key, ignoreGroups, webhook, base64, incoming, chatbot, webhookUrl, browser, webhookEvents, messagesRead };
        await fs.writeFile(filePath, JSON.stringify(sessions, null, 2), 'utf-8');

        const instance = WhatsAppInstances[key];
        const data = await instance.init();
        res.json({
            error: false,
            message: 'Instance updated',
            key: key,
            webhook: {
                enabled: webhook,
                webhookUrl: webhookUrl,
                webhookEvents: webhookEvents
            },
            browser: browser,
            messagesRead: messagesRead,
            ignoreGroups: ignoreGroups,
        });
    } else {
        return res.json({
            error: true,
            message: 'Session not found.',
        });
    }
};

exports.getcode = async (req, res) => {
    try {
        if (!req.body.number) {
            return res.json({
                error: true,
                message: 'Invalid phone number'
            });
        } else {
            const instance = WhatsAppInstances[req.query.key];
            const data = await instance.getInstanceDetail(req.query.key);

            if (data.phone_connected === true) {
                return res.json({
                    error: true,
                    message: 'Phone already connected'
                });
            } else {
                const number = instance.getWhatsappCode(req.body.number);
                const code = await instance.instance?.sock?.requestPairingCode(number);
                return res.json({
                    error: false,
                    code: code
                });
            }
        }
    } catch (e) {
        return res.json({
            error: true,
            message: 'Instance not found'
        });
    }
};

exports.ativas = async (req, res) => {
    if (req.query.active) {
        let instance = Object.keys(WhatsAppInstances);
        return res.json({
            data: instance
        });
    }

    let instance = Object.keys(WhatsAppInstances).map(async (key) =>
        WhatsAppInstances[key].getInstanceDetail(key)
    );
    let data = await Promise.all(instance);

    return {
        data: data
    };
};

exports.qr = async (req, res) => {
    const verifica = await exports.validar(req, res);
    if (verifica == true) {
        const instance = WhatsAppInstances[req.query.key];
        let data;
        try {
            data = await instance.getInstanceDetail(req.query.key);
        } catch (error) {
            data = {};
        }
        if (data.phone_connected === true) {
            return res.json({
                error: true,
                message: 'Phone already connected'
            });
        } else {
            try {
                const qrcode = await WhatsAppInstances[req.query.key]?.instance.qr;
                res.render('qrcode', {
                    qrcode: qrcode,
                });
            } catch {
                res.json({
                    qrcode: '',
                });
            }
        }
    } else {
        return res.json({
            error: true,
            message: 'Instance does not exist'
        });
    }
};

exports.qrbase64 = async (req, res) => {
    const verifica = await exports.validar(req, res);
    if (verifica == true) {
        const instance = WhatsAppInstances[req.query.key];
        let data;
        try {
            data = await instance.getInstanceDetail(req.query.key);
        } catch (error) {
            data = {};
        }
        if (data.phone_connected === true) {
            return res.json({
                error: true,
                message: 'Phone already connected'
            });
        }
        // auto-init if QR is null and phone is disconnected
        let qrcode = WhatsAppInstances[req.query.key]?.instance.qr;
        if (!qrcode && instance && instance.instance) {
            instance.instance.qr = null;
            instance.instance.online = false;
            instance.instance.sock = null;
            delete instance.instance._manualDisconnect;
            try {
                await instance.init();
            } catch (_) {}
            // wait for QR to be generated
            for (let i = 0; i < 20; i++) {
                qrcode = WhatsAppInstances[req.query.key]?.instance.qr;
                if (qrcode) break;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        try {
            res.json({
                error: false,
                message: 'QR Base64 fetched successfully',
                qrcode: qrcode || '',
            });
        } catch {
            res.json({
                qrcode: '',
            });
        }
    } else {
        return res.json({
            error: true,
            message: 'Instance does not exist'
        });
    }
};

exports.validar = async (req, res) => {
    const verifica = await exports.ativas(req, res);
    const existe = verifica.data.some(item => item.instance_key === req.query.key);
    if (existe) {
        return true;
    } else {
        return false;
    }
};

exports.info = async (req, res) => {
    const verifica = await exports.validar(req, res);
    if (verifica == true) {
        const instance = WhatsAppInstances[req.query.key];
        let data;
        try {
            data = await instance.getInstanceDetail(req.query.key);
        } catch (error) {
            data = {};
        }
        return res.json({
            error: false,
            message: 'Instance fetched successfully',
            instance_data: data,
        });
    } else {
        return res.json({
            error: true,
            message: 'Instance does not exist'
        });
    }
};

exports.infoManager = async (key) => {
    try {
        const instance = WhatsAppInstances[key];
        const  data = await instance.getInstanceDetail(key);
		return data;
        } catch (error) {
            return {error:true, message:'Failed to find the instance, please try again'}
        }
       
  };


exports.restore = async (req, res, next) => {
    try {
        let instance = Object.keys(WhatsAppInstances).map(async (key) =>
            WhatsAppInstances[key].getInstanceDetail(key)
        );
        let data = await Promise.all(instance);

        if (data.length > 0) {
            return res.json({
                error: false,
                message: 'All instances restored',
                data: data,
            });
        } else {
            const session = new Session();
            let restoredSessions = await session.restoreSessions();

            return res.json({
                error: false,
                message: 'All instances restored',
                data: restoredSessions,
            });
        }
    } catch (error) {
        next(error);
    }
};

exports.logout = async (req, res) => {
  const instance = WhatsAppInstances[req.query.key];
    let errormsg;
    try {
        await WhatsAppInstances[req.query.key].instance?.sock?.logout();
        WhatsAppInstances[req.query.key].instance._manualDisconnect = true;
        WhatsAppInstances[req.query.key].instance.sock = null;
        WhatsAppInstances[req.query.key].instance.online = false;
        WhatsAppInstances[req.query.key].instance.qr = null;
    } catch (error) {
        errormsg = error;
    }
    return res.json({
        error: false,
        message: 'Logout successful',
        errormsg: errormsg ? errormsg : null,
    });
};

exports.delete = async (req, res) => {
    let errormsg;
    const key = req.query.key;
    const verifica = await exports.validar(req, res);
    if (verifica == true) {
        try {
            await WhatsAppInstances[key].deleteInstance(key);
            delete WhatsAppInstances[key];
        } catch (error) {
            errormsg = error;
        }
        deleteLogsByInstance(key);
        return res.json({
            error: false,
            message: 'Instance deleted successfully',
            data: errormsg ? errormsg : null,
        });
    } else {
        deleteLogsByInstance(key);
        return res.json({
            error: false,
            message: 'Instance deleted successfully',
            data: errormsg ? errormsg : null,
        });
    }
};

exports.list = async (req, res) => {
    let instance = Object.keys(WhatsAppInstances).map(async (key) =>
        WhatsAppInstances[key].getInstanceDetail(key)
    );
    let data = await Promise.all(instance);
    return res.json({
        error: false,
        message: 'All instances listed',
        data: data,
    });
};

exports.deleteInactives = async (req, res) => {
    let instance = Object.keys(WhatsAppInstances).map(async (key) =>
        WhatsAppInstances[key].getInstanceDetail(key)
    );
    let data = await Promise.all(instance);
    const deletePromises = [];
    for (const inst of data) {
        if (inst.phone_connected === undefined || inst.phone_connected === false) {
            const deletePromise = WhatsAppInstances[inst.instance_key].deleteInstance(inst.instance_key);
            delete WhatsAppInstances[inst.instance_key];
            deleteLogsByInstance(inst.instance_key);
            deletePromises.push(deletePromise);
        }
        await sleep(150);
    }
    await Promise.all(deletePromises);
    return res.json({
        error: false,
        message: 'All inactive sessions deleted',
    });
};

exports.deleteAll = async (req, res) => {
    let instance = Object.keys(WhatsAppInstances).map(async (key) =>
        WhatsAppInstances[key].getInstanceDetail(key)
    );
    let data = await Promise.all(instance);
    const deletePromises = [];
    for (const inst of data) {
        const deletePromise = WhatsAppInstances[inst.instance_key].deleteInstance(inst.instance_key);
        delete WhatsAppInstances[inst.instance_key];
        deleteLogsByInstance(inst.instance_key);
        deletePromises.push(deletePromise);
        await sleep(150);
    }
    await Promise.all(deletePromises);
    return res.json({
        error: false,
        message: 'All sessions deleted',
    });
};
