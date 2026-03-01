const TELEGRAM_TOKEN = Deno.env.get("TELEGRAM_TOKEN")!;
const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;

// In-memory history per user (lives as long as function instance is warm)
const conversations = new Map<number, { role: string; content: string }[]>();

async function callDeepSeek(messages: { role: string; content: string }[]) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      max_tokens: 1024,
      messages: [
        { role: "system", content: "You are a helpful AI assistant." },
        ...messages,
      ],
    }),
  });

  const data = await res.json();
  return data.choices[0].message.content as string;
}

async function sendTelegram(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function sendTyping(chatId: number) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  });
}

Deno.serve(async (req) => {
  try {
    const { message } = await req.json();
    if (!message?.text) return new Response("ok");

    const userId = message.from.id;
    const chatId = message.chat.id;
    const userText = message.text.trim();

    // Commands
    if (userText === "/start") {
      await sendTelegram(chatId, "👋 Hello! I'm your AI assistant powered by DeepSeek. Ask me anything!");
      return new Response("ok");
    }

    if (userText === "/clear") {
      conversations.delete(userId);
      await sendTelegram(chatId, "🗑️ History cleared!");
      return new Response("ok");
    }

    if (userText === "/help") {
      await sendTelegram(chatId, "📖 *Commands:*\n/start - Start bot\n/clear - Clear history\n/help - Show help");
      return new Response("ok");
    }

    // Show typing indicator
    await sendTyping(chatId);

    // Get or init history
    if (!conversations.has(userId)) {
      conversations.set(userId, []);
    }
    const history = conversations.get(userId)!;

    // Add user message
    history.push({ role: "user", content: userText });

    // Keep last 20 messages to avoid token overflow
    if (history.length > 20) history.splice(0, history.length - 20);

    // Call DeepSeek
    const reply = await callDeepSeek(history);

    // Save assistant reply
    history.push({ role: "assistant", content: reply });

    // Send reply
    await sendTelegram(chatId, reply);

  } catch (err) {
    console.error("Error:", err);
  }

  return new Response("ok");
});