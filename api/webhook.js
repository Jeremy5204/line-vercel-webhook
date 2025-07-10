import { google } from 'googleapis';
import line from '@line/bot-sdk';
import crypto from 'crypto';

// 初始化設定
const SHEET_ID = '1TtIxGyhNvINvv1cby5throA4fRgkXAZbw-ZRjmub0Wc'; // 直接替換成您的Sheet ID
const lineClient = new line.Client({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
});

// 智能回覆引擎
class SmartReplyEngine {
  constructor() {
    this.history = [];
  }

  // 從Sheets加載歷史對話
  async loadHistory(sheets) {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'Sheet1!A:F'
    });
    this.history = res.data.values || [];
  }

  // 分析最佳回覆
  analyzeBestReply(userMessage) {
    // 1. 找出相似歷史對話
    const similarCases = this.history.filter(row => 
      row[2].includes(userMessage.keyword) && row[3] === '成交'
    );

    // 2. 提取成功回覆模板
    if (similarCases.length > 0) {
      const bestReply = similarCases[0][4]; // 假設第5欄存儲成功回覆
      return `${bestReply} [AI推薦]`;
    }
    return null;
  }
}

// 主處理函數
export default async function handler(req, res) {
  // [原有簽章驗證程式碼...]

  const sheets = google.sheets({ version: 'v4', auth: await initGoogleAuth() });
  const smartEngine = new SmartReplyEngine();
  
  // 加載歷史數據
  await smartEngine.loadHistory(sheets);

  // 處理每條訊息
  for (const event of req.body.events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userMessage = event.message.text;
      
      // 智能生成回覆
      const aiReply = smartEngine.analyzeBestReply({ 
        text: userMessage,
        keyword: extractKeyword(userMessage) // 關鍵字提取函數
      }) || `收到您的訊息：「${userMessage}」，我們將盡快處理！`;

      // 記錄到Sheet (包含AI標記)
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'Sheet1!A:F',
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [[
            event.source.userId,
            new Date().toISOString(),
            userMessage,
            '待跟進', // 狀態
            aiReply,  // 使用AI回覆
            ''        // 後續成交標記
          ]],
        },
      });

      // 發送智能回覆
      await lineClient.replyMessage(event.replyToken, {
        type: 'text',
        text: aiReply
      });
    }
  }
  res.status(200).send('OK');
}

// 關鍵字提取函數
function extractKeyword(text) {
  // 實作您的關鍵字邏輯
  return text.match(/(價格|多少錢|怎麼買|優惠)/)?.[0] || '其他';
}
