import WebSocket from "ws";
import { getAuth, CLIENT_ID } from "./auth.js";
import { inRange } from "./util.js";
import { startWebSocketServer, swapCam, broadcastMessage, closestName, POI } from "./apex.js";
import { getChannels, getChanneById } from "./data.js";

const BOT_USER_ID = process.env.BOT_CHANNEL_ID; // This is the User ID of the chat bot (may be the same as CHAT_CHANNEL_USER_ID)
const OAUTH_TOKEN = process.env.OAUTH_TOKEN_BOT; // Needs scopes user:bot, user:read:chat, user:write:chat

const CHAT_CHANNEL_USER_ID = process.env.CHANNEL_ID; // This is the User ID of the channel that the bot will join and listen to chat messages of

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";

// Cooldown configuration for handleSpectateCommand (in milliseconds)
const SPECTATE_COOLDOWN_MS = 10 * 1000; // 10 second cooldown
const HOUR_MS = 60 * 60 * 1000;

var websocketSessionID;
var scoreLink = "";
var spectateCooldowns = new Map(); // Tracks cooldown per user (TODO: per channel)

var intervalSwapActive = false;

var channels = new Map(); // broadcaster_id -> channel info

// Start executing the bot from here
(async () => {
  // Verify that the authentication is valid
  const channelsList = await getChannels();
  for (const channel of channelsList) {
    channels.set(channel.userid, await getAuth(
      channel.access_token,
      channel.refresh_token
    ));
  }
  
  process.env.OAUTH_TOKEN_BOT = await getAuth(
    process.env.OAUTH_TOKEN_BOT,
    process.env.REFRESH_TOKEN_BOT
  );

  // Start WebSocket client and register handlers
  const websocketClient = startWebSocketClient(EVENTSUB_WEBSOCKET_URL);

  //setInterval(intervalSwap, 30000); // every 30 seconds
  startWebSocketServer(7777);
  
})();

// WebSocket will persist the application loop until you exit the program forcefully

function startWebSocketClient(url) {
  let websocketClient = new WebSocket(url);

  websocketClient.on("error", console.error);

  websocketClient.on("open", () => {
    console.log("WebSocket connection opened to " + url);
  });

  websocketClient.on("message", (data) => {
    handleWebSocketMessage(JSON.parse(data.toString()));
  });

  return websocketClient;
}

function sendWebSocketMessage(message, broadcaster_id) {
  broadcastMessage(message, broadcaster_id);
}

function handleSpectateCommand(messageText, broadcaster_id) {
  let parts = messageText.split(" ");
  console.log(parts);

  // Check cooldown
  const now = Date.now();
  const lastCooldown = spectateCooldowns.get(broadcaster_id);
  if (lastCooldown && now - lastCooldown < SPECTATE_COOLDOWN_MS) {
    const remainingTime = Math.ceil(
      (SPECTATE_COOLDOWN_MS - (now - lastCooldown)) / 1000
    );
    sendChatMessage(
      `Please wait ${remainingTime} second(s) before using !spectate again.`,
      broadcaster_id
    );
    return;
  }
  spectateCooldowns.set(broadcaster_id, now);

  if (parts.length == 1) {
    sendChatMessage("Usage: !spectate <name|(1-6)>", broadcaster_id);
    return;
  }

  if (inRange(parseInt(parts[1]), 1, 6)) {
    let targetPOI = POI[parseInt(parts[1])] || null;
    sendChatMessage("Switching to player of interest: " + targetPOI, broadcaster_id);
    sendWebSocketMessage(
      JSON.stringify({
        changeCam: { poi: parseInt(parts[1]) },
      }),
      broadcaster_id
    );
  } else {
    let playerName = "";
    for (let i = 1; i < parts.length; i++) {
      playerName += parts[i];
      if (i != parts.length - 1) {
        playerName += " ";
      }
    }
    console.log("Original player name: " + playerName);
    playerName = closestName(broadcaster_id, playerName); 
    sendChatMessage("Switching to player: " + playerName, broadcaster_id);
    sendWebSocketMessage(
      JSON.stringify({
        changeCam: { name: playerName },
      }),
      broadcaster_id
    );
  }
}

function handleSwapCommand(broadcaster_id) {
  sendChatMessage("Swapping to next instance of player damage!", broadcaster_id);
  swapCam(broadcaster_id);
}

function handleHelpCommand(broadcaster_id) {
  sendChatMessage("Commands: !spectate !swap !score", broadcaster_id);
}

