import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { businesses, memberships, sessions, users } from "@/db/schema";

const SESSION_COOKIE = "ots_session";
const SESSION_DAYS = 14;

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string;
};

export type BusinessAccess = {
  business: typeof businesses.$inferSelect;
  membership: typeof memberships.$inferSelect;
  user: CurrentUser;
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64);
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashSessionToken(token), expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
  }
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

export async function currentUser(): Promise<CurrentUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      preferredLanguage: users.preferredLanguage,
      sessionId: sessions.id,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, preferredLanguage: row.preferredLanguage };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new ApiError("Please sign in to continue.", 401);
  return user;
}

export async function requireBusinessAccess(businessId: string, user = undefined as CurrentUser | undefined): Promise<BusinessAccess> {
  const authenticated = user ?? (await requireUser());
  const rows = await db
    .select({ business: businesses, membership: memberships })
    .from(memberships)
    .innerJoin(businesses, eq(memberships.businessId, businesses.id))
    .where(and(eq(memberships.businessId, businessId), eq(memberships.userId, authenticated.id)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new ApiError("You do not have access to this business workspace.", 403);
  return { ...row, user: authenticated };
}

export function requireOwner(access: BusinessAccess): void {
  if (access.membership.role !== "owner") {
    throw new ApiError("Only a workspace owner can approve or reverse financial postings.", 403);
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return;
  try {
    if (new URL(origin).host !== host) throw new ApiError("Request origin could not be verified.", 403);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Request origin could not be verified.", 403);
  }
}
