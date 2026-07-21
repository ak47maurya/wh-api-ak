/**
 * ========================================
 *  WHATSAPP HARD API - Complete API Routes
 * ========================================
 * Base URL: http://localhost:3333
 * Auth: Bearer Token (if PROTECT_ROUTES=true)
 *
 * Middleware Legend:
 *   [T]  = Bearer Token required
 *   [A]  = Admin Token (query: ?admintoken=...)
 *   [K]  = Instance Key (query: ?key=...)
 *   [L]  = Phone must be connected/login
 *   [M]  = Multipart file upload (file field)
 */

// ======================================================================
//  STATUS
// ======================================================================
// Public healthcheck - no auth required
{ method: 'GET',  path: '/status' }

// ======================================================================
//  INSTANCE (/instance/*)
// ======================================================================

// Create new WhatsApp instance
{ method: 'POST', path: '/instance/init?admintoken=...',
  body: {
    key: 'string (unique instance id)',
    webhook: 'boolean (optional, default: false)',
    webhookUrl: 'string (optional)',
    browser: 'string (optional, default: My API)',
    ignoreGroups: 'boolean (optional, default: false)',
    webhookEvents: 'string[] (optional)',
    messagesRead: 'boolean (optional, default: false)',
    base64: 'boolean (optional, default: false)'
  }
}

// Edit existing instance settings
{ method: 'POST', path: '/instance/editar?key=...',
  body: {
    key: 'string',
    webhook: 'boolean',
    webhookUrl: 'string',
    browser: 'string',
    ignoreGroups: 'boolean',
    webhookEvents: 'string[]',
    messagesRead: 'boolean',
    base64: 'boolean'
  }
}

// Get QR Code (HTML page with QR)
{ method: 'GET',  path: '/instance/qr?key=...' }

// Get QR Code (Base64 JSON)
{ method: 'GET',  path: '/instance/qrbase64?key=...' }

// Get instance info
{ method: 'GET',  path: '/instance/info?key=...' }

// Restore all sessions
{ method: 'GET',  path: '/instance/restore?admintoken=...' }

// Logout from WhatsApp
{ method: 'GET',  path: '/instance/logout?key=...' }

// Delete instance (logout + remove files)
{ method: 'GET',  path: '/instance/delete?key=...' }

// List all active instances
{ method: 'GET',  path: '/instance/list?admintoken=...' }

// Delete all inactive instances
{ method: 'GET',  path: '/instance/deleteInactives?admintoken=...' }

// Delete ALL instances
{ method: 'GET',  path: '/instance/deleteAll?admintoken=...' }

// Get pairing code (for non-QR login)
{ method: 'POST', path: '/instance/getcode?key=...',
  body: { number: 'string (phone number)' }
}

// ======================================================================
//  MESSAGE (/message/*)
// ======================================================================

// Send text message
{ method: 'POST', path: '/message/text?key=...',
  body: {
    id: 'string (phone/group jid)',
    typeId: '"user" | "group"',
    message: 'string (text content)',
    options: {
      delay: 'number (seconds, optional)',
      replyFrom: 'string (message id to reply to, optional)'
    },
    groupOptions: {
      markUser: '"ghostMention" | string[] (optional)'
    }
  }
}

// Send image (file upload)
{ method: 'POST', path: '/message/image?key=...',
  multipart: { file: 'image file' },
  body: {
    id: 'string',
    caption: 'string (optional)'
  }
}

// Send file from URL
{ method: 'POST', path: '/message/sendurlfile?key=...',
  body: {
    id: 'string',
    typeId: '"user" | "group"',
    url: 'string',
    type: '"image" | "video" | "audio" | "document"',
    filename: 'string (for document)',
    options: {
      caption: 'string (optional)',
      delay: 'number (optional)',
      replyFrom: 'string (optional)'
    }
  }
}

// Send file from Base64
{ method: 'POST', path: '/message/sendbase64file?key=...',
  body: {
    id: 'string',
    typeId: '"user" | "group"',
    filename: 'string',
    type: '"image" | "video" | "audio" | "document"',
    base64string: 'string (base64 encoded file)',
    options: {
      caption: 'string (optional)',
      delay: 'number (optional)',
      replyFrom: 'string (optional)'
    }
  }
}

