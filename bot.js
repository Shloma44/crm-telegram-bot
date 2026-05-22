const https = require('https');

const TELEGRAM_TOKEN = '8687631425:AAGl8C4fpO1M-8niq7gaiO-WbqauCJVqHH4';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const SUPABASE_URL = 'https://rgmxncurrisbukxistls.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6-n7S970NW3zQGrDzjVUpg_UqKqeZt7';

// Users
const ADMIN_IDS = [7923325674, 6663069441];
const MANAGER_IDS = [7337655369, 6131587426];
const ALL_ALLOWED = [...ADMIN_IDS, ...MANAGER_IDS];
const PASSWORD = '123shloma';

const authenticated = new Set();
const awaitingPassword = new Set();

function isAdmin(chatId) { return ADMIN_IDS.includes(chatId); }
function isManager(chatId) { return MANAGER_IDS.includes(chatId); }
function isAllowed(chatId) { return ALL_ALLOWED.includes(chatId); }

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

async function sendMessage(chatId, text) {
  return request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { chat_id: chatId, text });
}

async function getCRMData() {
  const [clients, deals, tasks] = await Promise.all([
    request({ hostname: 'rgmxncurrisbukxistls.supabase.co', path: '/rest/v1/clients?select=name,manager,status', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
    request({ hostname: 'rgmxncurrisbukxistls.supabase.co', path: '/rest/v1/deals?select=stage,amount,closed,manager,client_id', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
    request({ hostname: 'rgmxncurrisbukxistls.supabase.co', path: '/rest/v1/tasks?select=title,status,due,client_id', headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }),
  ]);
  return { clients: clients || [], deals: deals || [], tasks: tasks || [] };
}

async function askClaude(userMessage, crmContext) {
  const systemPrompt = `You are a CRM assistant for a sales team. You have access to real-time CRM data.
Always respond in the same language the user writes in (Russian or English).
Be concise and helpful. Never use markdown, asterisks or special symbols. Plain text only.

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

async function processUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const text = message.text;

  try {
    if (!isAllowed(chatId)) {
      await sendMessage(chatId, '⛔️ У вас нет доступа к этому боту.');
      return;
    }

    if (text === '/start') {
      if (authenticated.has(chatId)) {
        if (isAdmin(chatId)) {
          await sendMessage(chatId, '👋 Привет, Админ!\n\nМогу рассказать:\n• Сколько лидов и сделок\n• Что делают менеджеры\n• Какие задачи просрочены\n• И многое другое!\n\nПросто спросите меня.');
        } else {
          await sendMessage(chatId, '👋 Привет!\n\nВы будете получать уведомления о новых лидах автоматически.');
        }
        return;
      }
      awaitingPassword.add(chatId);
      await sendMessage(chatId, '🔐 Введите пароль для доступа:');
      return;
    }

    if (awaitingPassword.has(chatId)) {
      if (text === PASSWORD) {
        awaitingPassword.delete(chatId);
        authenticated.add(chatId);
        if (isAdmin(chatId)) {
          await sendMessage(chatId, '✅ Доступ разрешён!\n\n👑 Вы вошли как Администратор.\n\nМожете спрашивать всё что угодно о CRM!');
        } else {
          await sendMessage(chatId, '✅ Доступ разрешён!\n\n👔 Вы вошли как Менеджер.\n\nВы будете получать уведомления о новых лидах.');
        }
      } else {
        await sendMessage(chatId, '❌ Неверный пароль. Попробуйте ещё раз:');
      }
      return;
    }

    if (!authenticated.has(chatId)) {
      awaitingPassword.add(chatId);
      await sendMessage(chatId, '🔐 Введите пароль для доступа:');
      return;
    }

    if (isManager(chatId) && !isAdmin(chatId)) {
      await sendMessage(chatId, 'ℹ️ Вы будете получать уведомления о новых лидах автоматически.');
      return;
    }

    if (!text) return;

    if (text === '/stats') {
      const crm = await getCRMData();
      const active = crm.deals.filter(d => !d.closed);
      const sum = active.reduce((s, d) => s + Number(d.amount || 0), 0);
      await sendMessage(chatId, `📊 CRM Статистика\n\nКлиентов: ${crm.clients.length}\nАктивных сделок: ${active.length}\nСумма сделок: $${sum.toLocaleString()}\nОткрытых задач: ${crm.tasks.filter(t => t.status !== 'done').length}\n\nМенеджеры:\nTreasure: ${crm.clients.filter(c => c.manager === 'Treasure').length} клиентов\nSimmy: ${crm.clients.filter(c => c.manager === 'Simmy').length} клиентов\nБез менеджера: ${crm.clients.filter(c => !c.manager).length}`);
      return;
    }

    await request({
      hostname: 'api.telegram.org',
      path: `/bot${TELEGRAM_TOKEN}/sendChatAction`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { chat_id: chatId, action: 'typing' });

    const crm = await getCRMData();
    const answer = await askClaude(text, crm);
    await sendMessage(chatId, answer);

  } catch (err) {
    console.error('Error:', err);
    await sendMessage(chatId, '❌ Произошла ошибка. Попробуйте ещё раз.');
  }
}

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

module.exports = { };
