/**
 * WhatsApp Hard API - Google Apps Script Client
 * =============================================
 * Is API ko Google Apps Script (Sheets/Docs/Forms) se call karne ke liye.
 *
 * SETUP:
 *   1. CONFIG section mein API_URL, TOKEN, aur INSTANCE_KEY set karein
 *   2. Edit → Current project's triggers se time-based automation set karein
 *   3. Har function directly Google Sheets mein bhi use kar sakte hain:
 *      =SEND_TEXT("911234567890@s.whatsapp.net", "Hello from GAS!")
 */

// ============================================================
//  CONFIG - pehle yeh set karein
// ============================================================
var CONFIG = {
  API_URL: 'http://localhost:3333',    // aapka WhatsApp API server URL
  TOKEN: 'df938b1b13c21598b4f87e412ba49bd8225423bf27876c157b1fe771955f05e5',  // Bearer token
  ADMIN_TOKEN: 'ba96843342bd114496a03335e4ba72c18be4686365fe6c8dfaf4e1d1e522914e', // Admin token
  INSTANCE_KEY: '123'           // default instance key
};

// ============================================================
//  INTERNAL HELPERS - inhe mat chhedo
// ============================================================

function _baseUrl() {
  var url = CONFIG.API_URL;
  if (url.endsWith('/')) url = url.slice(0, -1);
  return url;
}

function _headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + CONFIG.TOKEN
  };
}

function _url(path, params) {
  var url = _baseUrl() + path;
  var qs = [];
  if (params) {
    for (var k in params) {
      if (params[k] !== undefined && params[k] !== null)
        qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    }
  }
  if (qs.length) url += (url.indexOf('?') === -1 ? '?' : '&') + qs.join('&');
  return url;
}

function _get(path, params) {
  var response = UrlFetchApp.fetch(_url(path, params), {
    method: 'GET',
    headers: _headers(),
    muteHttpExceptions: true
  });
  return JSON.parse(response.getContentText());
}