// Send image file (multipart)
{ method: 'POST', path: '/message/imagefile?key=...',
  multipart: { file: 'image file' },
  body: {
    id: 'string',
    userType: '"user" | "group"',
    caption: 'string (optional)',
    replyFrom: 'string (optional)',
    delay: 'number (optional)'
  }
}

// Send audio file (multipart)
{ method: 'POST', path: '/message/audiofile?key=...',
  multipart: { file: 'audio file' },
  body: {
    id: 'string',
    userType: '"user" | "group"',
    caption: 'string (optional)',
    replyFrom: 'string (optional)',
    delay: 'number (optional)'
  }
}

// Send video (multipart)
{ method: 'POST', path: '/message/video?key=...',
  multipart: { file: 'video file' },
  body: {
    id: 'string',
    userType: '"user" | "group"',
    caption: 'string (optional)',
    replyFrom: 'string (optional)',
    delay: 'number (optional)'
  }
}

// Send audio (PTT/voice note)
{ method: 'POST', path: '/message/audio?key=...',
  multipart: { file: 'audio file' },
  body: {
    id: 'string',
    mimetype: 'string'
  }
}

// Send document (multipart)
{ method: 'POST', path: '/message/doc?key=...',
  multipart: { file: 'document file' },
  body: {
    id: 'string',
    userType: '"user" | "group"',
    caption: 'string (optional)',
    replyFrom: 'string (optional)',
    delay: 'number (optional)'
  }
}

// Send media from URL
{ method: 'POST', path: '/message/mediaurl?key=...',
  body: {
    id: 'string',
    url: 'string',
    type: '"image" | "video" | "audio" | "document"',
    mimetype: 'string',
    caption: 'string (optional)'
  }
}

// Send interactive button message
{ method: 'POST', path: '/message/button?key=...',
  body: {
    id: 'string',
    btndata: {
      text: 'string',
      footerText: 'string (optional)',
      buttons: [{
        type: '"replyButton" | "callButton" | "urlButton"',
        title: 'string',
        payload: 'string (phone for callButton, url for urlButton)'
      }]
    }
  }
}

// Send contact (vCard)
{ method: 'POST', path: '/message/contact?key=...',
  body: {
    id: 'string',
    vcard: {
      fullName: 'string',
      organization: 'string (optional)',
      phoneNumber: 'string'
    }
  }
}

// Send list message
{ method: 'POST', path: '/message/list?key=...',
  body: {
    id: 'string',
    type: '"user" | "group"',
    options: {
      delay: 'number (optional)',
      replyFrom: 'string (optional)'
    },
    groupOptions: {
      markUser: '"ghostMention" | string[] (optional)'
    },
    msgdata: {
      title: 'string',
      description: 'string (optional)',
      buttonText: 'string',
      footerText: 'string (optional)',
      sections: 'array (list sections)'
    }
  }
}

// Set presence/typing status
{ method: 'POST', path: '/message/setstatus?key=...',
  body: {
    status: '"unavailable" | "available" | "composing" | "recording" | "paused"',
    id: 'string (optional, jid)',
    type: '"user" | "group" (optional)',
    delay: 'number (seconds, optional)'
  }
}

// Send media button message
{ method: 'POST', path: '/message/mediabutton?key=...',
  body: {
    id: 'string',
    btndata: {
      mediaType: '"image" | "video"',
      image: 'string (url)',
      text: 'string',
      footerText: 'string (optional)',
      buttons: 'array (same as button format)',
      mimeType: 'string (optional)'
    }
  }
}

// Mark message as read
{ method: 'POST', path: '/message/read?key=...',
  body: {
    msg: {
      remoteJid: 'string',
      id: 'string (message id)',
      participant: 'string (for group messages, optional)'
    }
  }
}

// React to message
{ method: 'POST', path: '/message/react?key=...',
  body: {
    id: 'string (remoteJid)',
    key: 'object (message key from msg)',
    emoji: 'string (emoji to react with)'
  }
}

// Get queue status
{ method: 'GET',  path: '/message/queue?key=...' }

// Get specific job status (Redis only)
{ method: 'GET',  path: '/message/job/:id?key=...' }

// ======================================================================
//  GROUP (/group/*)
// ======================================================================

// Create new group
{ method: 'POST', path: '/group/create?key=...',
  body: {
    name: 'string (group name)',
    users: 'string[] (phone numbers)'
  }
}

