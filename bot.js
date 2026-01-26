import WebSocket from "ws";
import { getAuth, CLIENT_ID } from "./auth.js";
import { inRange } from "./util.js";
import { startWebSocketServer, swapCam, broadcastMessage, ApexConnection } from "./apex.js";
import { getChannels, getChanneById } from "./data.js";
import { TwitchConnection } from "./twitch.js";

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

const twitchConnection = new TwitchConnection();
const apexConnection = new ApexConnection();

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
  
  const twitchWS = twitchConnection.connect();
  twitchWS.on("open", () => {
    console.log("Twitch EventSub WebSocket connected.");
  });
  twitchWS.on("message", (data) => {
    handleTwitchWebSocketMessage(JSON.parse(data.toString()));
  });

  const apexWSS = apexConnection.connect();
  apexWSS.on("listening", () => {
    console.log("Apex WebSocket Server is listening on port 7777");
  });
  apexWSS.on("connection", (ws) => {
    console.log("Apex WebSocket client connected.");
    ws.on("message", (message) => {
      handleApexWebSocketMessage(JSON.parse(message.toString()), ws);
    });
    ws.on("close", () => {
      console.log("Apex WebSocket client disconnected.");
    });
  });

  // Start WebSocket client and register handlers
  //const websocketClient = startWebSocketClient(EVENTSUB_WEBSOCKET_URL);

  //setInterval(intervalSwap, 30000); // every 30 seconds
  startWebSocketServer(7777);
  
})();

function handleTwitchWebSocketMessage(data) {
  switch (data.metadata.message_type) {
    case "session_welcome": // First message you get from the WebSocket server when connecting
      twitchConnection.sessionID = data.payload.session.id; // Register the Session ID it gives us

      // Listen to EventSub, which joins the chatroom from your bot's account
      twitchConnection.registerEventSubListener(CHAT_CHANNEL_USER_ID);
      break;
    case "notification": // An EventSub notification has occurred, such as channel.chat.message
      switch (data.metadata.subscription_type) {
        case "channel.chat.message":
          // First, print the message to the program's console.
          console.log(
            `MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`
          );
          if (data.payload.event.chatter_user_id == process.env.BOT_CHANNEL_ID) {
            // Ignore messages from the bot itself
            console.log("Ignoring message from self.");
            break;
          }

          const broadcaster_id = data.payload.event.broadcaster_user_id;
          const message = data.payload.event.message.text.trim();

          const command = message.split(" ")[0];
          if (command == "!spectate") {
            // TODO: handle sending message to Apex
            const {type, target} = twitchConnection.handleSpectateCommand(
              message,
              broadcaster_id
            );
            if (type == "invalid") {
              break;
            }
            console.log("Type: " + type + " Target: " + target);
          } else if (command == "!swap") {
            twitchConnection.handleSwapCommand(broadcaster_id);
          } else if (command == "!help") {
            twitchConnection.handleHelpCommand(broadcaster_id);
          } else if (command == "!score") {
            twitchConnection.handleScoreCommand(broadcaster_id);
          } else if (command == "!setscore") {
            twitchConnection.handleSetScoreCommand(
              data.payload.event.badges,
              message.split(" ")[1],
              broadcaster_id,
            );
          } else if (command == "!shuffle") {
            twitchConnection.handleShuffleCommand(
              data.payload.event.badges,
              broadcaster_id,
            );
          }
          break;
      }
      break;
    }
}

function handleApexWebSocketMessage(message, ws) {
  switch (message.category) {
    case "init":
      apexConnection.handleInitMessage(message, ws);
      break;
    case "playerConnected":
      apexConnection.handlePlayerConnectedMessage(message, ws);
      break;
    case "matchStateEnd":
      apexConnection.handleMatchStateEndMessage(message, ws);
      break;
    case "playerDamaged":
      apexConnection.handlePlayerDamagedMessage(message, ws);
      break;
  }
}