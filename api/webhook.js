export default function handler(req, res) {
  if (req.method === 'POST') {
    console.log('收到LINE事件:', req.body);
    res.status(200).send('OK');
  } else {
    res.status(405).send('Method Not Allowed');
  }
}
import { google } from 'googleapis';
import line from '@line/bot-sdk';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GOOGLE_KEY = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

const lineClient = new line.Client({
  channelAccessToken: CHANNEL_ACCESS_TOKEN,
});

const jwtClient = new google.auth.JWT(
  GOOGLE_KEY.client_email,
  null,
  GOOGLE_KEY.private_key,
  ['https://www.googleapis.com/auth/spreadsheets']
);

const sheets = google.sheets({ version: 'v4', auth: jwtClient });

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }
  try {
    await jwtClient.authorize();

    const events = req.body.events;
    if (!events || events.length === 0) {
      return res.status(200).send('No events');
    }

    for (const event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userId = event.source.userId;
        const timestamp = new Date(Number(event.timestamp)).toISOString();
        const message = event.message.text;

        // 寫入 Google Sheet
        await sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: 'Sheet1!A:F',
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[userId, timestamp, message, '', '', '']],
          },
        });

        // 回覆用戶
        const replyText = `收到你的訊息：「${message}」，我們會盡快回覆你！`;

        await lineClient.replyMessage(event.replyToken, {
          type: 'text',
          text: replyText,
        });
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error');
  }
}
