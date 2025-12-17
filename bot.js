import WebSocket from "ws";

const BOT_USER_ID = process.env.CHANNEL_ID; // This is the User ID of the chat bot (may be the same as CHAT_CHANNEL_USER_ID)
const OAUTH_TOKEN = process.env.OAUTH_TOKEN; // Needs scopes user:bot, user:read:chat, user:write:chat
const CLIENT_ID = process.env.CLIENT_ID; // Your Twitch application's Client ID

const CHAT_CHANNEL_USER_ID = process.env.CHANNEL_ID; // This is the User ID of the channel that the bot will join and listen to chat messages of

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";
const APEX_WEBSOCKET_URL = "ws://localhost:7777";

const POI = {
    1: "Next player",
    2: "Previous player",
    3: "Kill leader",
    4: "Closest enemy",
    5: "Closest player",
    6: "Last attacker",
}

var websocketSessionID;

// Start executing the bot from here
(async () => {
  // Verify that the authentication is valid
  await getAuth();

  // Start WebSocket client and register handlers
  const websocketClient = startWebSocketClient();
})();

// WebSocket will persist the application loop until you exit the program forcefully

async function getAuth() {
  // https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
  console.log(process.env.OAUTH_TOKEN);
  let response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + OAUTH_TOKEN,
    },
  });

  if (response.status != 200) {
    let data = await response.json();
    console.error(
      "Token is not valid. /oauth2/validate returned status code " +
        response.status
    );
    console.error(data);
    process.exit(1);
  }

  console.log("Validated token.");
}

function startWebSocketClient() {
  let websocketClient = new WebSocket(EVENTSUB_WEBSOCKET_URL);

  websocketClient.on("error", console.error);

  websocketClient.on("open", () => {
    console.log("WebSocket connection opened to " + EVENTSUB_WEBSOCKET_URL);
  });

  websocketClient.on("message", (data) => {
    handleWebSocketMessage(JSON.parse(data.toString()));
  });

  return websocketClient;
}

function sendWebSocketMessage(message) {
    let ws = new WebSocket(APEX_WEBSOCKET_URL);
    ws.onopen = () => {
      ws.send(message);
      ws.close();
    };
}

function handleSpectateCommand(messageText) {
    let parts = messageText.split(" ");
    console.log(parts);

    if (parts.length == 1) {
      sendChatMessage("Usage: !spectate <player|poi> <name|number (1-6)>");
      return;
    }

    if (parts[1] == "player") {
      let playerName = "";
      if (parts.length > 3) {
        for (let i = 2; i < parts.length; i++) {
          playerName += parts[i];
          if (i != parts.length - 1) {
            playerName += " ";
          }
        }
      } else {
        playerName = parts[2];
      }

      sendChatMessage("Switching to player: " + playerName);
      sendWebSocketMessage(JSON.stringify({
        changeCam: { name: playerName },
      }));

    } else if (parts[1] == "poi") {
      if (parseInt(parts[2])) {
        let targetPOI = POI[parseInt(parts[2])] || null;
        if (targetPOI) {
          sendChatMessage("Switching to player of interest: " + targetPOI);
          sendWebSocketMessage(
            JSON.stringify({
              changeCam: { poi: parseInt(parts[2]) },
            })
          );
        } else {
          sendChatMessage("POI number " + parts[2] + " is not valid. Must be between 1 and 6.");
        }
      }
    }
}

function handleSwapCommand()
{
    sendChatMessage("Swapping to next instance of player damage!");
    sendWebSocketMessage(JSON.stringify({
      "swapCam": {},
    }));
}

function handleHelpCommand()
{
    sendChatMessage(
      "Commands: !spectate !swap"    
    );
}

function handleWebSocketMessage(data) {
  switch (data.metadata.message_type) {
    case "session_welcome": // First message you get from the WebSocket server when connecting
      websocketSessionID = data.payload.session.id; // Register the Session ID it gives us

      // Listen to EventSub, which joins the chatroom from your bot's account
      registerEventSubListeners();
      break;
    case "notification": // An EventSub notification has occurred, such as channel.chat.message
      switch (data.metadata.subscription_type) {
        case "channel.chat.message":
          // First, print the message to the program's console.
          console.log(
            `MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`
          );

          let command = data.payload.event.message.text.trim().split(" ")[0];
          if (command == "!spectate") {
            handleSpectateCommand(data.payload.event.message.text.trim());
          }
          else if (command == "!swap") {
            handleSwapCommand();
          }
          else if (command == "!help") {
            handleHelpCommand();
          }
        break;
      }
    break;
  }
}

async function sendChatMessage(chatMessage) {
  let response = await fetch("https://api.twitch.tv/helix/chat/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + OAUTH_TOKEN,
      "Client-Id": CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: CHAT_CHANNEL_USER_ID,
      sender_id: BOT_USER_ID,
      message: chatMessage,
    }),
  });

  if (response.status != 200) {
    let data = await response.json();
    console.error("Failed to send chat message");
    console.error(data);
  } else {
    console.log("Sent chat message: " + chatMessage);
  }
}

async function registerEventSubListeners() {
  // Register channel.chat.message
  let response = await fetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + OAUTH_TOKEN,
        "Client-Id": CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: CHAT_CHANNEL_USER_ID,
          user_id: BOT_USER_ID,
        },
        transport: {
          method: "websocket",
          session_id: websocketSessionID,
        },
      }),
    }
  );

  if (response.status != 202) {
    let data = await response.json();
    console.error(
      "Failed to subscribe to channel.chat.message. API call returned status code " +
        response.status
    );
    console.error(data);
    process.exit(1);
  } else {
    const data = await response.json();
    console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
  }
}
