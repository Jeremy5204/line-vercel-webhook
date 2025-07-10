
const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  try {
    await doc.useServiceAccountAuth(creds);
    await doc.loadInfo();
    const sheet = doc.sheetsByIndex[0];

    const events = req.body.events;
    for (let event of events) {
      if (event.type === 'message' && event.message.type === 'text') {
        const userMessage = event.message.text;
        const replyMessage = `您好，我們已收到您的訊息：「${userMessage}」，我們會儘快與您聯繫！`;

        await sheet.addRow({
          userId: event.source.userId,
          timestamp: new Date(parseInt(event.timestamp)).toISOString(),
          message: userMessage,
          reply: replyMessage,
          matchedIntent: '',
          intentConfidence: ''
        });

        await axios.post(
          'https://api.line.me/v2/bot/message/reply',
          {
            replyToken: event.replyToken,
            messages: [
              {
                type: 'text',
                text: replyMessage
              }
            ]
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
            }
          }
        );
      }
    }

    res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).send('Internal Server Error');
  }
};
