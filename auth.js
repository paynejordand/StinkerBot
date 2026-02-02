import dotenv from "dotenv";
dotenv.config();

async function validateToken(oauthToken) {
  let response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + oauthToken,
    },
  });
  return response;
}

async function refreshToken(_refreshToken) {
  let response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=refresh_token&client_id=" +
      process.env.CLIENT_ID +
      "&refresh_token=" +
      _refreshToken +
      "&client_secret=" +
      process.env.CLIENT_SECRET,
  });

  return response;
}

async function getAuth(oauthToken, _refreshToken) {
  // https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
  let response = await validateToken(oauthToken);

  if (response.status != 200) {
    console.log("-- Attempting to refresh token --");
    let response = await refreshToken(_refreshToken);
    let data = await response.json();
    if (response.status != 200) {
      console.log(response);
      console.error(
        "Token is not valid. /oauth2/token returned status code " +
          response.status
      );
      console.error(data);
      process.exit(1);
    }
    oauthToken = data.access_token;
  }

  console.log("Validated token.");
  return oauthToken;
}

export { getAuth };
