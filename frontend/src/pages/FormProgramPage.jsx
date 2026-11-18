import { useEffect, useState } from 'react'
import { AutocompleteSelect } from '../components/ui/AutocompleteSelect'
import { EvaluationProgramEditor } from '../components/EvaluationProgramFields'
import { api, errorMessage } from '../lib/api'
import { ALERT_ERROR, ALERT_OK, LABEL, PAGE_TITLE } from '../components/ui/styles'
import { Card } from '../components/ui/Card'

const EVALUATIONS = '/questions/evaluations/'

// Cada envío crea una copia independiente del formulario seleccionado. La edición de una
// programación existente se realiza desde EvaluationsListPage y nunca reutiliza este flujo.
// `kind`: 'group' (Grupales, la programación de siempre) o 'self' (Individuales: autoevaluación).
const TITLES = { group: 'Programar evaluación grupal', self: 'Programar evaluación individual' }

export function FormProgramPage({ kind = 'group' }) {
  const [evaluations, setEvaluations] = useState(null)
  const [staff, setStaff] = useState([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  // Cambia tras cada creación para remontar el formulario y dejarlo limpio.
  const [formVersion, setFormVersion] = useState(0)

  // Evaluaciones existentes + personal candidato (para elegir personas a evaluar al programar).
  useEffect(() => {
    // base=1: solo las evaluaciones creadas (originales); las copias programadas no se listan para no duplicarlas.
    Promise.all([api(`${EVALUATIONS}?created_by=me&base=1`), api('/users/staff-candidates/')])
      .then(([list, candidates]) => {
        setEvaluations(list)
        setStaff(candidates)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  // `selected` es string ('' = ninguna) porque lo maneja AutocompleteSelect; por eso se compara con String(id).
  const chosen = evaluations?.find((evaluation) => String(evaluation.id) === selected) ?? null

  // Al programar se crea una copia NUEVA; no se agrega a esta lista porque aquí solo se muestran las originales
  // (la copia aparece en "Lista de evaluaciones").
  function handleSaved(updated) {
    // Formulario limpio para programar otra: se deja de seleccionar la evaluación y se remonta el editor.
    setNotice(`Nueva evaluación programada: «${updated.name}».`)
    setSelected('')
    setFormVersion((version) => version + 1)
  }

  return (
    <Card className="max-w-2xl">
      <div className="space-y-4">
        <h1 className={PAGE_TITLE}>{TITLES[kind]}</h1>
        {error && <div role="alert" className={ALERT_ERROR}>{error}</div>}
        {notice && <div className={ALERT_OK}>{notice}</div>}
        <p className="text-sm text-app-muted">
          {kind === 'self'
            ? 'Autoevaluación: cada colaborador se evalúa a sí mismo una vez, hasta la fecha de cierre. '
            : ''}
          Cada vez que guardes se creará una evaluación nueva, con identificador, áreas y periodo propios. El formulario seleccionado no se modifica.
        </p>
        {evaluations?.length > 0 && (
          <label className={`${LABEL} grid gap-1.5`}>
            Evaluación
            <AutocompleteSelect
              value={selected}
              onChange={(value) => {
                setSelected(value)
                setNotice(null)
              }}
              placeholder="Selecciona una evaluación"
              options={[
                { value: '', label: 'Selecciona una evaluación' },
                ...evaluations.map((evaluation) => ({
                  value: String(evaluation.id),
                  label: evaluation.name,
                })),
              ]}
            />
          </label>
        )}
        {evaluations?.length === 0 && <p className="text-sm text-app-muted">Primero crea una evaluación para programarla.</p>}
        {evaluations?.length > 0 && (
          <div className="border-t border-app pt-4">
            <EvaluationProgramEditor
              // key: reinicia el formulario interno al cambiar la evaluación base.
              key={`${kind}-${chosen?.id ?? 'none'}-${formVersion}`}
              evaluation={chosen}
              staff={staff}
              onSaved={handleSaved}
              disabled={!chosen}
              createNew
              kind={kind}
            />
          </div>
        )}
      </div>
    </Card>
  )
}