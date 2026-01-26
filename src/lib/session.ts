import { SessionOptions, getIronSession } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  isLoggedIn: boolean;
  expiresAt?: number;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET || "complex_password_at_least_32_characters_long",
  cookieName: "modern-mesh-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 4, // 4 hours
  },
};

export async function getSession() {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);
  return session;
}

export async function createSession() {
  const session = await getSession();
  session.isLoggedIn = true;
  session.expiresAt = Date.now() + 1000 * 60 * 60 * 4; // 4 hours from now
  await session.save();
  return session;
}

export async function destroySession() {
  const session = await getSession();
  session.destroy();
}

export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  if (!session.isLoggedIn) return false;
  if (session.expiresAt && Date.now() > session.expiresAt) {
    session.destroy();
    return false;
  }
  return true;
}
