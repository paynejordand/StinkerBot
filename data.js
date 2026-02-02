import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config();

export async function getChannels()
{
    const sql = neon(process.env.DATABASE_URL || "");
    const res = await sql.query("SELECT * FROM stinkerbot_channels;");
    return res;
}

export async function getChanneById(broadcaster_user_id)
{
    const sql = neon(process.env.DATABASE_URL || "");
    const res = await sql.query("SELECT * FROM stinkerbot_channels WHERE userid = $1;", [broadcaster_user_id]);
    return res;
}