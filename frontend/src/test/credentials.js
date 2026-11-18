// Credenciales de prueba generadas al azar en cada ejecución: en los tests no se escribe ningún
// usuario ni contraseña (las llamadas al backend están simuladas, pero tampoco se dejan valores fijos).
export function randomUsername() {
  return `u${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`
}

export function randomPassword() {
  return `Tz${crypto.randomUUID()}9!`
}

export function randomCredentials() {
  return { username: randomUsername(), password: randomPassword() }
}
