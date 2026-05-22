const https = require('https');

const TELEGRAM_TOKEN = '8687631425:AAGl8C4fpO1M-8niq7gaiO-WbqauCJVqHH4';
const CLAUDE_API_KEY = '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';
const SUPABASE_URL = 'https://rgmxncurrisbukxistls.supabase.co';
const SUPABASE_KEY = 'sb_publishable_6-n7S970NW3zQGrDzjVUpg_UqKqeZt7';

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
  }, { chat_id: chatId, text, parse_mode: 'HTML' });
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
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  return response.content?.[0]?.text || 'Sorry, I could not process your request.';
}

// Download voice message and transcribe
async function transcribeVoice(fileId) {
  // Get file path
  const fileInfo = await request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_TOKEN}/getFile?file_id=${fileId}`,
    method: 'GET'
  });
  
  const filePath = fileInfo.result?.file_path;
  if (!filePath) return null;

  // Download file
  const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${filePath}`;
  
  // Use Claude to acknowledge voice (full transcription requires external service)
  return `[Voice message received - file: ${filePath}]`;
}

// Process updates
async function processUpdate(update) {
  const message = update.message;
  if (!message) return;

  const chatId = message.chat.id;
  const text = message.text;
  const voice = message.voice;

  try {
    let userMessage = text;

    if (voice) {
      await sendMessage(chatId, '🎤 Получил голосовое сообщение, обрабатываю...');
      // For now, ask user to type
      await sendMessage(chatId, '⚠️ Голосовые сообщения пока в разработке. Пожалуйста, напишите текстом.');
      return;
    }

    if (!userMessage) return;

    // Quick commands
    if (userMessage === '/start') {
      await sendMessage(chatId, `👋 Привет! Я ваш CRM-ассистент.\n\nМогу рассказать:\n• Сколько лидов и сделок\n• Что делают менеджеры\n• Какие задачи просрочены\n• И многое другое!\n\nПросто спросите меня на русском или английском.`);
      return;
    }

    if (userMessage === '/stats') {
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
    const answer = await askClaude(userMessage, crm);
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
