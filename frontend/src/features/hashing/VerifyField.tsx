import { AlertTriangle, Check } from 'lucide-react'
import { algorithmSpec, HASH_ALGORITHMS, type HashAlgorithm } from '@/constants/hashAlgorithms'
import { looksLikeDigest } from '@/services/hashing/hashService'

/**
 * Paste an expected checksum; the row that matches it lights up (PLAN.md M14
 * decision 9).
 *
 * The normalisation happens in `hashService.normalizeChecksum`, because what is
 * on the clipboard is rarely a bare digest — `shasum` and every download page
 * emit `<hash>  *filename`, and a field that only accepted 64 bare hex
 * characters would reject the exact thing people copy.
 *
 * The one piece of cleverness: a digest of the wrong length is almost always the
 * right paste against the wrong algorithm, so the field says which one it looks
 * like rather than "no match". That is the mistake this field exists to catch,
 * and "no match" is precisely the wrong thing to tell someone in that moment.
 */
export function VerifyField({
  value,
  normalized,
  algorithm,
  matched,
  onChange,
}: {
  value: string
  /** `value` after trimming and case folding — what is compared. */
  normalized: string
  algorithm: HashAlgorithm
  /** True when some row carries this digest. */
  matched: boolean
  onChange: (value: string) => void
}) {
  const expected = algorithmSpec(algorithm)
  const wrongLength =
    normalized.length > 0 &&
    looksLikeDigest(normalized) &&
    normalized.length !== expected.digestLength

  const suggestion = wrongLength
    ? HASH_ALGORITHMS.find((spec) => spec.digestLength === normalized.length)
    : undefined

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          aria-label="Expected checksum"
          placeholder="Paste a checksum to verify…"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
          // The list behind the modal treats letters as type-ahead; a focused
          // field owns its own keystrokes.
          onKeyDown={(event) => event.stopPropagation()}
          className="border-edge bg-base text-primary min-w-0 flex-1 rounded-md border px-2 py-1 font-mono text-[12px] outline-none focus:border-[var(--accent)]"
        />
        {normalized.length > 0 && matched && (
          <span className="text-accent flex shrink-0 items-center gap-1 text-[12px]">
            <Check size={14} /> Match
          </span>
        )}
      </div>

      {normalized.length > 0 && !matched && (
        <p className="text-muted flex items-center gap-1.5 text-[11px]">
          <AlertTriangle size={11} className="shrink-0" />
          {suggestion
            ? `That is ${suggestion.digestLength} characters — it looks like a ${suggestion.label} digest, not ${expected.label}.`
            : !looksLikeDigest(normalized)
              ? 'That does not look like a checksum.'
              : 'No file here has that checksum.'}
        </p>
      )}
    </div>
  )
}
