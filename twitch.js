import WebSocket from "ws";
import { inRange } from "./util.js";
import dotenv from "dotenv";
dotenv.config();

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";
const SPECTATE_COOLDOWN_MS = 10 * 1000; // 10 second cooldown
const SHUFFLE_COOLDOWN_MS = 30 * 1000; // 30 second cooldown

export class TwitchConnection {
  constructor(spectateCallback, swapCallback) {
    console.log("TwitchConnection constructor called.");
    this.ws = null;
    this.websocketSessionID = null;
    this.scores = new Map();
    this.spectateCooldowns = new Map();
    this.swaps = new Set();
    this.subscription_ids = new Map();
    this.afk = new Map();
    this.spectateCallback = spectateCallback;
    this.swapCallback = swapCallback;
  }

  connect() {
    console.log("TwitchConnection connect called.");
    this.ws = new WebSocket(EVENTSUB_WEBSOCKET_URL);
    this.ws.on("open", () => {
      console.log("Twitch EventSub WebSocket connected.");
    });
    this.ws.on("message", (data) => {
      this.handleTwitchWebSocketMessage(JSON.parse(data.toString()));
    });
    setInterval(() => this.intervalSwap(), SHUFFLE_COOLDOWN_MS);
    return this.ws;
  }

  // Helper functions
  intervalSwap() {
    for (const id of this.swaps) {
      this.swapCallback(id);
    }
  }

  isModerator(badges) {
    for (const badge of badges) {
      if (badge.set_id == "moderator") {
        return true;
      }
    }
    return false;
  }

  isBroadcaster(badges) {
    for (const badge of badges) {
      if (badge.set_id == "broadcaster") {
        return true;
      }
    }
    return false;
  }