async function handleScoreCommand(broadcaster_id) {
  if (!scoreLink) {
    sendChatMessage("No valid link for scores set.", broadcaster_id);
    return;
  }
  try {
    let response = await fetch(scoreLink);
    if (response.status !== 200) {
      sendChatMessage("Invalid link was set.", broadcaster_id);
      return;
    }
    sendChatMessage(await response.text(), broadcaster_id);
  } catch (error) {
    console.error(error);
    return;
  }
}

async function isModerator(chatterId, broadcaster_id) {
  let response = await fetch(
    "https://api.twitch.tv/helix/moderation/moderators" +
      "?broadcaster_id=" +
      broadcaster_id +
      "&user_id=" +
      chatterId,
    {
      method: "GET",
      headers: {
        Authorization: "Bearer " + channels.get(broadcaster_id),
        "Client-Id": CLIENT_ID,
      },
    }
  );
  if (response.status != 200) {
    let data = response.json();
    console.log(response);
    console.error("Request failed " + response.status);
    console.error(await data);
    return false;
  }

  let data = await response.json();
  return data.data.length != 0;
}

function isBroadcaster(chatterId, broadcaster_id) {
  return chatterId == broadcaster_id;
}

async function handleSetScoreCommand(chatterId, newScoreLink, broadcaster_id) {
  // check if user is a moderator
  if (!(await isModerator(chatterId, broadcaster_id)) && !isBroadcaster(chatterId, broadcaster_id)) {
    sendChatMessage("Only mods in this channel can use this command!", broadcaster_id);
    return;
  }

  try {
    let response = await fetch(newScoreLink);
    if (response.status !== 200) {
      sendChatMessage("Invalid link.", broadcaster_id);
      return;
    }
  } catch (error) {
    console.error(error);
    sendChatMessage("Invalid link.", broadcaster_id);
    return;
  }
  // TODO: may want to make sure this link follows the right format for OS/summary
  scoreLink = newScoreLink;
  sendChatMessage("Score link set to " + newScoreLink, broadcaster_id);
}

// TODO: edit this function to cycle through connected broadcasters
async function intervalSwap() {
  if (intervalSwapActive) {
    swapCam();
  }
}

async function handleShuffleCommand(chatterId, broadcaster_id) {
  if (!(await isModerator(chatterId, broadcaster_id)) && !isBroadcaster(chatterId, broadcaster_id)) {
    sendChatMessage("Only mods in this channel can use this command!", broadcaster_id);
    return;
  }
  intervalSwapActive = true;
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
          if (data.payload.event.chatter_user_id == BOT_USER_ID) {
            // Ignore messages from the bot itself
            console.log("Ignoring message from self.");
            break;
          }

          intervalSwapActive = false;

          let command = data.payload.event.message.text.trim().split(" ")[0];
          if (command == "!spectate") {
            handleSpectateCommand(
              data.payload.event.message.text.trim(),
              data.payload.event.broadcaster_user_id
            );
          } else if (command == "!swap") {
            handleSwapCommand(data.payload.event.broadcaster_user_id);
          } else if (command == "!help") {
            handleHelpCommand(data.payload.event.broadcaster_user_id);
          } else if (command == "!score") {
            handleScoreCommand(data.payload.event.broadcaster_user_id);
          } else if (command == "!setscore") {
            handleSetScoreCommand(
              data.payload.event.chatter_user_id,
              data.payload.event.message.text.trim().split(" ")[1],
              data.payload.event.broadcaster_user_id
            );
          } else if (command == "!shuffle") {
            handleShuffleCommand(data.payload.event.chatter_user_id, data.payload.event.broadcaster_user_id);
          }
          break;
      }
      break;
  }
}

// TODO: refresh token if failed
async function sendChatMessage(chatMessage, broadcaster_id) {
  let response = await fetch("https://api.twitch.tv/helix/chat/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
      "Client-Id": CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: broadcaster_id,
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
  for (const channel of channels)
  {
    console.log(channel[1]);
    let response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
          "Client-Id": CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: channel[0],
            user_id: process.env.BOT_CHANNEL_ID,
          },
          transport: {
            method: "websocket",
            session_id: websocketSessionID,
          },
        }),
      },
    );

    if (response.status != 202) {
      let data = await response.json();
      console.error(
        "Failed to subscribe to channel.chat.message. API call returned status code " +
          response.status,
      );
      console.error(data);
      process.exit(1);
    } else {
      const data = await response.json();
      console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
    }
  }
}