// List all groups
{ method: 'POST', path: '/group/listall?key=...' }

// Leave a group
{ method: 'POST', path: '/group/leave?key=...',
  body: { id: 'string (group jid)' }
}

// Add participants to group
{ method: 'POST', path: '/group/inviteuser?key=...',
  body: {
    id: 'string (group jid)',
    users: 'string[] (phone numbers)'
  }
}

// Remove participants from group
{ method: 'POST', path: '/group/removeuser?key=...',
  body: {
    id: 'string (group jid)',
    users: 'string[] (phone numbers)'
  }
}

// Make admin
{ method: 'POST', path: '/group/makeadmin?key=...',
  body: {
    id: 'string (group jid)',
    users: 'string[] (phone numbers)'
  }
}

// Demote admin
{ method: 'POST', path: '/group/demoteadmin?key=...',
  body: {
    id: 'string (group jid)',
    users: 'string[] (phone numbers)'
  }
}

// Get group invite code
{ method: 'POST', path: '/group/getinvitecode?key=...',
  body: { id: 'string (group jid)' }
}

// Join group via invite URL
{ method: 'POST', path: '/group/join?key=...',
  body: { url: 'string (chat.whatsapp.com invite url)' }
}

// Get instance invite code
{ method: 'POST', path: '/group/getinstanceinvitecode?key=...',
  body: { id: 'string (group jid)' }
}

// Get all participating groups
{ method: 'GET',  path: '/group/getallgroups?key=...' }

// Update group participants (add/remove/promote/demote)
{ method: 'POST', path: '/group/participantsupdate?key=...',
  body: {
    id: 'string (group jid)',
    users: 'string[] (phone numbers)',
    action: '"add" | "remove" | "promote" | "demote"'
  }
}

// Update group settings
{ method: 'POST', path: '/group/settingsupdate?key=...',
  body: {
    id: 'string (group jid)',
    action: '"announcement" | "not_announcement" | "locked" | "unlocked"'
  }
}

// Update group subject/name
{ method: 'POST', path: '/group/updatesubject?key=...',
  body: {
    id: 'string (group jid)',
    subject: 'string (new group name)'
  }
}

// Update group description
{ method: 'POST', path: '/group/updatedescription?key=...',
  body: {
    id: 'string (group jid)',
    description: 'string (new description)'
  }
}

// Get group info from invite URL
{ method: 'POST', path: '/group/groupurlinfo?key=...',
  body: { url: 'string (chat.whatsapp.com invite url)' }
}

// Get group info by ID
{ method: 'POST', path: '/group/groupidinfo?key=...',
  body: { id: 'string (group jid)' }
}

// Accept group invite via code
{ method: 'POST', path: '/group/groupjoin?key=...',
  body: { code: 'string (invite code)' }
}

// ======================================================================
//  MISC (/misc/*)
// ======================================================================

// Check if number is on WhatsApp
{ method: 'POST', path: '/misc/onwhatsapp?key=...',
  body: { id: 'string (phone number)' }
}

// Download profile picture
{ method: 'POST', path: '/misc/downProfile?key=...',
  body: {
    id: 'string (phone number or group jid)',
    group: 'boolean (optional, default: false)'
  }
}

// Get user status
{ method: 'POST', path: '/misc/getStatus?key=...',
  body: { id: 'string (phone number)' }
}

// Block/unblock user
{ method: 'POST', path: '/misc/blockUser?key=...',
  body: {
    id: 'string (phone number)',
    block_status: '"block" | "unblock"'
  }
}

// Get contacts list
{ method: 'GET',  path: '/misc/contacts?key=...' }

// Get chats
{ method: 'POST', path: '/misc/chats?key=...',
  body: { id: 'string' }
}

// Set my presence status
{ method: 'POST', path: '/misc/mystatus?key=...',
  body: { status: '"available" | "unavailable"' }
}

// Update profile picture
{ method: 'POST', path: '/misc/updateProfilePicture?key=...',
  body: {
    id: 'string (jid)',
    url: 'string (image url)',
    type: '"user" | "group"'
  }
}

// Get user or group by ID
{ method: 'GET',  path: '/misc/getuserorgroupbyid?key=...',
  body: { id: 'string' }
}
