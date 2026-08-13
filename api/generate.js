const fs = require("fs");
const path = require("path");
const MODEL = "gemini-3.6-flash";

function getApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
    const line = envFile.split(/\r?\n/).find((item) => item.startsWith("GEMINI_API_KEY="));
    return line ? line.slice("GEMINI_API_KEY=".length).trim() : "";
  } catch (error) {
    return "";
  }
}

function json(res, status, body) {
  res.status(status).json(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "只接受 POST 產生題目的請求。" });

  const apiKey = getApiKey();
  if (!apiKey) {
    return json(res, 500, { error: "尚未設定 GEMINI_API_KEY 金鑰，請先在 Vercel 環境變數或本機 .env.local 中設定。" });
  }

  const input = req.body || {};
  if (!input.news || typeof input.news !== "string" || !input.news.trim()) {
    return json(res, 400, { error: "請先貼上新聞重點內容。" });
  }

  // 限制請求內容大小（上限 10,000 字元）
  if (input.news.length > 10000) {
    return json(res, 400, { error: "新聞重點內容過長，請限制在 10,000 字元以內。" });
  }

  const count = Number(input.count) === 3 ? 3 : 5;
  const prompt = `你是台灣高中職教師的命題助手。請根據以下資料產生 ${count} 題四選一單選題。
規則：
1. 將新聞改寫成不依賴原文也看得懂的自足情境題幹，不逐字抄寫新聞。
2. 每題固定四個選項，答案必須唯一且只能是 A、B、C 或 D。
3. 每題提供繁體中文詳解與出處提醒（來源：${input.source || "未填寫"}；日期：${input.date || "未填寫"}）。
4. 題目內容是草稿，不能宣稱已查核。
5. 只回傳 JSON，不要加 Markdown 標記，格式如下：
{"questions":[{"stem":"","options":{"A":"","B":"","C":"","D":""},"answer":"A","explanation":"","sourceReminder":""}]}

科目：${input.subject || "未填寫"}
課綱單元重點：${input.unit || "未填寫"}
新聞標題：${input.title || "未填寫"}
新聞來源：${input.source || "未填寫"}
新聞日期：${input.date || "未填寫"}
新聞重點：${input.news}`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    const data = await response.json();
    if (!response.ok) {
      const errMsg = data?.error?.message || "Gemini 服務回應錯誤。";
      return json(res, 502, { error: `Gemini API 呼叫失敗：${errMsg}` });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const cleanedText = text.replace(/^```json\s*|\s*```$/g, "").trim();
    const parsed = JSON.parse(cleanedText);
    if (!Array.isArray(parsed.questions)) throw new Error("AI 回傳題目格式不正確");
    return json(res, 200, { questions: parsed.questions.slice(0, count) });
  } catch (error) {
    return json(res, 502, { error: `題目產生失敗：${error.message || "請確認網路或輸入資料後重試。"}` });
  }
};
