import { google } from 'googleapis';
import line from '@line/bot-sdk';
import crypto from 'crypto';

// 設定參數
const SHEET_ID = '1TtIxGyhNvINvv1cby5throA4fRgkXAZbw-ZRjmub0Wc';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
let GOOGLE_KEY;

try {
  GOOGLE_KEY = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
} catch (err) {
  console.error('Google 金鑰 JSON 格式錯誤：', err);
}

// LINE SDK 初始化
const lineClient = new line.Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

// Google API 認證
const jwtClient = new google.auth.JWT(
  GOOGLE_KEY.client_email,
  null,
  GOOGLE_KEY.private_key.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);
const sheets = google.sheets({ version: 'v4', auth: jwtClient });

// 驗證 LINE 簽名
function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
  return hash === signature;
}

// 回覆分析引擎
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
      console.error('讀取 Google Sheet 錯誤：', err);
      this.history = [];
    }
  }

  analyze(userMessage) {
    const keywords = ['價格', '多少錢', '怎麼買', '優惠'];
    const keyword = keywords.find(k => userMessage.includes(k)) || '其他';
    const matches = this.history.filter(row =>
      row[2] && row[2].includes(keyword) && row[5] === '成交'
    );
    return matches.length > 0 ? matches[0][4] : null;
  }
}

// 主處理函式
export default async function handler(req, res) {
  try {
    // 先回 LINE 200 OK（不然會報錯）
    res.status(200).send('OK');

    const signature = req.headers['x-line-signature'];
    if (!validateSignature(signature, req.body)) {
      console.error('簽名驗證失敗');
      return;
    }

    await jwtClient.authorize();
    const smart = new SmartReplyEngine();
    await smart.loadHistory();

    const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const msg = event.message.text;
        const userId = event.source.userId;
        const reply = smart.analyze(msg) || `感謝您傳來：「${msg}」，我們會盡快處理！`;

        // 回傳到 LINE
        try {
          await lineClient.replyMessage(event.replyToken, {
            type: 'text',
            text: reply
          });
        } catch (err) {
          console.error('回覆 LINE 失敗：', err);
        }

        // 寫入 Google Sheets
        try {
          await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: 'Sheet1!A:F',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[
                userId,
                new Date().toISOString(),
                msg,
                '待處理',
                reply,
                ''
              ]]
            }
          });
        } catch (err) {
          console.error('寫入 Google Sheets 失敗：', err);
        }
      }
    }
  } catch (err) {
    console.error('整體處理錯誤：', err);
    res.status(500).send('伺服器錯誤');
  }
}
