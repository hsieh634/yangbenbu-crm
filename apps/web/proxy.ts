import { NextResponse, type NextRequest } from 'next/server';

/**
 * 沒有 Session cookie 就導向登入頁（快速路徑）。
 * Session 是否有效由後端判斷；過期時前端收到 401 會再導回登入頁。
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has('yb_session')) {
    const url = new URL('/login', request.url);
    const from = request.nextUrl.pathname;
    if (from !== '/') url.searchParams.set('from', from);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|_next|favicon.ico|.*\\..*).*)'],
};
