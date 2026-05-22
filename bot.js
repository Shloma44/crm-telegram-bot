const https = require('https');

const TELEGRAM_TOKEN = '8687631425:AAGl8C4fpO1M-8niq7gaiO-WbqauCJVqHH4';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const SUPABASE_URL = 'https://rgmxncurrisbukxistls.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6-n7S970NW3zQGrDzjVUpg_UqKqeZt7';

// Users
const ADMIN_ID = 7923325674;
const ADMIN_IDS = [7923325674, 6663069441];;
const MANAGER_IDS = [7337655369, 6131587426]; // Simmy, Treasure
const ALL_ALLOWED = [ADMIN_ID, ...MANAGER_IDS];
const PASSWORD = '123shloma';

// Store authenticated users and their roles
const authenticated = new Set();
const awaitingPassword = new Set();

function isAdmin(chatId) { return ADMIN_IDS.includes(chatId); }
function isManager(chatId) { return MANAGER_IDS.includes(chatId); }
function isAllowed(chatId) { return ALL_ALLOWED.includes(chatId); }

// Simple HTTP request helper
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

// Send Telegram message
async function sendMessage(chatId, text) {
  return request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { chat_id: chatId, text, });
}

// Get CRM stats from Supabase
async function getCRMData() {
  const [clients, deals, tasks] = await Promise.all([
    request({ hostname: 'rgmxncurrisbukxistls.supabase.co', path: '/rest/v1/clients?select=name,manager,status', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
    request({ hostname: 'rgmxncurrisbukxistls.supabase.co', path: '/rest/v1/deals?select=stage,amount,closed,manager,client_id', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
    request({ hostname: 'rgmxncurrisbukxistls.supabase.co', path: '/rest/v1/tasks?select=title,status,due,client_id', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
  ]);
  return { clients: clients || [], deals: deals || [], tasks: tasks || [] };
}

// Ask Claude
async function askClaude(userMessage, crmContext) {
  const systemPrompt = `You are a CRM assistant for a sales team. You have access to real-time CRM data.
Always respond in the same language the user writes in (Russian or English).
Be concise and helpful.

Current CRM Data:
- Total clients: ${crmContext.clients.length}
- Clients by manager: Treasure: ${crmContext.clients.filter(c => c.manager === 'Treasure').length}, Simmy: ${crmContext.clients.filter(c => c.manager === 'Simmy').length}, Unassigned: ${crmContext.clients.filter(c => !c.manager).length}
- Clients by status: New: ${crmContext.clients.filter(c => (c.status||'new') === 'new').length}, Hot: ${crmContext.clients.filter(c => c.status === 'hot').length}, In Process: ${crmContext.clients.filter(c => c.status === 'in_process').length}
- Active deals: ${crmContext.deals.filter(d => !d.closed).length}
- Total pipeline value: $${crmContext.deals.filter(d => !d.closed).reduce((s, d) => s + Number(d.amount || 0), 0).toLocaleString()}
- Won deals: ${crmContext.deals.filter(d => d.closed === 'won').length}
- Lost deals: ${crmContext.deals.filter(d => d.closed === 'lost').length}
- Open tasks: ${crmContext.tasks.filter(t => t.status !== 'done').length}
- Overdue tasks: ${crmContext.tasks.filter(t => t.status !== 'done' && t.due && new Date(t.due) < new Date()).length}

Deal stages: ${['lead','qualify','meeting','contract','payment'].map(s => `${s}: ${crmContext.deals.filter(d => d.stage === s && !d.closed).length}`).join(', ')}`;

  const response = await request({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    }
  }, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  return response.content?.[0]?.text || 'Sorry, I could not process your request.';
}

// Send new lead notification to managers
async function notifyManagersNewLead(lead) {
  const text = `🆕 <b>New Lead!</b>\n\n👤 <b>Name:</b> ${lead.name || '—'}\n📞 <b>Phone:</b> ${lead.phone || '—'}\n📧 <b>Email:</b> ${lead.email || '—'}\n🏢 <b>Company:</b> ${lead.company || '—'}\n📍 <b>Source:</b> ${lead.source || '—'}\n👔 <b>Assigned to:</b> ${lead.manager || 'Unassigned'}`;
  
  for (const managerId of MANAGER_IDS) {
    if (authenticated.has(managerId)) {
      await sendMessage(managerId, text).catch(console.error);
    }
  }
}

// Process updates
async function processUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const text = message.text;

  try {
    // Block unknown users
    if (!isAllowed(chatId)) {
      await sendMessage(chatId, '⛔️ У вас нет доступа к этому боту.');
      return;
    }

    // Handle /start
    if (text === '/start') {
      if (authenticated.has(chatId)) {
        if (isAdmin(chatId)) {
          await sendMessage(chatId, `👋 Привет, Админ!\n\nМогу рассказать:\n• Сколько лидов и сделок\n• Что делают менеджеры\n• Какие задачи просрочены\n• И многое другое!\n\nПросто спросите меня.`);
        } else {
          await sendMessage(chatId, `👋 Привет!\n\nВы будете получать уведомления о новых лидах автоматически.`);
        }
        return;
      }
      awaitingPassword.add(chatId);
      await sendMessage(chatId, '🔐 Введите пароль для доступа:');
      return;
    }

    // Handle password input
    if (awaitingPassword.has(chatId)) {
      if (text === PASSWORD) {
        awaitingPassword.delete(chatId);
        authenticated.add(chatId);
        if (isAdmin(chatId)) {
          await sendMessage(chatId, `✅ Доступ разрешён!\n\n👑 Вы вошли как <b>Администратор</b>.\n\nМожете спрашивать всё что угодно о CRM!`);
        } else {
          await sendMessage(chatId, `✅ Доступ разрешён!\n\n👔 Вы вошли как <b>Менеджер</b>.\n\nВы будете получать уведомления о новых лидах.`);
        }
      } else {
        await sendMessage(chatId, '❌ Неверный пароль. Попробуйте ещё раз:');
      }
      return;
    }

    // Block if not authenticated
    if (!authenticated.has(chatId)) {
      awaitingPassword.add(chatId);
      await sendMessage(chatId, '🔐 Введите пароль для доступа:');
      return;
    }

    // Managers only get notifications — no chat
    if (isManager(chatId) && !isAdmin(chatId)) {
      await sendMessage(chatId, 'ℹ️ Вы будете получать уведомления о новых лидах автоматически.');
      return;
    }

    // Admin only from here
    if (!text) return;

    if (text === '/stats') {
      const crm = await getCRMData();
      const active = crm.deals.filter(d => !d.closed);
      const sum = active.reduce((s, d) => s + Number(d.amount || 0), 0);
      await sendMessage(chatId, `📊 <b>CRM Статистика</b>\n\n👥 Клиентов: ${crm.clients.length}\n💼 Активных сделок: ${active.length}\n💰 Сумма сделок: $${sum.toLocaleString()}\n✅ Открытых задач: ${crm.tasks.filter(t => t.status !== 'done').length}\n\n<b>Менеджеры:</b>\n🔵 Treasure: ${crm.clients.filter(c => c.manager === 'Treasure').length} клиентов\n🟢 Simmy: ${crm.clients.filter(c => c.manager === 'Simmy').length} клиентов\n⚠️ Без менеджера: ${crm.clients.filter(c => !c.manager).length}`);
      return;
    }

    // Send typing indicator
    await request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendChatAction`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { chat_id: chatId, action: 'typing' });

    // Get CRM data and ask Claude
    const crm = await getCRMData();
    const answer = await askClaude(text, crm);
    await sendMessage(chatId, answer);

  } catch (err) {
    console.error('Error:', err);
    await sendMessage(chatId, '❌ Произошла ошибка. Попробуйте ещё раз.');
  }
}

// Start polling
let offset = 0;
async function poll() {
  try {
    const result = await request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/getUpdates?offset=${offset}&timeout=30`,
      method: 'GET'
    });
    
    if (result.ok && result.result) {
      for (const update of result.result) {
        offset = update.update_id + 1;
        processUpdate(update).catch(console.error);
      }
    }
  } catch (err) {
    console.error('Poll error:', err);
  }
  setTimeout(poll, 1000);
}

console.log('🤖 CRM Bot starting...');
poll();

// Export notify function for external use
module.exports = { notifyManagersNewLead };
