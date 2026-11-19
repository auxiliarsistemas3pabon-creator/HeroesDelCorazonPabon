// Toda la app vive bajo /admin/ (/admin/login, /admin/dashboard, /admin/program…). Las rutas internas se escriben
// sin el prefijo: el basename del router lo agrega. En producción nginx responde "Acceso no autorizado" fuera de
// /admin/; isInsideApp cubre lo mismo en desarrollo (Vite) y si alguien carga la app desde otra ruta.
export const APP_BASENAME = '/admin'

export function isInsideApp(pathname) {
  return pathname === APP_BASENAME || pathname.startsWith(`${APP_BASENAME}/`)
}
