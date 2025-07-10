
import { google } from 'googleapis';
import line from '@line/bot-sdk';
import crypto from 'crypto';

const SHEET_ID = '1TtIxGyhNvINvv1cby5throA4fRgkXAZbw-ZRjmub0Wc';
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GOOGLE_KEY = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

const lineClient = new line.Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN
});

const jwtClient = new google.auth.JWT(
  GOOGLE_KEY.client_email,
  null,
  GOOGLE_KEY.private_key.replace(/\\n/g, '\n'),
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth: jwtClient });

function validateSignature(signature, body) {
  const hash = crypto
    .createHmac('sha256', CHANNEL_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
  return hash === signature;
}

function extractKeyword(text) {
  const keywords = ['價格', '多少錢', '怎麼買', '優惠'];
  const found = keywords.find(keyword => text.includes(keyword));
  return found || '其他';
}

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
    } catch (error) {
      console.error('讀取歷史資料失敗：', error);
    }
  }

  analyzeBestReply(userMessage) {
    const keyword = extractKeyword(userMessage);
    const similarCases = this.history.filter(row => 
      row[2] && row[2].includes(keyword) && row[5] === '成交'
    );
    return similarCases.length > 0 ? similarCases[0][4] : null;
  }
}

export default async function handler(req, res) {
  res.status(200).send('OK');

  const signature = req.headers['x-line-signature'];
  if (!validateSignature(signature, req.body)) {
    return console.error('簽名驗證失敗');
  }

  try {
    await jwtClient.authorize();
    const smartEngine = new SmartReplyEngine();
    await smartEngine.loadHistory();

    const events = req.body.events || [];
    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;

        const aiReply = smartEngine.analyzeBestReply(userMessage) || 
          `收到您的訊息：「${userMessage}」，我們將盡快處理！`;

        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: 'Sheet1!A:F',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[
              event.source.userId,
              new Date().toISOString(),
              userMessage,
              '待跟進',
              aiReply,
              ''
            ]],
          },
        });

        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: aiReply
        });
      }
    }
  } catch (error) {
    console.error('處理錯誤:', error);
  }
}
