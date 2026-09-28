import { NextResponse, type NextRequest } from "next/server";
import { NETWORK_COOKIE, parseNetwork } from "@/lib/networks";

/**
 * `?network=testnet` (or mainnet) on any link selects that network for the visitor: the choice is
 * stored in a cookie, which every page and API route reads.
 */
export function middleware(req: NextRequest) {
  const wanted = parseNetwork(req.nextUrl.searchParams.get("network"));
  if (!wanted || req.cookies.get(NETWORK_COOKIE)?.value === wanted) return NextResponse.next();
  // The page this request renders must already see the new choice.
  req.cookies.set(NETWORK_COOKIE, wanted);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set(NETWORK_COOKIE, wanted, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
}

export const config = {
  // Pages only: not assets, images or the API.
  matcher: ["/((?!api|_next/static|_next/image|favicon|icon|apple-icon|manifest|robots|sitemap).*)"],
};
