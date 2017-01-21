const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;
const MESSENGER_APP_SECRET = process.env.MESSENGER_APP_SECRET;
const DROPBOX_KEY = process.env.DROPBOX_KEY;

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const https = require('https');
const Dropbox = require('dropbox');
const request = require('request');
const moment = require('moment');

const app = express();
const dbx = new Dropbox({ accessToken: DROPBOX_KEY });

app.use(bodyParser.json({ verify: verifyRequestSignature }));

app.get('/', function (req, res) {
	res.send('Hello World!');
});

app.get('/webhook', function (req, res) {
	if (req.query['hub.mode'] === 'subscribe' &&
		req.query['hub.verify_token'] === VALIDATION_TOKEN) {
		console.log("Validating webhook");
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
});

app.post('/webhook', function (req, res) {
	var data = req.body;

	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		//
		// You must send back a 200, within 20 seconds, to let us know you've
		// successfully received the callback. Otherwise, the request will time out.
		res.sendStatus(200);
	}
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		// For testing, let's log an error. In production, you should throw an
		// error.
		console.error("Couldn't validate the signature.");
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', MESSENGER_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function sendTextMessage(recipientId, messageText) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: messageText,
			metadata: "DEVELOPER_DEFINED_METADATA"
		}
	};

	callSendAPI(messageData);
}

function mediaType(type) {
	switch (type) {
		case "audio":
			return '.mp3';
		case "image":
			return '.jpg';
		case "location":
			return '.txt';
		case "video":
			return '.mp4';
		default:
			return '';
	}
}

function receivedMessage(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;
	const timeOfMessage = event.timestamp;
	const message = event.message;

	console.log(event.timestamp);

	const messageAttachments = message.attachments;

	if (messageAttachments) {
		for (var i = 0, len = messageAttachments.length; i < len; i++) {
			const attachement = messageAttachments[i];

			const fileName = senderID + '-' + moment(timeOfMessage, "MM-DD-YYYY") + mediaType(attachement.type);

			https.get(attachement.payload.url, function (res) {
				const chunks = [];

				res.on('data', function (chunk) {
					chunks.push(chunk);
				});

				res.on('end', function () {
					const data = Buffer.concat(chunks);
					dbx.filesUpload({ path: '/' + fileName, contents: data })
						.then(function (response) {
							console.log(response);
							sendTextMessage(senderID, "Successfully Uploaded!");
						})
						.catch(function (err) {
							console.log(err);
							sendTextMessage(senderID, "Motherfucking Error!");
						});
				});
			})
		}
	}
}

function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: { access_token: PAGE_ACCESS_TOKEN },
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}

app.listen(process.env.PORT || 5000, function () {
	console.log('Running..');
});
