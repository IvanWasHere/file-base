import { ALGORITHM_GROUPS, GROUP_LABELS, type HashAlgorithm } from '@/constants/hashAlgorithms'

/**
 * The modal's left-hand column (PLAN.md M14).
 *
 * Grouped rather than listed flat, because the groups carry the warning. CRC32
 * sits under "Integrity check" and says what it is: a tool that lets someone
 * verify a download with CRC32 believing it proves the file is authentic is
 * worse than one that leaves CRC32 out. MD5 and SHA-1 stay because published
 * checksums still use them, labelled so nobody reaches for them by default
 * (decision 11).
 */
export function AlgorithmList({
  value,
  onChange,
}: {
  value: HashAlgorithm
  onChange: (algorithm: HashAlgorithm) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Algorithm"
      className="border-edge bg-base w-52 shrink-0 overflow-y-auto border-r py-2"
    >
      {ALGORITHM_GROUPS.map(({ group, algorithms }) => (
        <div key={group} className="mb-2">
          <h3 className="text-muted px-3 pb-1 text-[10px] font-semibold tracking-wide uppercase">
            {GROUP_LABELS[group]}
          </h3>
          {algorithms.map((spec) => {
            const selected = spec.id === value
            return (
              <button
                key={spec.id}
                type="button"
                role="radio"
                aria-checked={selected}
                // The warning is the reason the row exists in this group, so it
                // is the row's tooltip rather than a footnote nobody reads.
                {...(spec.note ? { title: spec.note } : {})}
                onClick={() => onChange(spec.id)}
                className={`flex w-full flex-col items-start px-3 py-1.5 text-left transition-colors ${
                  selected
                    ? 'text-accent bg-[var(--accent-glow)]'
                    : 'text-secondary hover:bg-hover hover:text-primary'
                }`}
              >
                <span className="text-[13px]">{spec.label}</span>
                {spec.note && (
                  <span className="text-muted text-[10px] leading-tight">{spec.note}</span>
                )}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
