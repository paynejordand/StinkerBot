import WebSocket from "ws";
import { inRange } from "./util.js";

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";
const SPECTATE_COOLDOWN_MS = 10 * 1000; // 10 second cooldown

var subscription_ids = new Map();

export class TwitchConnection {
  constructor(spectateCallback, swapCallback) {
    console.log("TwitchConnection constructor called.");
    this.ws = null;
    this.websocketSessionID = null;
    this.scoreLink = "";
    this.spectateCooldowns = new Map();
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
    return this.ws;
  }

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
            // First, print the message to the program's console.
            console.log(
              `MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`,
            );
            if (
              data.payload.event.chatter_user_id ==
                process.env.BOT_CHANNEL_ID ||
              data.payload.event.broadcaster_id == process.env.BOT_CHANNEL_ID
            ) {
              // Ignore messages from the bot itself
              console.log("Ignoring message from self.");
              break;
            }

            const broadcaster_id = data.payload.event.broadcaster_user_id;
            const message = data.payload.event.message.text.trim();

            const command = message.split(" ")[0];
            if (command == "!spectate") {
              this.handleSpectateCommand(message, broadcaster_id);
            } else if (command == "!swap") {
              thishandleSwapCommand(broadcaster_id);
            } else if (command == "!help") {
              this.handleHelpCommand(broadcaster_id);
            } else if (command == "!score") {
              this.handleScoreCommand(broadcaster_id);
            } else if (command == "!setscore") {
              this.handleSetScoreCommand(
                data.payload.event.badges,
                message.split(" ")[1],
                broadcaster_id,
              );
            } else if (command == "!shuffle") {
              this.handleShuffleCommand(
                data.payload.event.badges,
                broadcaster_id,
              );
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
      subscription_ids[broadcaster_id] = data.data[0].id;
      console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
    }
  }

  async deregisterEventSubListener(broadcaster_id) {
    const sub_id = subscription_ids[broadcaster_id];
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
        "Failed to subscribe to channel.chat.message. API call returned status code " +
          response.status,
      );
      console.error(response);
    } else {
      subscription_ids.delete(broadcaster_id);
      console.log("Successfully unsubscribed from channel.chat.message");
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

  handleHelpCommand(broadcaster_id) {
    this.sendChatMessage(
      "Available commands: !spectate <name|(1-6)>, !swap, !score",
      broadcaster_id,
    );
  }

  handleSpectateCommand(messageText, broadcaster_id) {
    const parts = messageText.split(" ");

    if (parts.length == 1) {
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
    if (inRange(parseInt(parts[1]), 1, 6)) {
      let targetPOI = parseInt(parts[1]);
      status = this.spectateCallback(broadcaster_id, "poi", targetPOI);
    } else {
      let playerName = "";
      for (let i = 1; i < parts.length; i++) {
        playerName += parts[i];
        if (i != parts.length - 1) {
          playerName += " ";
        }
      }
      console.log("Original player name: " + playerName);
      status = this.spectateCallback(broadcaster_id, "name", playerName);
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
    this.scoreLink = newScoreLink;
    this.sendChatMessage("Score link set to " + newScoreLink, broadcaster_id);
  }

  async handleScoreCommand(broadcaster_id) {
    if (!this.scoreLink) {
      this.sendChatMessage("No valid link for scores set.", broadcaster_id);
      return;
    }
    try {
      let response = await fetch(this.scoreLink);
      if (response.status !== 200) {
        this.sendChatMessage("Invalid link was set.", broadcaster_id);
        return;
      }
      this.sendChatMessage(await response.text(), broadcaster_id);
    } catch (error) {
      console.error(error);
      return;
    }
  }

  handleShuffleCommand(badges, broadcaster_id) {
    if (!isModerator(badges) && !isBroadcaster(badges)) {
      sendChatMessage(
        "Only mods in this channel can use this command!",
        broadcaster_id,
      );
      return;
    }
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
}