function _post(path, body, params) {
  var options = {
    method: 'POST',
    headers: _headers(),
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  if (params) {
    options.headers = _headers();
  }
  var response = UrlFetchApp.fetch(_url(path, params), options);
  return JSON.parse(response.getContentText());
}

// ============================================================
//  STATUS
// ============================================================

function healthCheck() {
  // Public endpoint - no auth needed
  var url = _baseUrl() + '/status';
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  return response.getContentText(); // returns "OK"
}

// ============================================================
//  INSTANCE - Instance Management (/instance/*)
// ============================================================

function instanceInit(key, options) {
  // Create a new WhatsApp instance
  // options: { webhook, webhookUrl, browser, ignoreGroups, webhookEvents, messagesRead, base64 }
  var body = { key: key || CONFIG.INSTANCE_KEY };
  if (options) Object.assign(body, options);
  return _post('/instance/init', body, { admintoken: CONFIG.ADMIN_TOKEN });
}

function instanceEdit(key, options) {
  // Edit existing instance
  var body = { key: key || CONFIG.INSTANCE_KEY };
  if (options) Object.assign(body, options);
  return _post('/instance/editar', body, { key: key || CONFIG.INSTANCE_KEY });
}

function instanceGetQR(key) {
  // Get QR code page URL (returns HTML, use getQRBase64 instead for JSON)
  return _url('/instance/qr', { key: key || CONFIG.INSTANCE_KEY });
}

function instanceGetQRBase64(key) {
  // Get QR code as base64 JSON
  return _get('/instance/qrbase64', { key: key || CONFIG.INSTANCE_KEY });
}

function instanceInfo(key) {
  // Get instance connection info
  return _get('/instance/info', { key: key || CONFIG.INSTANCE_KEY });
}

function instanceRestore() {
  // Restore all sessions (admin only)
  return _get('/instance/restore', { admintoken: CONFIG.ADMIN_TOKEN });
}

function instanceLogout(key) {
  // Logout from WhatsApp
  return _get('/instance/logout', { key: key || CONFIG.INSTANCE_KEY });
}

function instanceDelete(key) {
  // Delete instance (logout + remove files)
  return _get('/instance/delete', { key: key || CONFIG.INSTANCE_KEY });
}

function instanceList() {
  // List all active instances (admin only)
  return _get('/instance/list', { admintoken: CONFIG.ADMIN_TOKEN });
}

function instanceDeleteInactives() {
  // Delete all inactive instances (admin only)
  return _get('/instance/deleteInactives', { admintoken: CONFIG.ADMIN_TOKEN });
}

function instanceDeleteAll() {
  // Delete ALL instances (admin only)
  return _get('/instance/deleteAll', { admintoken: CONFIG.ADMIN_TOKEN });
}

function instanceGetCode(key, phoneNumber) {
  // Get pairing code (for non-QR login)
  return _post('/instance/getcode', { number: phoneNumber }, { key: key || CONFIG.INSTANCE_KEY });
}

// ============================================================
//  MESSAGE - Send Messages (/message/*)
// ============================================================

function sendText(jid, text, options) {
  // Send text message
  // jid: "911234567890@s.whatsapp.net" ya "group-jid@g.us"
  // options: { typeId: "user"|"group", delay, replyFrom, groupOptions }
  var body = {
    id: jid,
    typeId: (options && options.typeId) || 'user',
    message: text
  };
  if (options) {
    if (options.delay) body.options = { delay: options.delay };
    if (options.replyFrom) body.options = body.options || {}, body.options.replyFrom = options.replyFrom;
    if (options.groupOptions) body.groupOptions = options.groupOptions;
    if (options.typeId) body.typeId = options.typeId;
  }
  return _post('/message/text', body, { key: CONFIG.INSTANCE_KEY });
}

function sendTextToGroup(groupJid, text, options) {
  // Shortcut: send text to a group
  options = options || {};
  options.typeId = 'group';
  return sendText(groupJid, text, options);
}

function sendMediaFromUrl(jid, url, type, filename, options) {
  // Send file from URL
  // type: "image" | "video" | "audio" | "document"
  var body = {
    id: jid,
    typeId: (options && options.typeId) || 'user',
    url: url,
    type: type
  };
  if (filename) body.filename = filename;
  if (options) {
    if (options.caption) body.options = { caption: options.caption };
    if (options.delay) body.options = body.options || {}, body.options.delay = options.delay;
  }
  return _post('/message/sendurlfile', body, { key: CONFIG.INSTANCE_KEY });
}

function sendMediaFromBase64(jid, base64string, filename, type, options) {
  // Send file from base64
  var body = {
    id: jid,
    typeId: (options && options.typeId) || 'user',
    base64string: base64string,
    filename: filename,
    type: type
  };
  if (options && options.caption) body.options = { caption: options.caption };
  return _post('/message/sendbase64file', body, { key: CONFIG.INSTANCE_KEY });
}

function sendButton(jid, text, buttons, options) {
  // Send interactive button message
  // buttons: [{ type: "replyButton", title: "Click me", payload: "data" }]
  var body = {
    id: jid,
    btndata: {
      text: text,
      buttons: buttons
    }
  };
  if (options && options.footerText) body.btndata.footerText = options.footerText;
  return _post('/message/button', body, { key: CONFIG.INSTANCE_KEY });
}

function sendContact(jid, fullName, phoneNumber, organization) {
  // Send vCard contact
  var body = {
    id: jid,
    vcard: {
      fullName: fullName,
      phoneNumber: phoneNumber
    }
  };
  if (organization) body.vcard.organization = organization;
  return _post('/message/contact', body, { key: CONFIG.INSTANCE_KEY });
}

function sendList(jid, title, description, buttonText, sections, options) {
  // Send interactive list message
  var body = {
    id: jid,
    type: (options && options.type) || 'user',
    msgdata: {
      title: title,
      description: description || '',
      buttonText: buttonText,
      sections: sections
    }
  };
  if (options && options.footerText) body.msgdata.footerText = options.footerText;
  return _post('/message/list', body, { key: CONFIG.INSTANCE_KEY });
}

function setPresence(status, jid, type) {
  // Set presence/typing status
  // status: "available" | "unavailable" | "composing" | "recording" | "paused"
  var body = { status: status };
  if (jid) body.id = jid;
  if (type) body.type = type;
  return _post('/message/setstatus', body, { key: CONFIG.INSTANCE_KEY });
}

function markAsRead(remoteJid, messageId, participant) {
  // Mark message as read
  var body = {
    msg: { remoteJid: remoteJid, id: messageId }
  };
  if (participant) body.msg.participant = participant;
  return _post('/message/read', body, { key: CONFIG.INSTANCE_KEY });
}

function reactToMessage(jid, messageKey, emoji) {
  // React to a message
  var body = { id: jid, key: messageKey, emoji: emoji };
  return _post('/message/react', body, { key: CONFIG.INSTANCE_KEY });
}

function getQueueStatus() {
  return _get('/message/queue', { key: CONFIG.INSTANCE_KEY });
}

function getJobStatus(jobId) {
  return _get('/message/job/' + jobId, { key: CONFIG.INSTANCE_KEY });
}

// ============================================================
//  GROUP - Group Management (/group/*)
// ============================================================

function groupCreate(name, users) {
  // Create new group
  return _post('/group/create', { name: name, users: users }, { key: CONFIG.INSTANCE_KEY });
}

function groupListAll() {
  return _post('/group/listall', {}, { key: CONFIG.INSTANCE_KEY });
}

function groupLeave(groupJid) {
  return _post('/group/leave', { id: groupJid }, { key: CONFIG.INSTANCE_KEY });
}

function groupAddParticipants(groupJid, users) {
  // users: ["911234567890", "919876543210"]
  return _post('/group/inviteuser', { id: groupJid, users: users }, { key: CONFIG.INSTANCE_KEY });
}

function groupRemoveParticipants(groupJid, users) {
  return _post('/group/removeuser', { id: groupJid, users: users }, { key: CONFIG.INSTANCE_KEY });
}

function groupMakeAdmin(groupJid, users) {
  return _post('/group/makeadmin', { id: groupJid, users: users }, { key: CONFIG.INSTANCE_KEY });
}

function groupDemoteAdmin(groupJid, users) {
  return _post('/group/demoteadmin', { id: groupJid, users: users }, { key: CONFIG.INSTANCE_KEY });
}

function groupGetInviteCode(groupJid) {
  return _post('/group/getinvitecode', { id: groupJid }, { key: CONFIG.INSTANCE_KEY });
}

function groupJoinViaUrl(url) {
  // url: "https://chat.whatsapp.com/..."
  return _post('/group/join', { url: url }, { key: CONFIG.INSTANCE_KEY });
}

function groupGetAllGroups() {
  return _get('/group/getallgroups', { key: CONFIG.INSTANCE_KEY });
}

function groupParticipantsUpdate(groupJid, users, action) {
  // action: "add" | "remove" | "promote" | "demote"
  return _post('/group/participantsupdate', { id: groupJid, users: users, action: action }, { key: CONFIG.INSTANCE_KEY });
}

function groupSettingsUpdate(groupJid, action) {
  // action: "announcement" | "not_announcement" | "locked" | "unlocked"
  return _post('/group/settingsupdate', { id: groupJid, action: action }, { key: CONFIG.INSTANCE_KEY });
}

function groupUpdateSubject(groupJid, subject) {
  return _post('/group/updatesubject', { id: groupJid, subject: subject }, { key: CONFIG.INSTANCE_KEY });
}

function groupUpdateDescription(groupJid, description) {
  return _post('/group/updatedescription', { id: groupJid, description: description }, { key: CONFIG.INSTANCE_KEY });
}

function groupGetInfoFromUrl(url) {
  return _post('/group/groupurlinfo', { url: url }, { key: CONFIG.INSTANCE_KEY });
}

function groupGetInfoById(groupJid) {
  return _post('/group/groupidinfo', { id: groupJid }, { key: CONFIG.INSTANCE_KEY });
}

function groupAcceptInvite(code) {
  // code: invite code (not full URL)
  return _post('/group/groupjoin', { code: code }, { key: CONFIG.INSTANCE_KEY });
}

// ============================================================
//  MISC - Miscellaneous (/misc/*)
// ============================================================

function checkOnWhatsApp(phoneNumber) {
  return _post('/misc/onwhatsapp', { id: phoneNumber }, { key: CONFIG.INSTANCE_KEY });
}

function downloadProfilePicture(jid, isGroup) {
  var body = { id: jid };
  if (isGroup) body.group = true;
  return _post('/misc/downProfile', body, { key: CONFIG.INSTANCE_KEY });
}

function getUserStatus(phoneNumber) {
  return _post('/misc/getStatus', { id: phoneNumber }, { key: CONFIG.INSTANCE_KEY });
}

function blockUser(phoneNumber, blockStatus) {
  // blockStatus: "block" | "unblock"
  return _post('/misc/blockUser', { id: phoneNumber, block_status: blockStatus }, { key: CONFIG.INSTANCE_KEY });
}

function getContacts() {
  return _get('/misc/contacts', { key: CONFIG.INSTANCE_KEY });
}

function getChats(jid) {
  return _post('/misc/chats', { id: jid }, { key: CONFIG.INSTANCE_KEY });
}

function setMyStatus(status) {
  // status: "available" | "unavailable"
  return _post('/misc/mystatus', { status: status }, { key: CONFIG.INSTANCE_KEY });
}

function updateProfilePicture(jid, imageUrl, type) {
  // type: "user" | "group"
  return _post('/misc/updateProfilePicture', { id: jid, url: imageUrl, type: type }, { key: CONFIG.INSTANCE_KEY });
}

function getUserOrGroupById(jid) {
  return _post('/misc/getuserorgroupbyid', { id: jid }, { key: CONFIG.INSTANCE_KEY });
}

// ============================================================
//  AUTOMATION EXAMPLES
//  Inhe Google Apps Script triggers se call karein
// ============================================================

/**
 * Google Sheet se message bhejne ka example.
 * Sheet columns: A=JID, B=Message, C=Status
 * Trigger: time-based (har 1 minute)
 */
function sendBulkFromSheet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();

  for (var i = 1; i < data.length; i++) {
    var jid = data[i][0];
    var message = data[i][1];
    var status = data[i][2];

    if (jid && message && status !== 'SENT') {
      try {
        var result = sendText(jid, message);
        if (result && result.error === false) {
          sheet.getRange(i + 1, 3).setValue('SENT');
          sheet.getRange(i + 1, 4).setValue(new Date().toLocaleString());
        } else {
          sheet.getRange(i + 1, 3).setValue('FAILED: ' + JSON.stringify(result));
        }
      } catch (e) {
        sheet.getRange(i + 1, 3).setValue('ERROR: ' + e.message);
      }
    }
  }
}

