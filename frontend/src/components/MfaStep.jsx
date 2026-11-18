import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Button } from './ui/Button'
import { ALERT_ERROR, FIELD, LABEL } from './ui/styles'

/**
 * Segundo paso del login (doble autenticación TOTP).
 * - Primera vez (challenge.enrollment): muestra el QR para registrar la cuenta en la app y pide confirmarlo con un código.
 * - Navegador no reconocido (nuevo, cookies borradas, ventana privada): solo pide el código de 6 dígitos.
 * El QR se genera en el navegador: el secreto no sale hacia ningún servicio externo.
 */
export function MfaStep({ challenge, onVerify, onCancel, error, loading }) {
  const enrollment = challenge.enrollment
  const [code, setCode] = useState('')
  const [qr, setQr] = useState('')

  useEffect(() => {
    if (!enrollment) return undefined
    let active = true
    QRCode.toDataURL(enrollment.otpauth_uri, { margin: 1, width: 192 })
      .then((url) => { if (active) setQr(url) })
      .catch(() => { if (active) setQr('') })
    return () => { active = false }
  }, [enrollment])

  function submit(event) {
    event.preventDefault()
    onVerify(code)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#25151a]">
          {enrollment ? 'Activa la doble autenticación' : 'Verificación en dos pasos'}
        </h2>
        <p className="mt-0.5 text-xs text-app-muted">
          {enrollment
            ? 'Escanea el código QR con Google Authenticator o Microsoft Authenticator y escribe el código de 6 dígitos que aparece.'
            : 'Este navegador no está verificado. Escribe el código de 6 dígitos de tu app de autenticación.'}
        </p>
      </div>

      {enrollment && (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-app bg-white p-3">
          {qr
            ? <img src={qr} alt="Código QR para la app de autenticación" width="192" height="192" />
            : <p className="text-xs text-app-muted">Generando código QR…</p>}
          <p className="text-center text-[11px] text-app-muted">
            ¿No puedes escanearlo? Ingresa esta clave en la app:
            <span className="mt-1 block select-all break-all font-mono text-xs text-app">{enrollment.secret}</span>
          </p>
        </div>
      )}

      {error && <div role="alert" className={ALERT_ERROR}>{error}</div>}

      <label className={LABEL}>
        Código de verificación
        <input
          className={`${FIELD} text-center font-mono text-lg tracking-[0.4em]`}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          autoFocus
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
      </label>

      <Button type="submit" loading={loading} disabled={code.length !== 6} fullWidth className="!bg-[#c02645] hover:!bg-[#a71932] focus-visible:!ring-[#c02645]/50">
        {loading ? 'Verificando...' : 'Verificar'}
      </Button>
      <button type="button" onClick={onCancel} className="text-xs text-app-muted underline-offset-2 hover:underline">
        Volver al inicio de sesión
      </button>
    </form>
  )
}