  async sendChatMessage(message, broadcaster_id) {
    let response = await fetch("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
        "Client-Id": process.env.CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        broadcaster_id: broadcaster_id,
        sender_id: process.env.BOT_CHANNEL_ID,
        message: message,
      }),
    });
    if (response.status != 200) {
      let data = await response.json();
      console.error("Failed to send chat message");
      console.error(data);
    } else {
      console.log("Sent chat message: " + message);
    }
  }

  // Websocket Event Handlers
  handleTwitchWebSocketMessage(data) {
    switch (data.metadata.message_type) {
      case "session_welcome": // First message you get from the WebSocket server when connecting
        this.websocketSessionID = data.payload.session.id; // Register the Session ID it gives us

        // Listen to EventSub, which joins the chatroom from your bot's account
        this.registerEventSubListener(process.env.CHANNEL_ID);
        break;
      case "notification": // An EventSub notification has occurred, such as channel.chat.message
        switch (data.metadata.subscription_type) {
          case "channel.chat.message":
            if (
              data.payload.event.chatter_user_id ==
                process.env.BOT_CHANNEL_ID ||
              data.payload.event.broadcaster_id == process.env.BOT_CHANNEL_ID
            ) {
              // Ignore messages from the bot itself
              console.log("Ignoring message from self.");
              break;
            }
            // First, print the message to the program's console.
            console.log(
              `MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`,
            );

            this.swaps.delete(data.payload.event.broadcaster_user_id);

            const broadcaster_id = data.payload.event.broadcaster_user_id;
            const message = data.payload.event.message.text.trim();
            const badges = data.payload.event.badges;

            const command = message.split(" ")[0];
            const isAfk = this.afk.get(broadcaster_id) || false;
            if (command == "!spectate" && isAfk) {
              this.handleSpectateCommand(message, broadcaster_id);
            } else if (command == "!swap" && isAfk) {
              this.handleSwapCommand(broadcaster_id);
            } else if (command == "!help" && isAfk) {
              this.handleHelpCommand(broadcaster_id);
            } else if (command == "!score") {
              this.handleScoreCommand(broadcaster_id);
            } else if (command == "!setscore") {
              this.handleSetScoreCommand(
                badges,
                message.split(" ")[1],
                broadcaster_id,
              );
            } else if (command == "!shuffle") {
              this.handleShuffleCommand(badges, broadcaster_id);
            } else if (command == "!afk") {
              this.handleAfkCommand(badges, broadcaster_id);
            }
            break;
        }
        break;
    }
  }

  async registerEventSubListener(broadcaster_id) {
    console.log(
      "Registering EventSub listener for broadcaster_id: " + broadcaster_id,
    );
    let response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
          "Client-Id": process.env.CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: broadcaster_id,
            user_id: process.env.BOT_CHANNEL_ID,
          },
          transport: {
            method: "websocket",
            session_id: this.websocketSessionID,
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
    } else {
      const data = await response.json();
      this.subscription_ids[broadcaster_id] = data.data[0].id;
      this.afk.set(broadcaster_id, false);
      console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
    }
  }

  async deregisterEventSubListener(broadcaster_id) {
    const sub_id = this.subscription_ids[broadcaster_id];
    if (!sub_id) {
      console.log(
        "No subscription ID found for broadcaster_id: " + broadcaster_id,
      );
      return;
    }
    console.log(
      "Deregistering EventSub listener for broadcaster_id: " + broadcaster_id,
    );
    let response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions?id=" + sub_id,
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
          "Client-Id": process.env.CLIENT_ID,
        },
      },
    );
    console.log("Deregister response status: " + response.status);

    if (response.status != 204) {
      console.error(
        "Failed to unsubscribe to channel.chat.message. API call returned status code " +
          response.status,
      );
      console.error(response);
    } else {
      this.subscription_ids.delete(broadcaster_id);
      this.afk.delete(broadcaster_id);
      console.log("Successfully unsubscribed from channel.chat.message");
    }
  }

  // Command Handlers
  handleHelpCommand(broadcaster_id) {
    this.sendChatMessage(
      "Available commands: !spectate <name|(1-6)>, !swap, !score",
      broadcaster_id,
    );
  }

  handleSpectateCommand(messageText, broadcaster_id) {
    const cmd = messageText.substring(0, messageText.indexOf(" "));
    const args = messageText.substring(messageText.indexOf(" ") + 1);

    if (cmd == "") {
      this.sendChatMessage("Usage: !spectate <name|(1-6)>", broadcaster_id);
      return { type: "invalid", target: null };
    }

    // Check cooldown
    const now = Date.now();
    const lastCooldown = this.spectateCooldowns.get(broadcaster_id);
    if (lastCooldown && now - lastCooldown < SPECTATE_COOLDOWN_MS) {
      const remainingTime = Math.ceil(
        (SPECTATE_COOLDOWN_MS - (now - lastCooldown)) / 1000,
      );
      this.sendChatMessage(
        `Please wait ${remainingTime} second(s) before using !spectate again.`,
        broadcaster_id,
      );
      return;
    }
    this.spectateCooldowns.set(broadcaster_id, now);

    var status = "";
    if (args.length == 1 && inRange(parseInt(args), 1, 6)) {
      let targetPOI = parseInt(args);
      console.log(args + " is a valid POI number.");
      status = this.spectateCallback(broadcaster_id, "poi", targetPOI);
    } else {
      console.log("Original player name: " + args);
      status = this.spectateCallback(broadcaster_id, "name", args);
    }
    console.log("Spectate status: " + status);
    this.sendChatMessage(status, broadcaster_id);
    return status;
  }

  handleSwapCommand(broadcaster_id) {
    this.sendChatMessage(
      "Swapping to next instance of player damage!",
      broadcaster_id,
    );
    this.swapCallback(broadcaster_id);
  }

  async handleSetScoreCommand(badges, newScoreLink, broadcaster_id) {
    // check if user is a moderator
    if (!this.isModerator(badges) && !this.isBroadcaster(badges)) {
      this.sendChatMessage(
        "Only mods in this channel can use this command!",
        broadcaster_id,
      );
      return;
    }

    try {
      let response = await fetch(newScoreLink);
      if (response.status !== 200) {
        this.sendChatMessage("Invalid link.", broadcaster_id);
        return;
      }
    } catch (error) {
      console.error(error);
      this.sendChatMessage("Invalid link.", broadcaster_id);
      return;
    }
    // TODO: may want to make sure this link follows the right format for OS/summary
    this.scores.set(broadcaster_id, newScoreLink);
    this.sendChatMessage("Score link set to " + newScoreLink, broadcaster_id);
  }

  async handleScoreCommand(broadcaster_id) {
    if (!this.scores.has(broadcaster_id)) {
      this.sendChatMessage("No valid link for scores set.", broadcaster_id);
      return;
    }
    try {
      let response = await fetch(this.scores.get(broadcaster_id));
      if (response.status !== 200) {
        this.sendChatMessage("Invalid link was set.", broadcaster_id);
        return;
      }
      this.sendChatMessage(await response.text(), broadcaster_id);
    } catch (error) {
      console.error(error);
      this.sendChatMessage(
        "Error fetching score link. If it is before the first game is over this is expected!",
        broadcaster_id,
      );
      return;
    }
  }

  handleShuffleCommand(badges, broadcaster_id) {
    if (!this.isModerator(badges) && !this.isBroadcaster(badges)) {
      this.sendChatMessage(
        "Only mods in this channel can use this command!",
        broadcaster_id,
      );
      return;
    }
    this.swaps.add(broadcaster_id);
    this.sendChatMessage(
      "Will now cycle through damage events!",
      broadcaster_id,
    );
  }

  handleAfkCommand(badges, broadcaster_id) {
    if (!this.isModerator(badges) && !this.isBroadcaster(badges)) {
      this.sendChatMessage(
        "Only mods in this channel can use this command!",
        broadcaster_id,
      );
      return;
    }
    this.afk.set(broadcaster_id, !this.afk.get(broadcaster_id));
    this.sendChatMessage(
      "Set AFK mode to " + this.afk.get(broadcaster_id),
      broadcaster_id,
    );
  }
}
