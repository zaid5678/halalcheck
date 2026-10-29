import type { HalalVerdict, Reason, Ruling } from '../types/halal'

const STYLES: Record<Ruling, { label: string; icon: string; text: string; badge: string; pill: string }> = {
  halal: { label: 'Halal', icon: '✓', text: 'text-brand-600', badge: 'bg-brand-600', pill: 'bg-brand-50 text-brand-700' },
  haram: { label: 'Haram', icon: '✕', text: 'text-red-700', badge: 'bg-red-600', pill: 'bg-red-50 text-red-700' },
  doubtful: { label: 'Doubtful', icon: '!', text: 'text-amber-700', badge: 'bg-amber-600', pill: 'bg-amber-50 text-amber-800' },
}
const ORDER: Record<Ruling, number> = { haram: 0, doubtful: 1, halal: 2 }
// The backend's placeholder when a product has no ingredients list: not a real ingredient.
const NO_INGREDIENTS = 'Ingredients'

function summary({ verdict, reasons }: HalalVerdict, ingredients: Reason[]): string {
  if (reasons.length > ingredients.length) return 'Ingredients aren’t listed for this product'
  if (verdict === 'halal') return 'No ingredients of concern found'
  const count = ingredients.filter((reason) => reason.ruling === verdict).length
  const noun = count === 1 ? 'ingredient needs' : 'ingredients need'
  return verdict === 'haram' ? `${count} haram ${noun.split(' ')[0]} found` : `${count} ${noun} checking`
}

export function VerdictCard({ result }: { result: HalalVerdict }) {
  const style = STYLES[result.verdict]
  const ingredients = result.reasons
    .filter((reason) => reason.ingredient !== NO_INGREDIENTS)
    .sort((a, b) => ORDER[a.ruling] - ORDER[b.ruling])

  return (
    <section aria-label="Halal check" className="space-y-4">
      <div className="rounded-2xl border border-line bg-surface p-5">
        <div className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className={`flex size-14 shrink-0 items-center justify-center rounded-full text-2xl font-bold text-white ${style.badge}`}
          >
            {style.icon}
          </span>
          <div>
            <h2 className={`text-3xl font-bold tracking-tight ${style.text}`}>{style.label}</h2>
            <p className="font-medium">{summary(result, ingredients)}</p>
          </div>
        </div>
        <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
          Based on listed ingredients, not a fatwa or certification.
          {/* Haram from the rules skips the AI on purpose; only flag a real outage. */}
          {!result.ai_checked &&
            result.verdict !== 'haram' &&
            result.ingredients_text &&
            ' Checked with our ingredient rules only — AI check unavailable.'}
        </p>
      </div>

      {ingredients.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">Why</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {ingredients.map((reason) => (
              <li key={reason.ingredient} className="flex items-start justify-between gap-3 p-4">
                <div>
                  <p className="font-semibold">{reason.ingredient}</p>
                  <p className="text-sm text-muted">{reason.note}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-sm font-semibold ${STYLES[reason.ruling].pill}`}>
                  {STYLES[reason.ruling].label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
