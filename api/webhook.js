import { google } from 'googleapis';
import line from '@line/bot-sdk';
import crypto from 'crypto';

// 設定
const SHEET_ID = '1TtIxGyhNvINvv1cby5throA4fRgkXAZbw-ZRjmub0Wc';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GOOGLE_KEY = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

// 初始化 LINE 客戶端
const lineClient = new line.Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

// 初始化 Google 認證
const jwtClient = new google.auth.JWT(
  GOOGLE_KEY.client_email,
  null,
  GOOGLE_KEY.private_key.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth: jwtClient });

// 驗證簽名
function validateSignature(signature, body) {
  try {
    const hash = crypto
      .createHmac('sha256', CHANNEL_SECRET)
      .update(JSON.stringify(body))
      .digest('base64');
    return hash === signature;
  } catch (err) {
    console.error('簽名驗證錯誤:', err);
    return false;
  }
}

// 抓關鍵字
function extractKeyword(text) {
  const keywords = ['價格', '多少錢', '怎麼買', '優惠'];
  return keywords.find(k => text.includes(k)) || '其他';
}

// AI 回覆引擎
class SmartReplyEngine {
  constructor() {
    this.history = [];
  }

  async loadHistory() {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'Sheet1!A:F'
      });
      this.history = res.data.values || [];
    } catch (err) {
      console.error('讀取 Google Sheet 失敗:', err);
    }
  }

  analyzeBestReply(userMessage) {
    try {
      const keyword = extractKeyword(userMessage);
      const matches = this.history.filter(row =>
        row[2] && row[2].includes(keyword) && row[5] === '成交'
      );
      return matches.length > 0 ? matches[0][4] : null;
    } catch (err) {
      console.error('回覆分析錯誤:', err);
      return null;
    }
  }
}

// LINE webhook handler
export default async function handler(req, res) {
  // 一定要回傳 200 給 LINE
  res.status(200).send('OK');

  try {
    const signature = req.headers['x-line-signature'];
    if (!validateSignature(signature, req.body)) {
      console.error('簽名錯誤');
      return;
    }

    await jwtClient.authorize();
    const smartEngine = new SmartReplyEngine();
    await smartEngine.loadHistory();

    const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const msg = event.message.text;
        const reply = smartEngine.analyzeBestReply(msg) || `收到您的訊息：「${msg}」，我們會儘快處理！`;

        // 回 LINE
        try {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: reply
          });
        } catch (err) {
          console.error('回覆 LINE 失敗:', err);
        }

        // 寫入 Google Sheet
        try {
          await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[
                event.source.userId,
                new Date().toISOString(),
                msg,
                '待跟進',
                reply,
                ''
              ]]
            }
          });
        } catch (err) {
          console.error('寫入 Google Sheet 失敗:', err);
        }
      }
    }
  } catch (err) {
    console.error('處理錯誤:', err);
  }
}