/**
 * Daily broadcast - har subah 9 baje group mein message
 * Trigger: time-driven → Day timer → 9 AM
 */
function dailyBroadcast() {
  var groupJid = '1234567890-123456@g.us'; // apna group JID daalein
  var message = 'Good morning! 🌅\n\nAaj ka motivational message...';

  var result = sendTextToGroup(groupJid, message);
  Logger.log('Broadcast result: ' + JSON.stringify(result));
}

/**
 * WhatsApp se aaye hue messages ka reply (webhook based nahi hai)
 * Iske liye aapko webhook endpoint set karna hoga.
 */

// ============================================================
//  SHEET FUNCTIONS (direct use in =FORMULA)
//  Example: =SEND_TEXT("911234567890@s.whatsapp.net", "Hello")
// ============================================================

/**
 * Google Sheets mein direct use karne ke liye:
 * =SEND_TEXT("911234567890@s.whatsapp.net", "Hello from Sheet!")
 */
function SEND_TEXT(jid, message) {
  var result = sendText(jid, message);
  if (result.error === false) return '✓ Sent';
  return '✗ ' + (result.message || 'Failed');
}

/**
 * =IS_ON_WA("911234567890")
 */
function IS_ON_WA(phone) {
  var result = checkOnWhatsApp(phone + '@s.whatsapp.net');
  if (result.error === false && result.data && result.data.exists) return 'YES';
  return 'NO';
}

/**
 * =GROUP_SEND("group-jid@g.us", "Hello everyone!")
 */
function GROUP_SEND(groupJid, message) {
  var result = sendTextToGroup(groupJid, message);
  if (result.error === false) return '✓ Sent to group';
  return '✗ ' + (result.message || 'Failed');
}
